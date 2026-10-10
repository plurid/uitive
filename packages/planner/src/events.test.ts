import { describe, expect, it } from 'vitest';
import { readEvents, streamFailure } from './events.js';

/** A stream of these bytes, in chunks of `size`, that says whether it was released. */
function chunked(text: string, size: number) {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += size) chunks.push(bytes.slice(at, at + size));
  let index = 0;
  const state = { canceled: false };
  const body = {
    getReader: () => ({
      read: async () =>
        index < chunks.length
          ? { done: false, value: chunks[index++] }
          : { done: true, value: undefined },
      cancel: async () => {
        state.canceled = true;
      },
    }),
  };
  return { body, state };
}

describe('readEvents', () => {
  it('reads events split anywhere, with CRLF, comments and multibyte characters', async () => {
    const text =
      'data: {"a":"€é"}\r\n\r\n: comment\r\ndata: {"b":1}\r\ndata: {"c":2}\r\n\r\ndata: [DONE]\n\n';
    for (let size = 1; size <= 7; size++) {
      const seen: string[] = [];
      await readEvents(chunked(text, size).body, (data) => seen.push(data));
      expect(seen, `chunks of ${size}`).toEqual(['{"a":"€é"}', '{"b":1}\n{"c":2}', '[DONE]']);
    }
  });

  it('stops and releases the stream when an event fails', async () => {
    const { body, state } = chunked('data: 1\n\ndata: 2\n\ndata: 3\n\n', 4);
    const seen: string[] = [];
    await expect(
      readEvents(body, (data) => {
        seen.push(data);
        if (data === '2') throw new Error('bad event');
      }),
    ).rejects.toThrow('bad event');
    expect(seen).toEqual(['1', '2']);
    expect(state.canceled).toBe(true);
  });
});

describe('streamFailure', () => {
  it('reads error events as the status the handler answers with', () => {
    expect(streamFailure({ message: 'overloaded' }, 'OpenAI')).toMatchObject({
      status: 502,
      message: 'OpenAI failed mid-answer: overloaded',
    });
    expect(streamFailure({ code: 429, message: 'slow down' }, 'Gemini')).toMatchObject({
      status: 429,
    });
    expect(streamFailure({ status: 'RESOURCE_EXHAUSTED' }, 'Gemini')).toMatchObject({
      status: 429,
    });
  });
});
