import { vi } from 'vitest';

const encoder = new TextEncoder();

/** A streamed response of server-sent events, as `fetch` resolves it. */
export function events(items: readonly unknown[], status = 200) {
  const chunks = items.map((item) =>
    encoder.encode(`data: ${typeof item === 'string' ? item : JSON.stringify(item)}\n\n`),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
    json: async () => ({}),
    body: {
      getReader() {
        let index = 0;
        return {
          read: async () =>
            index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined },
        };
      },
    },
  };
}

/** A whole JSON response, as `fetch` resolves it. */
export function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    body: null,
  };
}

/** A `fetch` that answers with this response, keeping what it was asked. */
export function fetching(response: unknown) {
  return vi.fn(
    async (_url: string, _init: { headers: Record<string, string>; body: string }) =>
      response as never,
  );
}
