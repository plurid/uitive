import type { AnyContract, Planner, PlanRequest } from '@plurid/uitive-core';
import { PlannerError, planRequestSchema } from '@plurid/uitive-planner';

/**
 * What `createUitiveHandler` takes: the contract it serves, who plans, who may ask, and its
 * limits.
 */
export interface HandlerOptions {
  /**
   * The contract the application's clients use; requests made with another are refused with 409.
   */
  contract: AnyContract;
  /** Who plans, such as `modelPlanner({ model })`, with the server's own key. */
  planner: Planner;
  /**
   * Whether a request may plan: the application's own check of the person's session, the one its
   * API makes. Planning spends money, so there is no default. Until the application has one,
   * allowing requests only outside production (`process.env.NODE_ENV !== 'production'`) keeps
   * local development working and refuses everyone once deployed.
   */
  authorize(request: Request): boolean | Promise<boolean>;
  /** Largest request body in bytes. @default 131072 */
  maxBody?: number;
  /** Requests per minute per client, as `client` tells them apart. @default 20 */
  perMinute?: number;
  /**
   * Tells clients apart for `perMinute`. Behind more than one proxy, return the address your own
   * proxy recorded. @default the right-most `X-Forwarded-For` entry, which the proxy in front of
   * the server wrote, else `'local'`, one budget for every request
   */
  client?(request: Request): string;
  /** Told about failures; never sees request bodies. @default logs the message to the console */
  onError?(error: unknown): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const report = (error: unknown) =>
  console.error('[uitive] planning failed:', error instanceof Error ? error.message : error);

/** The address the nearest proxy saw, which a client can't forge by sending the header itself. */
const forwarded = (request: Request) =>
  request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'local';

const WINDOW = 60_000;

/**
 * A Fetch-standard handler: `POST …/plan` and `POST …/command` take a plan request as JSON and
 * answer with a plan result. It owns the contract (clients send only its hash), refuses cross-site
 * requests, checks every request's shape before a planner sees it, never logs bodies, and tells
 * the browser only what failed, never a provider's details. Clients that accept
 * `application/x-ndjson` get progress lines, then the result or an error.
 */
export function createUitiveHandler(
  options: HandlerOptions,
): (request: Request) => Promise<Response> {
  const maxBody = options.maxBody ?? 131_072;
  const perMinute = options.perMinute ?? 20;
  const recent = new Map<string, number[]>();
  let swept = 0;

  /** Whether a client is within its budget, counting this request; old windows are let go. */
  const allowed = (client: string) => {
    const now = Date.now();
    if (now - swept >= WINDOW) {
      for (const [key, times] of recent) {
        if (now - (times.at(-1) ?? 0) >= WINDOW) recent.delete(key);
      }
      swept = now;
    }
    const window = (recent.get(client) ?? []).filter((time) => now - time < WINDOW);
    if (window.length >= perMinute) return false;
    recent.set(client, [...window, now]);
    return true;
  };

  const handle = async (request: Request): Promise<Response> => {
    const kind = new URL(request.url).pathname.split('/').pop();
    if (request.method !== 'POST' || (kind !== 'plan' && kind !== 'command')) {
      return json(404, { error: 'Not found' });
    }
    // A page on another site can't plan with the person's cookies.
    if (request.headers.get('sec-fetch-site') === 'cross-site') {
      return json(403, { error: 'Cross-site requests are refused' });
    }
    // JSON can't be sent cross-origin without a preflight, which the browser asks the server first.
    const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') return json(415, { error: 'Send JSON' });
    if (!(await options.authorize(request))) return json(401, { error: 'Not allowed' });
    if (!allowed((options.client ?? forwarded)(request))) {
      return json(429, { error: 'Too many requests; try again in a minute' });
    }

    const text = await readBody(request, maxBody);
    if (text === undefined) return json(413, { error: 'Request too large' });
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json(400, { error: 'Not JSON' });
    }
    const parsed = planRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const long = parsed.error.issues.some(
        (issue) => issue.path[0] === 'text' && issue.code === 'too_big',
      );
      return json(400, {
        error: long ? 'Commands are at most 500 characters' : 'Not a plan request',
      });
    }
    const body = parsed.data as unknown as PlanRequest;
    if (body.kind !== kind) return json(400, { error: 'Not a plan request' });
    if (body.contract.hash !== options.contract.hash) {
      return json(409, { error: 'The application changed; reload the page' });
    }

    const failure = (error: unknown) => {
      (options.onError ?? report)(error);
      if (error instanceof PlannerError)
        return { status: error.status, error: error.publicMessage };
      if (request.signal.aborted) return { status: 499, error: 'Canceled' };
      return { status: 500, error: 'Planning failed' };
    };

    if (request.headers.get('accept')?.includes('application/x-ndjson')) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const write = (line: unknown) =>
            controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          try {
            const result = await options.planner.plan(body, options.contract, {
              signal: request.signal,
              onProgress: (progress) => write({ type: 'progress', progress }),
            });
            write({ type: 'result', result });
          } catch (error) {
            write({ type: 'error', ...failure(error) });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
      });
    }

    try {
      const result = await options.planner.plan(body, options.contract, { signal: request.signal });
      return json(200, result);
    } catch (error) {
      const { status, error: message } = failure(error);
      return json(status, { error: message });
    }
  };

  return async (request) => {
    try {
      return await handle(request);
    } catch (error) {
      // Such as an `authorize` that throws: answered, never left to crash the server.
      (options.onError ?? report)(error);
      return json(500, { error: 'Planning failed' });
    }
  };
}

/**
 * The body as text, counted in bytes and read no further than `maxBody`; undefined when it is
 * larger, as its declared length may say before anything is read.
 */
async function readBody(request: Request, maxBody: number): Promise<string | undefined> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBody) return undefined;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBody) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
