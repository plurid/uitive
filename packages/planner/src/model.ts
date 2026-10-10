/** What a browser is told for each status: never a provider's words or a server's name. */
const PUBLIC: Readonly<Record<number, string>> = {
  429: 'The model is busy; try again shortly',
  499: 'Canceled',
  502: "The model couldn't make a plan",
  503: 'Planning is unavailable',
};

/**
 * A planner failure, with the HTTP status the handler answers with. Its `message` may hold a
 * provider's own words and the address of a model's server, so only `onError` hears it; the
 * browser gets `publicMessage`.
 */
export class PlannerError extends Error {
  /** What the handler tells the browser: fixed for each status, so details stay on the server. */
  readonly publicMessage: string;

  constructor(
    message: string,
    readonly status: number,
    /** `too-complex` when the provider couldn't take the schema, so a smaller scope may pass. */
    readonly reason?: 'too-complex',
  ) {
    super(message);
    this.publicMessage = PUBLIC[status] ?? 'Planning failed';
  }
}

/**
 * A call that failed before the provider finished answering: canceled by the caller, timed out,
 * or cut off, as the status the handler answers with.
 */
export function interrupted(error: unknown, caller: unknown, provider: string): PlannerError {
  if (error instanceof PlannerError) return error;
  if ((caller as { aborted?: boolean } | undefined)?.aborted)
    return new PlannerError('Canceled', 499);
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError') return new PlannerError(`${provider} timed out`, 502);
  const message = error instanceof Error ? error.message : String(error);
  return new PlannerError(`${provider} couldn't be reached: ${message}`, 502);
}

/** One message of a planning conversation: the request, and for a repair, the answer and what to fix. */
export interface ModelMessage {
  /** Who wrote it. */
  role: 'user' | 'assistant';
  /** What it says. */
  content: string;
}

/** What one call to a model takes: instructions, the conversation, the schema and its limits. */
export interface ModelCall {
  /** The planner's rules: the same for every call. */
  rules: string;
  /** The contract as text: the same for every request about it, so providers can cache it. */
  contract: string;
  /** The conversation so far. */
  messages: readonly ModelMessage[];
  /** The JSON Schema the answer must follow, as `outputSchema` compiles it. */
  schema: Record<string, unknown>;
  /** Most tokens the model may write, thinking included. */
  maxTokens: number;
  /** An `AbortSignal` that cancels the call, such as when the person leaves. */
  signal?: unknown;
  /** Hears the answer so far, as it streams. */
  onText?: (snapshot: string) => void;
}

/** Tokens a call used. */
export interface ModelUsage {
  /** Tokens read, besides those from the cache. */
  input: number;
  /** Tokens written, thinking included. */
  output: number;
  /** Tokens read from the provider's prompt cache. */
  cacheRead: number;
  /** Tokens written to the provider's prompt cache. */
  cacheWrite: number;
}

/** What a model answered, how it stopped, and what it used. */
export interface ModelReply {
  /** The answer as text: JSON, when the model kept to the schema. */
  text: string;
  /** `refused` when the model declined, `cut` when it ran out of tokens. */
  stop: 'done' | 'refused' | 'cut';
  /** The model that answered, which may differ from the one asked, after a fallback. */
  model: string;
  /** Tokens used. */
  usage: ModelUsage;
  /** What the call cost in US dollars, when the model's prices are known. */
  cost?: number;
}

/**
 * A language model that plans, from any provider: `anthropic()`, `openai()` for OpenAI and every
 * server that speaks its API, `google()`, or one of your own.
 */
export interface Model {
  /** The provider, as plan results report it, such as `openai`. */
  readonly provider: string;
  /** The model's name, such as `gpt-6.1-sol`. */
  readonly name: string;
  /**
   * How the model keeps to the schema. `schema`: the provider constrains the answer to it. `json`:
   * the answer is JSON, and the schema goes in the prompt. `text`: neither. Answers are checked
   * against the schema either way, and repaired once when they stray.
   */
  readonly structured: 'schema' | 'json' | 'text';
  /** Calls the model; failures throw a `PlannerError` with the status the handler answers. */
  generate(call: ModelCall): Promise<ModelReply>;
}

/** US dollars per million tokens, for reporting what plans cost. */
export interface ModelPrices {
  /** Tokens read. */
  input: number;
  /** Tokens written. */
  output: number;
  /** Tokens read from the cache. @default input */
  cacheRead?: number;
  /** Tokens written to the cache. @default input */
  cacheWrite?: number;
}

/** What a call cost in US dollars, from its usage and the model's prices. */
export function costOf(usage: ModelUsage, prices: ModelPrices | undefined): number | undefined {
  if (!prices) return undefined;
  const dollars =
    (usage.input * prices.input +
      usage.output * prices.output +
      usage.cacheRead * (prices.cacheRead ?? prices.input) +
      usage.cacheWrite * (prices.cacheWrite ?? prices.input)) /
    1_000_000;
  return Math.round(dollars * 10_000) / 10_000;
}

/** An environment variable, where there is an environment; never a Node import. */
export function environment(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];
  return value === undefined || value === '' ? undefined : value;
}

interface SignalLike {
  aborted: boolean;
  reason?: unknown;
  addEventListener(type: 'abort', listener: () => void): void;
}

/** The signal a call runs under: the caller's and a timeout together, so neither drops the other. */
export function deadline(signal: unknown, timeoutMs: number): unknown {
  const platform = globalThis as {
    AbortSignal?: { timeout?(ms: number): unknown; any?(signals: unknown[]): unknown };
    AbortController?: new () => { signal: unknown; abort(reason?: unknown): void };
  };
  const timeout = platform.AbortSignal?.timeout?.(timeoutMs);
  if (signal === undefined || timeout === undefined) return signal ?? timeout;
  if (platform.AbortSignal?.any) return platform.AbortSignal.any([signal, timeout]);
  if (!platform.AbortController) return signal;
  const either = new platform.AbortController();
  for (const source of [signal, timeout] as SignalLike[]) {
    if (source.aborted) either.abort(source.reason);
    else source.addEventListener('abort', () => either.abort(source.reason));
  }
  return either.signal;
}
