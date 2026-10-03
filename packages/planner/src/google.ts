import type { FetchLike } from '@plurid/aptuitive-core';
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

/** How `google()` calls Gemini: which model, with which key, and how it keeps to the schema. */
export interface GoogleOptions {
  /** The model, such as `gemini-3.8-flash`. */
  model: string;
  /** The API key. @default GEMINI_API_KEY, else GOOGLE_API_KEY, from the environment */
  apiKey?: string;
  /** The API's base URL. @default 'https://generativelanguage.googleapis.com/v1beta' */
  baseURL?: string;
  /**
   * How the model keeps to the schema: `schema` for structured output, `json` for JSON with the
   * schema in the prompt, `text` for neither. @default 'schema'
   */
  structured?: 'schema' | 'json' | 'text';
  /** Most tokens the model may spend thinking, for models that think. */
  thinkingBudget?: number;
  /** How long a call may take before it fails. @default 60000 */
  timeoutMs?: number;
  /** US dollars per million tokens, to report what plans cost. */
  prices?: ModelPrices;
  /** The `fetch` it calls. @default globalThis.fetch */
  fetch?: FetchLike;
}

interface Chunk {
  modelVersion?: string;
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

/** Finish reasons that mean the model declined, rather than finished or ran out of tokens. */
const DECLINED = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
]);

/**
 * Gemini, through the Gemini API's structured output: the provider constrains each answer to the
 * schema (`responseJsonSchema`). The rules and the contract lead every call unchanged, which
 * Gemini's implicit caching rewards. Calls `fetch`: no SDK.
 */
export function google(options: GoogleOptions): Model {
  const base = (options.baseURL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/+$/,
    '',
  );
  const structured = options.structured ?? 'schema';
  return {
    provider: 'google',
    name: options.model,
    structured,
    async generate(call) {
      const send = options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
      if (!send) throw new PlannerError('fetch is unavailable', 500);
      const key = options.apiKey ?? environment('GEMINI_API_KEY') ?? environment('GOOGLE_API_KEY');
      if (key === undefined) {
        throw new PlannerError('No Gemini credentials: set GEMINI_API_KEY', 503);
      }
      const body = {
        systemInstruction: { parts: [{ text: call.rules }, { text: call.contract }] },
        contents: call.messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          maxOutputTokens: call.maxTokens,
          ...(structured === 'text' ? {} : { responseMimeType: 'application/json' }),
          ...(structured === 'schema' ? { responseJsonSchema: withoutConst(call.schema) } : {}),
          ...(options.thinkingBudget === undefined
            ? {}
            : { thinkingConfig: { thinkingBudget: options.thinkingBudget } }),
        },
      };
      let response;
      try {
        response = await send(
          `${base}/models/${encodeURIComponent(options.model)}:streamGenerateContent?alt=sse`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(body),
            signal: deadline(call.signal, options.timeoutMs ?? 60_000),
          },
        );
      } catch (error) {
        throw new PlannerError(`Gemini couldn't be reached: ${(error as Error).message}`, 502);
      }
      if (!response.ok) throw await failure(response, 'Gemini');

      let text = '';
      let finish: string | undefined;
      let blocked = false;
      let model = options.model;
      let usage: Chunk['usageMetadata'];
      const take = (chunk: Chunk) => {
        model = chunk.modelVersion ?? model;
        if (chunk.promptFeedback?.blockReason) blocked = true;
        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          // Thoughts aren't the answer.
          if (part.text && !part.thought) text += part.text;
        }
        call.onText?.(text);
        if (candidate?.finishReason) finish = candidate.finishReason;
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
      };
      if (response.body) {
        await readEvents(response.body, (data) => take(JSON.parse(data) as Chunk));
      } else {
        take((await response.json()) as Chunk);
      }

      const cached = usage?.cachedContentTokenCount ?? 0;
      const used = {
        input: Math.max(0, (usage?.promptTokenCount ?? 0) - cached),
        output: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        cacheRead: cached,
        cacheWrite: 0,
      };
      const cost = costOf(used, options.prices);
      const reply: ModelReply = {
        text,
        stop:
          blocked || (finish !== undefined && DECLINED.has(finish))
            ? 'refused'
            : finish === 'MAX_TOKENS'
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
