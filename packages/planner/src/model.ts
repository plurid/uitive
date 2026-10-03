/** A planner failure, with the HTTP status the handler answers with. */
export class PlannerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** `too-complex` when the provider couldn't take the schema, so a smaller scope may pass. */
    readonly reason?: 'too-complex',
  ) {
    super(message);
  }
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

/** The signal a call runs under: the caller's and a timeout together, where the platform can. */
export function deadline(signal: unknown, timeoutMs: number): unknown {
  const signals = (
    globalThis as {
      AbortSignal?: { timeout?(ms: number): unknown; any?(signals: unknown[]): unknown };
    }
  ).AbortSignal;
  const timeout = signals?.timeout?.(timeoutMs);
  if (signal === undefined) return timeout;
  if (timeout === undefined || !signals?.any) return signal;
  return signals.any([signal, timeout]);
}
