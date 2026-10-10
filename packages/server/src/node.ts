import type { IncomingMessage, ServerResponse } from 'node:http';

/** A Fetch-standard handler, such as `createUitiveHandler` returns. */
export type FetchHandler = (request: Request) => Promise<Response>;

/** How `toNodeListener` reads requests, and whom it tells when the handler fails. */
export interface NodeListenerOptions {
  /**
   * Largest request body read, in bytes; larger ones are refused unread. It is checked before the
   * handler's own `maxBody`, so raise both together. @default 131072, the handler's default
   */
  maxBody?: number;
  /**
   * Told when the handler throws or its response breaks off; never sees request bodies.
   * @default logs the message to the console
   */
  onError?(error: unknown): void;
}

/** Node's request, with what Express and similar frameworks may add to it. */
export type NodeRequest = IncomingMessage & { originalUrl?: string; body?: unknown };

/** A Node `(request, response)` listener, as `node:http` and Express take one. */
export type NodeListener = (request: NodeRequest, response: ServerResponse) => Promise<void>;

/** The origin every request is given: the Host header is the client's to write, so it names none. */
const ORIGIN = 'http://uitive.invalid';

const answer = (outgoing: ServerResponse, status: number, error: string) => {
  outgoing.writeHead(status, { 'content-type': 'application/json' });
  outgoing.end(JSON.stringify({ error }));
};

/**
 * Serves a Fetch-standard handler from Node's `(request, response)` listeners: Express, Fastify's
 * raw routes and `node:http` alike, in CommonJS or ES modules. A body that middleware such as
 * `express.json()` already parsed is used as it is. Responses stream, so progress lines arrive as
 * they are written, and a request the client abandons is aborted. The request keeps its path and
 * query under a fixed origin, since its Host header proves nothing. The listener never rejects:
 * a request it can't read is answered 400, and a handler that throws, 500.
 *
 * ```ts
 * app.use('/api/uitive', toNodeListener(handler));
 * ```
 */
export function toNodeListener(
  handler: FetchHandler,
  options: NodeListenerOptions = {},
): NodeListener {
  const maxBody = options.maxBody ?? 131_072;
  const report =
    options.onError ??
    ((error: unknown) =>
      console.error(
        '[uitive] the handler failed:',
        error instanceof Error ? error.message : error,
      ));
  return async (incoming, outgoing) => {
    let request: Request | undefined;
    try {
      request = await toRequest(incoming, outgoing, maxBody);
    } catch {
      if (!outgoing.headersSent && !outgoing.destroyed) answer(outgoing, 400, 'Bad request');
      return;
    }
    if (!request) return;
    try {
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        for await (const chunk of response.body) outgoing.write(chunk);
      }
      outgoing.end();
    } catch (error) {
      report(error);
      if (!outgoing.headersSent && !outgoing.destroyed) answer(outgoing, 500, 'Planning failed');
      else outgoing.destroy();
    }
  };
}

/** The Fetch request for a Node one; undefined when it was already answered for being too large. */
async function toRequest(
  incoming: NodeRequest,
  outgoing: ServerResponse,
  maxBody: number,
): Promise<Request | undefined> {
  const target = incoming.originalUrl ?? incoming.url ?? '/';
  const query = target.indexOf('?');
  const url = new URL(ORIGIN);
  url.pathname = query === -1 ? target : target.slice(0, query);
  if (query !== -1) url.search = target.slice(query);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    // The body below is whole, so its length is the platform's to set.
    if (name === 'content-length' || name === 'transfer-encoding') continue;
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      headers.append(name, entry);
    }
  }
  let body: string | Uint8Array<ArrayBuffer> | undefined;
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
    const parsed = incoming.body;
    if (typeof parsed === 'string') body = parsed;
    else if (parsed instanceof Uint8Array) body = new Uint8Array(parsed);
    else if (parsed !== undefined) body = JSON.stringify(parsed);
    else {
      const tooLarge = () => {
        answer(outgoing, 413, 'Request too large');
        incoming.destroy();
        return undefined;
      };
      if (Number(incoming.headers['content-length'] ?? 0) > maxBody) return tooLarge();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += (chunk as Buffer).length;
        if (size > maxBody) return tooLarge();
        chunks.push(chunk as Buffer);
      }
      body = new Uint8Array(Buffer.concat(chunks));
    }
  }
  const controller = new AbortController();
  outgoing.on('close', () => {
    if (!outgoing.writableFinished) controller.abort();
  });
  return new Request(url, {
    method: incoming.method ?? 'GET',
    headers,
    ...(body === undefined ? {} : { body }),
    signal: controller.signal,
  });
}
