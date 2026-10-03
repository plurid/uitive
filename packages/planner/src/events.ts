import type { PlannerResponse, PlannerStream } from '@plurid/aptuitive-core';
import { PlannerError } from './model.js';

interface DecoderLike {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}

/** Reads a server-sent event stream, calling `onData` with each event's data. */
export async function readEvents(
  body: PlannerStream,
  onData: (data: string) => void,
): Promise<void> {
  const Decoder = (globalThis as { TextDecoder?: new () => DecoderLike }).TextDecoder;
  if (!Decoder) throw new Error('TextDecoder is unavailable');
  const decoder = new Decoder();
  const reader = body.getReader();
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
  if (
    response.status === 400 &&
    /schema/i.test(message) &&
    /too|exceed|limit|complex|many/i.test(message)
  ) {
    return new PlannerError(`${provider} couldn't take the schema: ${message}`, 502, 'too-complex');
  }
  return new PlannerError(`${provider} error ${response.status}: ${message}`, 502);
}
