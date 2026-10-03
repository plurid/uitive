import { z } from 'zod';
import type { AnyContract, AnyPage } from './contract.js';
import { METRICS, type Change, type Metric } from './definition.js';
import type { UsageSummary } from './usage.js';

/**
 * What became of a request in the person's words: done, partly done, not allowed, ambiguous, not
 * something the application can change, or unanswered.
 */
export type CommandStatus =
  | 'done'
  | 'partial'
  | 'not_allowed'
  | 'ambiguous'
  | 'unsupported'
  /** The model planner was unreachable and the local one couldn't help. */
  | 'unavailable';

/** Evidence as a planner claims it. Policy replaces it with values from the local summary. */
export type ClaimedEvidence = { action: string; metric: Metric } | { intent: true };

/**
 * A change a planner proposes, with the evidence it claims; policy checks both before anything
 * applies.
 */
export interface ProposedOperation {
  /** What it would change. */
  change: Change;
  /** What it claims to rest on; policy replaces the figures with the true ones. */
  evidence: readonly ClaimedEvidence[];
  /** A short plain-text note, shown beneath the deterministic reason. */
  note?: string;
  /** For commands: `explicit` when the user named the target, `goal` when it serves their goal. */
  scope?: 'explicit' | 'goal';
}

/** How far a plan has come, for showing progress on long redesigns. */
export interface PlanProgress {
  /** Whether the model is planning, or repairing what policy rejected. */
  stage: 'planning' | 'repairing';
  /** Page elements written so far. */
  elements: number;
}

/**
 * How a plan was made: by which planner and model, how fast, at what cost, and whether it was
 * scoped or repaired.
 */
export interface PlanMeta {
  /** The planner's name. */
  planner: string;
  /** How long planning took, in milliseconds. */
  ms: number;
  /** The sources the request was scoped to, for large contracts. */
  subset?: readonly string[];
  /** A second round fixed what policy rejected in the first. */
  repaired?: boolean;
  /** Model calls made. */
  stages?: number;
  /** The model that planned, for model planners. */
  model?: string;
  /** Why a fallback planner answered instead. */
  fellBack?: string;
  /** Tokens the model read and wrote, and what the prompt cache saved. */
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Estimated cost in US dollars. */
  cost?: number;
}

/**
 * What a planner answers: proposed operations, a status for commands, and how the plan was made.
 */
export interface PlanResult {
  /** Which planner produced the operations. */
  origin: 'heuristic' | 'model';
  /** The proposed operations, for policy to check. */
  operations: readonly ProposedOperation[];
  /** For commands: what became of the request. */
  status?: CommandStatus;
  /** For ambiguous commands: what the words could mean. */
  candidates?: readonly string[];
  /** How the plan was made. */
  meta: PlanMeta;
}

/** The current interface, as a planner sees it: IDs only. */
export interface StateView {
  /** Each list's visible and pinned items, per context value in view. */
  lists: readonly {
    surface: string;
    context?: string;
    visible: readonly string[];
    pinned: readonly string[];
  }[];
  /** Each choice's value. */
  choices: Readonly<Record<string, string>>;
  /** Each collection's item IDs. */
  collections: Readonly<Record<string, readonly string[]>>;
  /** The pages in view now, as they are. */
  pages: readonly { surface: string; context?: string; value: AnyPage }[];
  /** The pages the user made. */
  userPages: readonly { slug: string; title: string }[];
  /** The user's own page in view, if any. */
  userPage?: { slug: string; value: AnyPage };
  /** Operation keys the user decided themselves; planners leave these alone. */
  user: readonly string[];
  /** Operation keys cooling down after a revert. */
  cooldowns: readonly string[];
  /** Operation keys reverted twice, never proposed again. */
  blocked: readonly string[];
  /** Whether the person froze planned changes. */
  frozen: boolean;
  /** How the user answered recent changes. */
  recent: readonly { key: string; outcome: 'kept' | 'reverted' }[];
}

/**
 * The shape of a page the application doesn't describe itself, as a browser extension sees it:
 * which anchors and sources it found. Structure only; never the page's text.
 */
export interface Environment {
  /** The adapter route the page matched. */
  route: string | null;
  /** Whether each anchor was found once, not at all, or more than once. */
  anchors: Readonly<Record<string, 'found' | 'missing' | 'ambiguous'>>;
  /** Whether each source could be read. */
  sources: Readonly<Record<string, 'live' | 'partial' | 'unavailable'>>;
  /** What the adapter doesn't know about, counted and never named. */
  unmapped: { links: number; buttons: number; tables: number };
}

/** Everything a planner receives. This is all that leaves the device. */
export interface PlanRequest {
  /** A plan from use, or a command in the person's words. */
  kind: 'plan' | 'command';
  /** The contract's ID and hash; the server holds the contract itself. */
  contract: { id: string; hash: string };
  /** The current session. */
  session: number;
  /** Usage, as numbers. */
  summary: UsageSummary;
  /** The interface as it is, as IDs. */
  state: StateView;
  /** Context values active now, by context name. */
  contexts: Readonly<Record<string, string>>;
  /** The route in view; never the row it shows. */
  route?: string;
  /** The command, in the user's words. */
  text?: string;
  /** The goal the user stated, in their words. */
  goal?: string;
  /** For pages Uitive adapts from outside, such as in the extension: what was found. */
  environment?: Environment;
}

/**
 * What a planner may be given besides the request: a way to cancel, and a listener for progress.
 */
export interface PlanOptions {
  /** An `AbortSignal` where the platform has one. */
  signal?: unknown;
  /** Called as the plan arrives; planners that can't stream never call it. */
  onProgress?: (progress: PlanProgress) => void;
}

/**
 * Something that plans: the deterministic planner, a remote one, or a model planner on a server.
 */
export interface Planner {
  /** The planner's name, as plans report it. */
  readonly name: string;
  /** Proposes operations for a request. It sees schemas and usage, never rows. */
  plan(request: PlanRequest, contract: AnyContract, options?: PlanOptions): Promise<PlanResult>;
}

/** A response body read as a stream, for progress lines: the platform's `ReadableStream` fits. */
export interface PlannerStream {
  /** Reads the body chunk by chunk. */
  getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> };
}

/** What `remotePlanner` reads from a response: the platform's `Response` fits. */
export interface PlannerResponse {
  /** Whether the status is in the 200s. */
  ok: boolean;
  /** The HTTP status. */
  status: number;
  /** The body, parsed. */
  json(): Promise<unknown>;
  /** The response's headers, for its content type. */
  headers?: { get(name: string): string | null };
  /** The body as a stream, when progress lines arrive. */
  body?: PlannerStream | null;
}

/**
 * The `fetch` `remotePlanner` calls: the platform's, or one that adds what a site needs, such as a
 * header.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: unknown },
) => Promise<PlannerResponse>;

const changeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('list'),
    surface: z.string(),
    context: z.string().optional(),
    op: z.enum(['promote', 'demote', 'move', 'pin', 'unpin', 'hide', 'restore']),
    target: z.string(),
    index: z.number().int().optional(),
    evict: z.string().optional(),
  }),
  z.object({
    kind: z.literal('choice'),
    surface: z.string(),
    op: z.literal('set'),
    value: z.string(),
  }),
  z.object({
    kind: z.literal('collection'),
    surface: z.string(),
    op: z.enum(['add', 'update', 'remove']),
    item: z.string(),
    value: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal('page'),
    surface: z.string(),
    context: z.string().optional(),
    op: z.enum(['set', 'reset']),
    value: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal('userPage'),
    surface: z.literal('userPages'),
    op: z.enum(['create', 'rename', 'set', 'delete']),
    slug: z.string(),
    title: z.string().optional(),
    value: z.unknown().optional(),
  }),
]);

/** Validates a plan result that arrived over the network. */
export const planResultSchema = z.object({
  origin: z.enum(['heuristic', 'model']),
  operations: z.array(
    z.object({
      change: changeSchema,
      evidence: z.array(
        z.union([
          z.object({ action: z.string(), metric: z.enum(METRICS as [Metric, ...Metric[]]) }),
          z.object({ intent: z.literal(true) }),
        ]),
      ),
      note: z.string().optional(),
      scope: z.enum(['explicit', 'goal']).optional(),
    }),
  ),
  status: z
    .enum(['done', 'partial', 'not_allowed', 'ambiguous', 'unsupported', 'unavailable'])
    .optional(),
  candidates: z.array(z.string()).optional(),
  meta: z.object({
    planner: z.string(),
    ms: z.number(),
    model: z.string().optional(),
    fellBack: z.string().optional(),
    usage: z
      .object({
        input: z.number(),
        output: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
      })
      .optional(),
    cost: z.number().optional(),
    subset: z.array(z.string()).optional(),
    repaired: z.boolean().optional(),
    stages: z.number().optional(),
  }),
});

/** Where `remotePlanner` sends requests, and what answers when the server can't. */
export interface RemotePlannerOptions {
  /** The handler's base URL; requests go to `<url>/plan` and `<url>/command`. */
  url: string;
  /** Answers when the server can't. */
  fallback?: Planner;
  /** The `fetch` it calls. @default globalThis.fetch */
  fetch?: FetchLike;
  /** How long to wait before the fallback answers. @default 60000 for plans, 20000 for commands */
  timeoutMs?: number;
  /** Headers sent with every request, such as one the server's `authorize` reads. */
  headers?: Record<string, string>;
}

/** Asks a server-side planner, falling back locally on any failure, with the reason recorded. */
export function remotePlanner(options: RemotePlannerOptions): Planner {
  return {
    name: 'remote',
    async plan(request, contract, planOptions = {}) {
      const started = Date.now();
      try {
        const send = options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
        if (!send) throw new Error('fetch is unavailable');
        const timeout = options.timeoutMs ?? (request.kind === 'plan' ? 60_000 : 20_000);
        const signals = (globalThis as { AbortSignal?: { timeout?(ms: number): unknown } })
          .AbortSignal;
        const streaming = planOptions.onProgress !== undefined;
        const response = await send(`${options.url.replace(/\/$/, '')}/${request.kind}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(streaming ? { accept: 'application/x-ndjson' } : {}),
            ...options.headers,
          },
          body: JSON.stringify(request),
          signal: planOptions.signal ?? signals?.timeout?.(timeout),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => undefined)) as
            { error?: unknown } | undefined;
          const reason = typeof body?.error === 'string' ? `: ${body.error}` : '';
          throw new Error(`server answered ${response.status}${reason}`);
        }
        const ndjson = response.headers?.get('content-type')?.includes('ndjson') && response.body;
        const result = ndjson
          ? await readStream(response.body as PlannerStream, planOptions.onProgress)
          : await response.json();
        return planResultSchema.parse(result) as PlanResult;
      } catch (error) {
        if (!options.fallback) throw error;
        const result = await options.fallback.plan(request, contract);
        const reason = error instanceof Error ? error.message : String(error);
        return { ...result, meta: { ...result.meta, ms: Date.now() - started, fellBack: reason } };
      }
    },
  };
}

interface DecoderLike {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}

/** Reads a planner's NDJSON answer: progress lines, then the result, or an error. */
async function readStream(
  body: PlannerStream,
  onProgress: ((progress: PlanProgress) => void) | undefined,
): Promise<unknown> {
  const Decoder = (globalThis as { TextDecoder?: new () => DecoderLike }).TextDecoder;
  if (!Decoder) throw new Error('TextDecoder is unavailable');
  const decoder = new Decoder();
  const reader = body.getReader();
  let buffer = '';
  let result: unknown;
  const handle = (line: string) => {
    if (line.trim() === '') return;
    const message = JSON.parse(line) as {
      type?: string;
      progress?: PlanProgress;
      result?: unknown;
      error?: string;
    };
    if (message.type === 'progress' && message.progress) onProgress?.(message.progress);
    else if (message.type === 'result') result = message.result;
    else if (message.type === 'error') throw new Error(message.error ?? 'planning failed');
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handle(line);
    if (done) break;
  }
  handle(buffer);
  if (result === undefined) throw new Error('the server ended without a plan');
  return result;
}
