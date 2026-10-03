import type { AnyContract, Planner, PlanRequest } from '@plurid/aptuitive-core';
import { PlannerError } from '@plurid/aptuitive-planner';

/**
 * What `createAptuitiveHandler` takes: the contract it serves, who plans, who may ask, and its
 * limits.
 */
export interface HandlerOptions {
  /**
   * The contract the application's clients use; requests made with another are refused with 409.
   */
  contract: AnyContract;
  /** Who plans, such as `anthropicPlanner()`, which reads the server's own key. */
  planner: Planner;
  /**
   * Whether a request may plan. Planning spends money, so the default only allows requests
   * whose host is localhost; production needs a real check.
   */
  authorize?(request: Request): boolean | Promise<boolean>;
  /** Largest request body in bytes. @default 131072 */
  maxBody?: number;
  /** Requests per minute per client. @default 20 */
  perMinute?: number;
  /** Told about failures; never sees request bodies. @default logs the message to the console */
  onError?(error: unknown): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const report = (error: unknown) =>
  console.error('[aptuitive] planning failed:', error instanceof Error ? error.message : error);

const local = (request: Request) => {
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
};

/**
 * A Fetch-standard handler: `POST …/plan` and `POST …/command` take a plan request and answer
 * with a plan result. It owns the contract (clients send only its hash) and never logs bodies.
 * Clients that accept `application/x-ndjson` get progress lines, then the result or an error.
 */
export function createAptuitiveHandler(
  options: HandlerOptions,
): (request: Request) => Promise<Response> {
  const maxBody = options.maxBody ?? 131_072;
  const perMinute = options.perMinute ?? 20;
  const recent = new Map<string, number[]>();

  return async (request) => {
    const kind = new URL(request.url).pathname.split('/').pop();
    if (request.method !== 'POST' || (kind !== 'plan' && kind !== 'command')) {
      return json(404, { error: 'Not found' });
    }
    if (!(await (options.authorize ?? local)(request))) return json(401, { error: 'Not allowed' });

    const client = request.headers.get('x-forwarded-for') ?? 'local';
    const now = Date.now();
    const window = (recent.get(client) ?? []).filter((time) => now - time < 60_000);
    if (window.length >= perMinute)
      return json(429, { error: 'Too many requests; try again in a minute' });
    recent.set(client, [...window, now]);

    const text = await request.text();
    if (text.length > maxBody) return json(413, { error: 'Request too large' });
    let body: PlanRequest;
    try {
      body = JSON.parse(text) as PlanRequest;
    } catch {
      return json(400, { error: 'Not JSON' });
    }
    if (body.kind !== kind || typeof body.summary !== 'object' || typeof body.state !== 'object') {
      return json(400, { error: 'Not a plan request' });
    }
    if (body.contract?.hash !== options.contract.hash) {
      return json(409, { error: 'The application changed; reload the page' });
    }
    if (body.text !== undefined && (typeof body.text !== 'string' || body.text.length > 500)) {
      return json(400, { error: 'Commands are at most 500 characters' });
    }

    const failure = (error: unknown) => {
      (options.onError ?? report)(error);
      if (error instanceof PlannerError) return { status: error.status, error: error.message };
      if (request.signal.aborted) return { status: 499, error: 'Cancelled' };
      return { status: 500, error: 'Planning failed' };
    };

    if (request.headers.get('accept')?.includes('application/x-ndjson')) {
      const encoder = new TextEncoder();
      const planned = body;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const write = (line: unknown) =>
            controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          try {
            const result = await options.planner.plan(planned, options.contract, {
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
}
