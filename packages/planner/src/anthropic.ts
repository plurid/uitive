import type Anthropic from '@anthropic-ai/sdk';
import { costOf, PlannerError, type Model, type ModelPrices } from './model.js';

/** US dollars per million tokens, with cache writes at the five-minute rate. */
const PRICES: Readonly<Record<string, ModelPrices>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

const NO_CREDENTIALS = 'No Anthropic credentials: set ANTHROPIC_API_KEY or run `ant auth login`';

/**
 * How `anthropic()` calls Claude: which model, how hard it thinks, how long it may take, and with
 * which key or client.
 */
export interface AnthropicOptions {
  /** The model. @default 'claude-opus-5-5' */
  model?: string;
  /** How much the model thinks before answering; `low` keeps commands quick. @default 'low' */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** How long a call may take before it fails. @default 60000 */
  timeoutMs?: number;
  /** Server-side refusal fallback (beta `server-side-fallback-2026-07-01`). @default true */
  fallbacks?: boolean;
  /** The API key, where there is no environment to read it from, such as in Cloudflare Workers. */
  apiKey?: string;
  /**
   * The Anthropic client, such as one made for a browser extension's worker. @default one from the
   * environment: ANTHROPIC_API_KEY or an `ant auth login` profile
   */
  client?: Pick<Anthropic, 'beta'>;
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

/**
 * Claude, through Anthropic's structured outputs: the provider constrains every answer to the
 * schema. The rules and the contract are marked for prompt caching, so repeated requests about one
 * contract read them from the cache. Needs `@anthropic-ai/sdk`, loaded only when a call is made.
 */
export function anthropic(options: AnthropicOptions = {}): Model {
  const name = options.model ?? 'claude-opus-5-5';
  let client = options.client;
  return {
    provider: 'anthropic',
    name,
    structured: 'schema',
    async generate(call) {
      client ??= await defaultClient(options.apiKey);
      const api = client.beta.messages as unknown as Messages;
      const body = {
        model: name,
        max_tokens: call.maxTokens,
        system: [
          { type: 'text', text: call.rules },
          { type: 'text', text: call.contract, cache_control: { type: 'ephemeral' } },
        ],
        messages: call.messages,
        output_config: {
          effort: options.effort ?? 'low',
          format: { type: 'json_schema', schema: call.schema },
        },
        ...(options.fallbacks === false
          ? {}
          : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      };
      const requestOptions = {
        timeout: options.timeoutMs ?? 60_000,
        maxRetries: 1,
        ...(call.signal === undefined ? {} : { signal: call.signal }),
      };
      let reply: Reply;
      try {
        reply = await send(api, body, requestOptions, call.onText);
      } catch (error) {
        throw anthropicError(error);
      }
      const usage = {
        input: reply.usage.input_tokens,
        output: reply.usage.output_tokens,
        cacheRead: reply.usage.cache_read_input_tokens ?? 0,
        cacheWrite: reply.usage.cache_creation_input_tokens ?? 0,
      };
      const cost = costOf(usage, PRICES[reply.model] ?? PRICES[name]);
      return {
        text: reply.content
          .flatMap((block) => (block.type === 'text' ? [block.text ?? ''] : []))
          .join(''),
        stop:
          reply.stop_reason === 'refusal'
            ? 'refused'
            : reply.stop_reason === 'max_tokens'
              ? 'cut'
              : 'done',
        model: reply.model,
        usage,
        ...(cost === undefined ? {} : { cost }),
      };
    },
  };
}

/** A client from the environment, with the SDK loaded only now, so other providers never need it. */
async function defaultClient(apiKey: string | undefined): Promise<Pick<Anthropic, 'beta'>> {
  let sdk: typeof import('@anthropic-ai/sdk');
  try {
    sdk = await import('@anthropic-ai/sdk');
  } catch {
    throw new PlannerError('Planning with Claude needs @anthropic-ai/sdk installed', 503);
  }
  try {
    return new sdk.default(apiKey === undefined ? {} : { apiKey });
  } catch {
    throw new PlannerError(NO_CREDENTIALS, 503);
  }
}

/** Streams where the SDK can, reporting the answer so far; asks once otherwise. */
async function send(
  api: Messages,
  body: Record<string, unknown>,
  requestOptions: Record<string, unknown>,
  onText: ((snapshot: string) => void) | undefined,
): Promise<Reply> {
  if (typeof api.stream !== 'function')
    return api.create({ ...body, stream: false }, requestOptions);
  const stream = api.stream(body, requestOptions);
  stream.on('text', (_delta, snapshot) => onText?.(snapshot));
  return stream.finalMessage();
}

/** The SDK's errors, as the statuses the handler answers with; read by shape, not by class. */
function anthropicError(error: unknown): unknown {
  if (error instanceof PlannerError) return error;
  const status = (error as { status?: unknown } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 401 || status === 403) {
    return new PlannerError('Anthropic rejected the credentials', 503);
  }
  if (status === 429)
    return new PlannerError('Anthropic rate limit reached; try again shortly', 429);
  if (status === 400 && /too complex|compil/i.test(message)) {
    return new PlannerError(`Anthropic couldn't take the schema: ${message}`, 502, 'too-complex');
  }
  if (typeof status === 'number')
    return new PlannerError(`Anthropic error ${status}: ${message}`, 502);
  // Missing credentials surface at request time as a plain Error; its message is the only sign.
  if (/resolve authentication method/i.test(message)) return new PlannerError(NO_CREDENTIALS, 503);
  if (error instanceof Error && /Connection|Timeout/.test(error.constructor.name)) {
    return new PlannerError(`Anthropic couldn't be reached: ${message}`, 502);
  }
  return error;
}
