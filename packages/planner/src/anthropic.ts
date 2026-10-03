import Anthropic from '@anthropic-ai/sdk';
import {
  hash,
  MAX_SOURCES,
  selectSubset,
  sourcesInView,
  USER_PAGES,
  validateOutput,
  type AnyContract,
  type Change,
  type ClaimedEvidence,
  type Metric,
  type OutputRejection,
  type Planner,
  type PlanProgress,
  type PlanRequest,
  type PlanResult,
  type ProposedOperation,
  type Subset,
} from '@plurid/aptuitive-core';
import { outputSchema } from './schema.js';
import { contractText, requestText, RULES } from './prompt.js';

/** A planner failure with the HTTP status the handler should answer with. */
export class PlannerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** US dollars per million tokens: input, output, cache read, cache write (five minutes). */
const PRICES: Record<string, readonly [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25],
  'claude-fable-5-1': [10, 50, 0.25, 12.5],
};

/**
 * How `anthropicPlanner` calls Claude: which model, how hard it thinks, how long it may take, and
 * with which client.
 */
export interface AnthropicPlannerOptions {
  /** The model. @default 'claude-opus-5-5' */
  model?: string;
  /** How much the model thinks before answering; `low` keeps commands quick. @default 'low' */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Most tokens the model may write, thinking included. @default 16000 */
  maxTokens?: number;
  /** How long a plan may take before it fails. @default 60000 */
  timeoutMs?: number;
  /** Server-side refusal fallback (beta `server-side-fallback-2026-07-01`). @default true */
  fallbacks?: boolean;
  /**
   * The Anthropic client. @default one from the environment: ANTHROPIC_API_KEY or an `ant auth
   * login` profile
   */
  client?: Pick<Anthropic, 'beta'>;
}

/**
 * What the model writes, in the schema `outputSchema` compiles: a status, candidates for ambiguous
 * requests, a note and flat operations. Policy checks it after `toOperations`.
 */
export interface PlannerOutput {
  /** Whether the model answered the request, found it ambiguous, or couldn't answer it. */
  status: 'done' | 'ambiguous' | 'unsupported';
  /** For an ambiguous request: what the words could mean. */
  candidates: string[];
  /** A short note for the person, shown with the changes. */
  note: string;
  /** Changes to lists, each with what it is based on. */
  lists?: {
    surface: string;
    context: string;
    op: 'promote' | 'demote' | 'move' | 'pin' | 'unpin' | 'hide' | 'restore';
    target: string;
    index: number;
    basis: 'request' | 'goal' | 'usage';
    metric: 'none' | Metric;
  }[];
  /** Values for choices, each with what it is based on. */
  choices?: { surface: string; value: string; basis: 'request' | 'goal' | 'usage' }[];
  /** Pages to redesign, reset, or, for the person's own pages, create, rename or delete. */
  pages?: {
    surface: string;
    context: string;
    op: 'set' | 'reset' | 'create' | 'rename' | 'delete';
    slug?: string;
    title?: string;
    root: string;
    elements: { id: string; block: string; props: unknown; children: string[] }[];
    data?: { name: string; query: unknown }[];
    basis: 'request' | 'goal' | 'usage';
  }[];
}

const scopeOf = (basis: string): Pick<ProposedOperation, 'scope'> =>
  basis === 'request' ? { scope: 'explicit' } : basis === 'goal' ? { scope: 'goal' } : {};

const contextOf = (value: string) => (value === 'none' ? {} : { context: value });

/** Turns the model's flat output into proposed operations for policy to check. */
export function toOperations(output: PlannerOutput): ProposedOperation[] {
  const note = output.note.trim() || undefined;
  const operations: ProposedOperation[] = [];
  for (const entry of output.lists ?? []) {
    const evidence: ClaimedEvidence[] =
      entry.basis === 'usage' && entry.metric !== 'none'
        ? [{ action: entry.target, metric: entry.metric }]
        : [{ intent: true }];
    operations.push({
      change: {
        kind: 'list',
        surface: entry.surface,
        op: entry.op,
        target: entry.target,
        ...contextOf(entry.context),
        ...(entry.op === 'move' && entry.index >= 0 ? { index: entry.index } : {}),
      },
      evidence,
      ...scopeOf(entry.basis),
    });
  }
  for (const entry of output.choices ?? []) {
    operations.push({
      change: { kind: 'choice', surface: entry.surface, op: 'set', value: entry.value },
      evidence: [{ intent: true }],
      ...scopeOf(entry.basis),
    });
  }
  for (const entry of output.pages ?? []) {
    const value = { root: entry.root, elements: entry.elements, data: (entry.data ?? []) as never };
    if (entry.surface === USER_PAGES) {
      if (entry.op === 'reset' || !entry.slug) continue;
      operations.push({
        change: {
          kind: 'userPage',
          surface: USER_PAGES,
          op: entry.op,
          slug: entry.slug,
          ...(entry.op === 'create' || entry.op === 'rename' ? { title: entry.title ?? '' } : {}),
          ...(entry.op === 'create' || entry.op === 'set' ? { value } : {}),
        },
        evidence: [{ intent: true }],
        ...scopeOf(entry.basis),
      });
      continue;
    }
    if (entry.op !== 'set' && entry.op !== 'reset') continue;
    operations.push({
      change: {
        kind: 'page',
        surface: entry.surface,
        op: entry.op,
        ...contextOf(entry.context),
        ...(entry.op === 'set' ? { value } : {}),
      },
      evidence: [{ intent: true }],
      ...scopeOf(entry.basis),
    });
  }
  if (note !== undefined && operations[0]) operations[0] = { ...operations[0], note };
  return operations;
}

/** Prepared schemas and prompts kept, by contract and subset. */
const PREPARED = 32;

interface Prepared {
  schema: Record<string, unknown>;
  system: string;
}

interface Reply {
  model: string;
  stop_reason: string | null;
  content: readonly { type: string; text?: string }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

interface Messages {
  create(body: unknown, options: unknown): Promise<Reply>;
  stream?(
    body: unknown,
    options: unknown,
  ): {
    on(event: 'text', listener: (delta: string, snapshot: string) => void): unknown;
    finalMessage(): Promise<Reply>;
  };
}

const NO_CREDENTIALS = 'No Anthropic credentials: set ANTHROPIC_API_KEY or run `ant auth login`';

/**
 * Plans with Claude through structured outputs: the contract compiles to the schema, so every
 * answer names only what the application offers. Large contracts are first scoped to the
 * areas a request needs; schema and prompt are cached per scope, so grammars and prompt caches
 * stay warm. Parts of a plan that policy would reject go back once for repair.
 */
export function anthropicPlanner(options: AnthropicPlannerOptions = {}): Planner {
  const model = options.model ?? 'claude-opus-5-5';
  const prepared = new Map<string, Prepared>();
  let client = options.client;

  const prepare = (contract: AnyContract, subset: Subset | undefined, native: boolean) => {
    const key = hash([contract.hash, subset?.sources ?? null, native]);
    const found = prepared.get(key);
    if (found) {
      prepared.delete(key);
      prepared.set(key, found);
      return found;
    }
    const fresh: Prepared = {
      schema: outputSchema(contract, { ...(subset === undefined ? {} : { subset }), native }),
      system: contractText(contract, subset),
    };
    prepared.set(key, fresh);
    if (prepared.size > PREPARED) prepared.delete(prepared.keys().next().value as string);
    return fresh;
  };

  return {
    name: 'claude',
    async plan(request: PlanRequest, contract: AnyContract, planOptions = {}) {
      const started = Date.now();
      if (!client) {
        try {
          client = new Anthropic();
        } catch {
          throw new PlannerError(NO_CREDENTIALS, 503);
        }
      }
      const messagesApi = client.beta.messages as unknown as Messages;
      const words = [request.text, request.goal].filter(Boolean).join(' ');
      const inView = sourcesInView(contract, request);
      let subset =
        contract.sourceIds.length > MAX_SOURCES
          ? selectSubset(contract, { text: words, inView })
          : undefined;
      let native = true;
      let ready = prepare(contract, subset, native);
      const messages: { role: 'user' | 'assistant'; content: string }[] = [
        { role: 'user', content: requestText(request) },
      ];
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let answeredBy = model;
      let stages = 0;
      const requestOptions = {
        timeout: options.timeoutMs ?? 60_000,
        maxRetries: 1,
        ...(planOptions.signal ? { signal: planOptions.signal as AbortSignal } : {}),
      };

      const ask = async (
        stage: PlanProgress['stage'],
      ): Promise<{ output: PlannerOutput; text: string }> => {
        for (let attempt = 0; ; attempt++) {
          stages++;
          const body = {
            model,
            max_tokens: options.maxTokens ?? 16_000,
            system: [
              { type: 'text', text: RULES },
              { type: 'text', text: ready.system, cache_control: { type: 'ephemeral' } },
            ],
            messages,
            output_config: {
              effort: options.effort ?? 'low',
              format: { type: 'json_schema', schema: ready.schema },
            },
            ...(options.fallbacks === false
              ? {}
              : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
          };
          let reply: Reply;
          try {
            planOptions.onProgress?.({ stage, elements: 0 });
            reply = await send(messagesApi, body, requestOptions, stage, planOptions.onProgress);
          } catch (error) {
            if (attempt === 0 && stage === 'planning' && tooComplex(error)) {
              // A grammar too big to compile: once more with half the sources, without native blocks.
              const half = Math.max(
                1,
                Math.ceil((subset?.sources ?? contract.sourceIds).length / 2),
              );
              subset = selectSubset(contract, {
                text: words,
                inView,
                maxSources: half,
                extra: half,
              });
              if (subset.sources.length >= contract.sourceIds.length) {
                subset = { ...subset, sources: subset.sources.slice(0, half) };
              }
              native = false;
              ready = prepare(contract, subset, native);
              continue;
            }
            throw plannerError(error);
          }
          usage.input += reply.usage.input_tokens;
          usage.output += reply.usage.output_tokens;
          usage.cacheRead += reply.usage.cache_read_input_tokens ?? 0;
          usage.cacheWrite += reply.usage.cache_creation_input_tokens ?? 0;
          answeredBy = reply.model;
          if (reply.stop_reason === 'refusal')
            throw new PlannerError('The model declined this request', 502);
          if (reply.stop_reason === 'max_tokens')
            throw new PlannerError('The plan was cut short', 502);
          const text = reply.content
            .flatMap((block) => (block.type === 'text' ? [block.text ?? ''] : []))
            .join('');
          try {
            return { output: JSON.parse(text) as PlannerOutput, text };
          } catch {
            throw new PlannerError('The model returned something other than a plan', 502);
          }
        }
      };

      const first = await ask('planning');
      let output = first.output;
      let operations = toOperations(output);
      let repaired = false;
      const { rejected } = validateOutput(contract, operations);
      if (rejected.length > 0) {
        messages.push(
          { role: 'assistant', content: first.text },
          { role: 'user', content: repairText(rejected) },
        );
        output = (await ask('repairing')).output;
        operations = toOperations(output);
        repaired = true;
      }

      const price = PRICES[answeredBy] ?? PRICES[model];
      const cost = price
        ? (usage.input * price[0] +
            usage.output * price[1] +
            usage.cacheRead * price[2] +
            usage.cacheWrite * price[3]) /
          1_000_000
        : undefined;
      const result: PlanResult = {
        origin: 'model',
        operations,
        status: output.status,
        ...(output.candidates.length > 0 ? { candidates: output.candidates } : {}),
        meta: {
          planner: 'claude',
          model: answeredBy,
          ms: Date.now() - started,
          usage,
          ...(cost === undefined ? {} : { cost: Math.round(cost * 10_000) / 10_000 }),
          ...(subset === undefined ? {} : { subset: [...subset.sources] }),
          ...(repaired ? { repaired } : {}),
          stages,
        },
      };
      return result;
    },
  };
}

/** Streams where the SDK can, counting page elements as they arrive; asks once otherwise. */
async function send(
  api: Messages,
  body: Record<string, unknown>,
  requestOptions: Record<string, unknown>,
  stage: PlanProgress['stage'],
  onProgress: ((progress: PlanProgress) => void) | undefined,
): Promise<Reply> {
  if (typeof api.stream !== 'function')
    return api.create({ ...body, stream: false }, requestOptions);
  const stream = api.stream(body, requestOptions);
  let counted = 0;
  stream.on('text', (_delta, snapshot) => {
    const elements = snapshot.split('"block"').length - 1;
    if (elements !== counted) {
      counted = elements;
      onProgress?.({ stage, elements });
    }
  });
  return stream.finalMessage();
}

function tooComplex(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 400 && error instanceof Error && /too complex|compil/i.test(error.message);
}

function plannerError(error: unknown): unknown {
  if (error instanceof PlannerError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new PlannerError('Anthropic rejected the credentials', 503);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new PlannerError('Anthropic rate limit reached; try again shortly', 429);
  }
  if (error instanceof Anthropic.APIError) {
    return new PlannerError(`Anthropic error ${error.status ?? ''}: ${error.message}`, 502);
  }
  // Missing credentials surface at request time as a plain, untyped Error; its message is
  // the only way to tell it apart.
  if (error instanceof Error && /resolve authentication method/i.test(error.message)) {
    return new PlannerError(NO_CREDENTIALS, 503);
  }
  return error;
}

/** What policy rejected, for the model to repair. */
export function repairText(rejected: readonly OutputRejection[]): string {
  return [
    'The application rejected part of that plan:',
    ...rejected.map((entry) => `- ${changeText(entry.operation.change)}: ${entry.message}`),
    'Return the whole plan again, with these parts fixed or left out.',
  ].join('\n');
}

function changeText(change: Change): string {
  if (change.kind === 'list') return `${change.op} ${change.target} on ${change.surface}`;
  if (change.kind === 'choice') return `${change.surface} set to ${change.value}`;
  if (change.kind === 'page')
    return `page ${change.surface}${change.context ? ` (${change.context})` : ''}`;
  if (change.kind === 'userPage') return `their page ${change.slug}`;
  return `${change.op} in ${change.surface}`;
}
