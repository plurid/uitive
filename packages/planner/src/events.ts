import type { PlannerResponse, PlannerStream } from '@plurid/uitive-core';
import { PlannerError } from './model.js';

interface DecoderLike {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}

/**
 * Reads a server-sent event stream, calling `onData` with each event's data. When `onData` throws,
 * reading stops and the stream is released.
 */
export async function readEvents(
  body: PlannerStream,
  onData: (data: string) => void,
): Promise<void> {
  const Decoder = (globalThis as { TextDecoder?: new () => DecoderLike }).TextDecoder;
  if (!Decoder) throw new Error('TextDecoder is unavailable');
  const decoder = new Decoder();
  const reader = body.getReader() as ReturnType<PlannerStream['getReader']> & {
    cancel?(): Promise<void>;
  };
  let buffer = '';
  let data: string[] = [];
  const line = (text: string) => {
    if (text === '') {
      if (data.length > 0) onData(data.join('\n'));
      data = [];
    } else if (text.startsWith('data:')) {
      data.push(text.slice(5).replace(/^ /, ''));
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const text of lines) line(text);
      if (done) break;
    }
    line(buffer);
    line('');
  } catch (error) {
    await reader.cancel?.().catch(() => undefined);
    throw error;
  }
}

/** One event's data as JSON, or a failure that says the provider sent something unreadable. */
export function parseEvent(data: string, provider: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    throw new PlannerError(`${provider} sent an unreadable event`, 502);
  }
}

/** A provider's error response, as the status the handler answers with. */
export async function failure(response: PlannerResponse, provider: string): Promise<PlannerError> {
  const body = (await response.json().catch(() => undefined)) as
    { error?: string | { message?: string } } | undefined;
  const message =
    (typeof body?.error === 'string' ? body.error : body?.error?.message) ??
    `status ${response.status}`;
  if (response.status === 401 || response.status === 403) {
    return new PlannerError(`${provider} rejected the credentials`, 503);
  }
  if (response.status === 400 && /api key/i.test(message)) {
    return new PlannerError(`${provider} rejected the credentials`, 503);
  }
  if (response.status === 429) {
    return new PlannerError(`${provider} rate limit reached; try again shortly`, 429);
  }
  // Providers word what their grammars can't take in many ways; any refusal of the schema gets
  // the smaller retry.
  if (response.status === 400 && /schema/i.test(message)) {
    return new PlannerError(`${provider} couldn't take the schema: ${message}`, 502, 'too-complex');
  }
  return new PlannerError(`${provider} error ${response.status}: ${message}`, 502);
}

/** An error event in the middle of a stream, such as `data: {"error": …}`, as a status. */
export function streamFailure(error: unknown, provider: string): PlannerError {
  const detail = (typeof error === 'object' && error !== null ? error : { message: error }) as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    type?: unknown;
  };
  const message = typeof detail.message === 'string' ? detail.message : JSON.stringify(error);
  const busy =
    detail.code === 429 ||
    detail.status === 'RESOURCE_EXHAUSTED' ||
    /rate_limit/.test(`${String(detail.code)} ${String(detail.type)}`);
  return busy
    ? new PlannerError(`${provider} rate limit reached mid-answer`, 429)
    : new PlannerError(`${provider} failed mid-answer: ${message}`, 502);
}
