import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discover } from './discover.js';

const chrome = existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

const layout = (
  title: string,
  body: string,
) => `<!doctype html><html><head><title>${title}</title></head><body>
<nav aria-label="Main"><a href="/orders">Orders</a> <a href="/customers">Customers</a> <a href="/logout">Log out</a></nav>
<main><h1>${title}</h1>${body}</main></body></html>`;

const pages: Record<string, string> = {
  '/': layout('Home', '<p>Welcome back.</p>'),
  '/orders': layout(
    'Orders',
    '<button>Export</button><table><tr><th>Order</th><th>Total</th></tr>' +
      '<tr><td><a href="/orders/order_01J9ZK2V7Q8N4X3C5B6M1A0P9R">#1042</a></td><td>€120.00</td></tr>' +
      '<tr><td><a href="/orders/order_01J9ZK1T5R7M3W2B4A5N0Z8Q7P">#1041</a></td><td>€64.50</td></tr>' +
      '<tr><td><a href="/orders/order_01J9ZK0S4Q6L2V1A3Z4M9Y7P6N">#1040</a></td><td>€8.00</td></tr></table>',
  ),
  '/customers': layout('Customers', '<button>Add customer</button>'),
  '/logout': layout('Signed out', ''),
};

describe.skipIf(!chrome)('discover', () => {
  it('crawls same-origin links, at most twice per route, and never follows sign-out links', async () => {
    const hits: string[] = [];
    const server = createServer((request, response) => {
      const path = request.url ?? '/';
      hits.push(path);
      const body =
        pages[path] ??
        (path.startsWith('/orders/')
          ? layout(
              'Order',
              '<button>Cancel order</button><button>Archive</button><button>Refund</button>',
            )
          : undefined);
      response
        .writeHead(body ? 200 : 404, { 'content-type': 'text/html' })
        .end(body ?? 'Not found');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const cwd = await mkdtemp(join(tmpdir(), 'aptuitive-'));
    await writeFile(join(cwd, 'package.json'), '{}');
    try {
      const result = await discover({ url: `http://127.0.0.1:${port}/`, cwd, chrome: true });
      expect(hits).not.toContain('/logout');
      expect(result.visited.map((url) => new URL(url).pathname)).toEqual([
        '/',
        '/orders',
        '/customers',
        '/orders/order_01J9ZK2V7Q8N4X3C5B6M1A0P9R',
        '/orders/order_01J9ZK1T5R7M3W2B4A5N0Z8Q7P',
      ]);
      expect(result.discovery.routes.map((route) => route.path)).toEqual([
        '/',
        '/orders',
        '/customers',
        '/orders/:id',
      ]);
      expect(result.discovery.lists).toContainEqual({
        name: 'ordersDetailToolbar',
        label: 'Order toolbar',
        route: 'orders.detail',
        items: ['Cancel order', 'Archive', 'Refund'],
      });
      const saved = JSON.parse(await readFile(join(cwd, result.file), 'utf8'));
      expect(saved.routes).toHaveLength(4);
    } finally {
      server.close();
    }
  }, 60_000);
});
