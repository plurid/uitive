import type { IncomingMessage, ServerResponse } from 'node:http';

/** A Fetch-standard handler, such as `createUitiveHandler` returns. */
export type FetchHandler = (request: Request) => Promise<Response>;

/** How `toNodeListener` reads requests. */
export interface NodeListenerOptions {
  /** Largest request body read, in bytes; larger ones are refused unread. @default 131072 */
  maxBody?: number;
}

/** Node's request, with what Express and similar frameworks may add to it. */
export type NodeRequest = IncomingMessage & { originalUrl?: string; body?: unknown };

/** A Node `(request, response)` listener, as `node:http` and Express take one. */
export type NodeListener = (request: NodeRequest, response: ServerResponse) => Promise<void>;

/**
 * Serves a Fetch-standard handler from Node's `(request, response)` listeners: Express, Fastify's
 * raw routes and `node:http` alike, in CommonJS or ES modules. A body that middleware such as
 * `express.json()` already parsed is used as it is. Responses stream, so progress lines arrive as
 * they are written, and a request the client abandons is aborted.
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
  return async (incoming, outgoing) => {
    const secure = (incoming.socket as { encrypted?: boolean }).encrypted === true;
    const url = new URL(
      incoming.originalUrl ?? incoming.url ?? '/',
      `${secure ? 'https' : 'http'}://${incoming.headers.host ?? 'localhost'}`,
    );
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
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
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of incoming) {
          size += (chunk as Buffer).length;
          if (size > maxBody) {
            outgoing.writeHead(413, { 'content-type': 'application/json' });
            outgoing.end(JSON.stringify({ error: 'Request too large' }));
            incoming.destroy();
            return;
          }
          chunks.push(chunk as Buffer);
        }
        body = new Uint8Array(Buffer.concat(chunks));
      }
    }
    const controller = new AbortController();
    outgoing.on('close', () => {
      if (!outgoing.writableFinished) controller.abort();
    });
    const response = await handler(
      new Request(url, {
        method: incoming.method ?? 'GET',
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      }),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) outgoing.write(chunk);
    }
    outgoing.end();
  };
}
