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
      body { margin: 0; font: 14px/1.5 system-ui, sans-serif; color: #1a1f36; background: #f6f8fa; }
      .top { padding: 12px 20px; background: #fff; border-bottom: 1px solid #e3e8ee; }
      .badge { font-size: 11px; padding: 1px 6px; border-radius: 8px; background: #eef; color: #445; }
      .notice { padding: 8px 20px; background: #fff4e5; border-bottom: 1px solid #f5d9a8; }
      .layout { display: flex; }
      .sidebar { display: flex; flex-direction: column; width: 220px; padding: 12px; gap: 2px; }
      .sidebar a { padding: 6px 10px; border-radius: 6px; color: #1a1f36; text-decoration: none; }
      .sidebar a[aria-current='page'] { background: #e8ecff; color: #3b4cca; }
      main { flex: 1; padding: 20px 28px; }
      .cards { display: flex; gap: 12px; }
      .card { background: #fff; border: 1px solid #e3e8ee; border-radius: 8px; padding: 12px 16px; min-width: 160px; }
      .big { font-size: 22px; margin: 0; }
      table { width: 100%; border-collapse: collapse; background: #fff; }
      th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e3e8ee; }
      .status.failed { color: #c0123c; } .status.succeeded { color: #0e7a3b; }
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
  /** Every API request, for tests that check what was asked. */
  requests: { path: string; authorization: string | undefined }[];
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
    'access-control-allow-headers': 'authorization, content-type',
  });
  response.end(JSON.stringify(body));
};

/** Answers like the payments API: lists with cursors and created ranges, rows by id, keys checked. */
function api(data: Dataset, requests: Dashboard['requests']) {
  return (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'OPTIONS') return json(response, 204, {});
    const url = new URL(request.url ?? '/', 'http://localhost');
    requests.push({
      path: `${url.pathname}${url.search}`,
      authorization: request.headers.authorization,
    });
    const key = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
    if (!/^rk_(test|live)_/.test(key)) {
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
