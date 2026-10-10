import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dataset } from './data.ts';
import type { Dataset, Row } from './data.ts';

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Acme Payments (fictional)</title>
    <style>
      body { margin: 0; font: 15px/1.55 Georgia, 'Times New Roman', serif; color: #2b2118; background: #fbf7f0; }
      .top { padding: 14px 24px; background: #2b2118; color: #fbf7f0; }
      .badge { font: 11px/1.6 system-ui, sans-serif; padding: 1px 7px; border-radius: 3px; background: #e8b04b; color: #2b2118; }
      .notice { padding: 8px 24px; background: #fde9c8; border-bottom: 1px solid #e8b04b; }
      .layout { display: flex; }
      .sidebar { display: flex; flex-direction: column; width: 200px; padding: 16px 12px; gap: 4px; border-right: 1px solid #eadfcd; }
      .sidebar a { padding: 6px 10px; border-radius: 3px; color: #2b2118; text-decoration: none; }
      .sidebar a[aria-current='page'] { background: #2b2118; color: #fbf7f0; }
      main { flex: 1; padding: 24px 32px; }
      .cards { display: flex; gap: 16px; }
      .card { background: #fff; border: 1px solid #eadfcd; border-radius: 3px; padding: 12px 18px; min-width: 160px; }
      .big { font-size: 24px; margin: 0; }
      table { width: 100%; border-collapse: collapse; background: #fff; }
      th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eadfcd; }
      .status.failed { color: #a4301f; } .status.succeeded { color: #3b6e3a; }
      .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script src="/app.js"></script>
  </body>
</html>
`;

const script = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const description = JSON.parse(
  readFileSync(new URL('./openapi.json', import.meta.url), 'utf8'),
) as unknown;

const LISTS: Record<string, keyof Dataset> = {
  charges: 'charges',
  customers: 'customers',
  disputes: 'disputes',
  payouts: 'payouts',
  refunds: 'refunds',
  balance_transactions: 'balance_transactions',
  invoices: 'invoices',
  subscriptions: 'subscriptions',
};

export interface Dashboard {
  /** The dashboard's origin, such as `http://127.0.0.1:4100`. */
  url: string;
  /** The API's origin, a different one, as the real thing would be. */
  api: string;
  /** Every API request, for tests that check what was asked, with the key it carried. */
  requests: { path: string; key: string | undefined }[];
  close(): Promise<void>;
}

const listen = (server: Server, port: number) =>
  new Promise<string>((done) => {
    server.listen(port, '127.0.0.1', () => {
      done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'x-acme-key, content-type',
  });
  response.end(JSON.stringify(body));
};

/**
 * Answers as Acme's API does: its description at /openapi.json, lists with cursors and created
 * ranges, rows by ID, and a read-only key in `x-acme-key` (secret keys are refused).
 */
function api(data: Dataset, requests: Dashboard['requests']) {
  return (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'OPTIONS') return json(response, 204, {});
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/openapi.json') return json(response, 200, description);
    const header = request.headers['x-acme-key'];
    const key = typeof header === 'string' ? header : '';
    requests.push({ path: `${url.pathname}${url.search}`, key: key || undefined });
    if (!/^acme_(test|live)_/.test(key)) {
      return json(response, 401, {
        error: { type: 'invalid_request_error', message: 'Invalid API key' },
      });
    }
    const [, version, resource, id] = url.pathname.split('/');
    const list = resource ? LISTS[resource] : undefined;
    if (version !== 'v1' || !list)
      return json(response, 404, { error: { message: 'Unknown resource' } });
    if (key.includes('nodisputes') && list === 'disputes') {
      return json(response, 403, {
        error: { type: 'invalid_request_error', message: 'The key lacks a permission' },
      });
    }
    const rows = data[list];
    if (id) {
      const row = rows.find((entry) => entry.id === id);
      return row
        ? json(response, 200, row)
        : json(response, 404, { error: { message: 'No such object' } });
    }
    const params = url.searchParams;
    const number = (name: string) => (params.has(name) ? Number(params.get(name)) : undefined);
    const created = {
      gt: number('created[gt]'),
      gte: number('created[gte]'),
      lt: number('created[lt]'),
      lte: number('created[lte]'),
    };
    let found = rows.filter((row: Row) => {
      const at = row.created as number;
      if (created.gt !== undefined && !(at > created.gt)) return false;
      if (created.gte !== undefined && !(at >= created.gte)) return false;
      if (created.lt !== undefined && !(at < created.lt)) return false;
      if (created.lte !== undefined && !(at <= created.lte)) return false;
      for (const field of ['customer', 'charge', 'status', 'payment_intent']) {
        if (params.has(field) && row[field] !== params.get(field)) return false;
      }
      return true;
    });
    found = [...found].sort((a, b) => (b.created as number) - (a.created as number));
    const after = params.get('starting_after');
    if (after) found = found.slice(found.findIndex((row) => row.id === after) + 1);
    const limit = Math.min(Number(params.get('limit') ?? 10), 100);
    json(response, 200, {
      object: 'list',
      data: found.slice(0, limit),
      has_more: found.length > limit,
      url: url.pathname,
    });
  };
}

/** Starts the dashboard and its API, on two origins, with data relative to now. */
export async function startDashboard(
  options: { port?: number; apiPort?: number; now?: number } = {},
): Promise<Dashboard> {
  const data = dataset(options.now ?? Date.now());
  const requests: Dashboard['requests'] = [];
  const site = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(script);
    } else if (path === '/__data') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    } else {
      response.writeHead(200, { 'content-type': 'text/html' }).end(page);
    }
  });
  const service = createServer(api(data, requests));
  const url = await listen(site, options.port ?? 0);
  const apiUrl = await listen(service, options.apiPort ?? 0);
  return {
    url,
    api: apiUrl,
    requests,
    close: () =>
      new Promise<void>((done) => {
        site.close(() => service.close(() => done()));
      }),
  };
}
