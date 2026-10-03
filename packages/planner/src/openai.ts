import type { FetchLike } from '@plurid/uitive-core';
import { withoutConst } from './answer.js';
import { failure, readEvents } from './events.js';
import {
  costOf,
  deadline,
  environment,
  PlannerError,
  type Model,
  type ModelPrices,
  type ModelReply,
} from './model.js';

/**
 * How `openai()` calls a model through OpenAI's Chat Completions API, which many providers and
 * local servers speak too: which model, where, with which key, and how it keeps to the schema.
 */
export interface OpenAIOptions {
  /** The model, such as `gpt-6.1-sol`, or one a compatible server offers, such as `qwen3` on Ollama. */
  model: string;
  /** The API key. @default OPENAI_API_KEY from the environment, for OpenAI's own API */
  apiKey?: string;
  /**
   * The API's base URL, for compatible servers: `http://localhost:11434/v1` for Ollama,
   * `https://openrouter.ai/api/v1` for OpenRouter. @default 'https://api.openai.com/v1'
   */
  baseURL?: string;
  /** Headers sent with every call, such as a provider's own. */
  headers?: Readonly<Record<string, string>>;
  /**
   * How the model keeps to the schema: `schema` for structured outputs, `json` for JSON mode with the
   * schema in the prompt, `text` for neither. @default 'schema'
   */
  structured?: 'schema' | 'json' | 'text';
  /** How much a reasoning model thinks before answering, where the model takes it. */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  /** How long a call may take before it fails. @default 60000 */
  timeoutMs?: number;
  /** US dollars per million tokens, to report what plans cost. */
  prices?: ModelPrices;
  /** The `fetch` it calls. @default globalThis.fetch */
  fetch?: FetchLike;
}

interface Chunk {
  model?: string;
  choices?: {
    delta?: { content?: string | null; refusal?: string | null };
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  } | null;
}

/**
 * A model behind OpenAI's Chat Completions API: OpenAI's own, or any compatible server, such as
 * Ollama, vLLM, LM Studio, OpenRouter or Groq. Uses structured outputs (strict JSON Schema) by
 * default; `structured: 'json'` or `'text'` suits servers without them. Calls `fetch`: no SDK.
 */
export function openai(options: OpenAIOptions): Model {
  const base = (options.baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const own = /^https:\/\/api\.openai\.com\//.test(`${base}/`);
  const provider = own ? 'OpenAI' : hostOf(base);
  const structured = options.structured ?? 'schema';
  return {
    provider: 'openai',
    name: options.model,
    structured,
    async generate(call) {
      const send = options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
      if (!send) throw new PlannerError('fetch is unavailable', 500);
      const key = options.apiKey ?? (own ? environment('OPENAI_API_KEY') : undefined);
      if (own && key === undefined) {
        throw new PlannerError('No OpenAI credentials: set OPENAI_API_KEY', 503);
      }
      const format =
        structured === 'schema'
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: 'plan', strict: true, schema: withoutConst(call.schema) },
              },
            }
          : structured === 'json'
            ? { response_format: { type: 'json_object' } }
            : {};
      const body = {
        model: options.model,
        // The rules and the contract lead, unchanged between calls, so providers cache them.
        messages: [
          { role: 'system', content: `${call.rules}\n\n${call.contract}` },
          ...call.messages,
        ],
        // OpenAI's own API takes the newer name; compatible servers mostly know only the older one.
        [own ? 'max_completion_tokens' : 'max_tokens']: call.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        ...format,
        ...(options.reasoningEffort === undefined
          ? {}
          : { reasoning_effort: options.reasoningEffort }),
      };
      let response;
      try {
        response = await send(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
            ...options.headers,
          },
          body: JSON.stringify(body),
          signal: deadline(call.signal, options.timeoutMs ?? 60_000),
        });
      } catch (error) {
        throw new PlannerError(`${provider} couldn't be reached: ${(error as Error).message}`, 502);
      }
      if (!response.ok) throw await failure(response, provider);

      let text = '';
      let refusal = '';
      let finish: string | null | undefined;
      let model = options.model;
      let usage: Chunk['usage'];
      const take = (chunk: Chunk) => {
        model = chunk.model ?? model;
        const choice = chunk.choices?.[0];
        const part = choice?.delta ?? choice?.message;
        if (part?.content) {
          text += part.content;
          call.onText?.(text);
        }
        if (part?.refusal) refusal += part.refusal;
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (chunk.usage) usage = chunk.usage;
      };
      const streamed = response.headers?.get('content-type')?.includes('event-stream');
      if (streamed && response.body) {
        await readEvents(response.body, (data) => {
          if (data !== '[DONE]') take(JSON.parse(data) as Chunk);
        });
      } else {
        // A server that ignored `stream` answers in one piece.
        take((await response.json()) as Chunk);
      }

      const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const used = {
        input: Math.max(0, (usage?.prompt_tokens ?? 0) - cached),
        output: usage?.completion_tokens ?? 0,
        cacheRead: cached,
        cacheWrite: 0,
      };
      const cost = costOf(used, options.prices);
      const reply: ModelReply = {
        text,
        stop:
          refusal !== '' || finish === 'content_filter'
            ? 'refused'
            : finish === 'length'
              ? 'cut'
              : 'done',
        model,
        usage: used,
        ...(cost === undefined ? {} : { cost }),
      };
      return reply;
    },
  };
}

const hostOf = (url: string) => /^[a-z]+:\/\/([^/]+)/i.exec(url)?.[1] ?? url;
