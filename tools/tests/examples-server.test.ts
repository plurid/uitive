import { readFileSync } from 'node:fs';
import { createUitive, query, remotePlanner, type FetchLike } from '@plurid/uitive-core';
import { parseCuration } from '@plurid/uitive-cli';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { discovery } from '../../docs/examples/adapter/discover.ts';
import { shop } from '../../docs/examples/shop/contract.ts';

// The examples read keys from the environment; a developer's own must never be used here.
let handler: (request: Request) => Promise<Response>;
let client: (typeof import('../../docs/examples/shop/client.ts'))['uitive'];
beforeAll(async () => {
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) {
    vi.stubEnv(key, '');
  }
  ({ handler } = await import('../../docs/examples/server/handler.ts'));
  ({ uitive: client } = await import('../../docs/examples/shop/client.ts'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const order = {
  id: 'ord_41',
  number: 41,
  total: 35,
  currency: 'eur',
  status: 'paid',
  placed: '2026-09-10T09:00:00Z',
  customer: 'CANARY-cus_ada',
};

/** Records what the bindings send, and answers with one order. */
function api() {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ orders: [order] }), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

describe('the shop example', () => {
  it('reads as the signed-in person, letting the API filter what it can', async () => {
    const calls = api();
    const result = await client.data?.load(
      query('orders', {
        fields: ['orders.number', 'orders.total'],
        filter: [{ field: 'orders.status', op: 'eq', values: ['paid'] }],
        limit: 5,
      }),
    );
    expect(result?.rows.map((row) => row['orders.number'])).toEqual([41]);
    expect(calls[0]?.url).toMatch(/^\/api\/orders\?.*status=paid/);
    expect(calls[0]?.init?.credentials).toBe('include');
  });

  it('asks before a write, and runs it after the yes', async () => {
    const calls = api();
    expect(
      (await client.perform('orders.note', { order: 'ord_41', text: 'Gift wrap' })).status,
    ).toBe('refused');
    const stop = client.confirmations();
    const running = client.perform('orders.note', { order: 'ord_41', text: 'Gift wrap' });
    await Promise.resolve();
    const confirmation = client.getSnapshot().confirmation;
    expect(confirmation?.label).toBe('Add note');
    client.confirm(confirmation?.id ?? '');
    expect((await running).status).toBe('done');
    expect(calls.at(-1)?.url).toBe('/api/orders/ord_41/notes');
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ text: 'Gift wrap' });
    stop();
  });

  it('sends a planner the contract and usage, never rows', async () => {
    api();
    await client.data?.load(query('orders', { fields: ['orders.number', 'orders.customer'] }));
    expect(JSON.stringify(client.request('command', 'show paid orders first'))).not.toContain(
      'CANARY',
    );
  });
});

describe('the server example', () => {
  const body = JSON.stringify(
    createUitive({ contract: shop, now: () => 0 }).request('command', 'hide Customers'),
  );
  const post = (headers: Record<string, string> = {}) =>
    handler(
      new Request('https://shop.example/api/uitive/command', { method: 'POST', body, headers }),
    );

  it('plans for signed-in people only', async () => {
    expect((await post({ cookie: 'session=abc' })).status).toBe(200);
    expect((await post()).status).toBe(401);
    expect((await handler(new Request('https://shop.example/api/uitive/command'))).status).toBe(
      404,
    );
  });

  it('answers the client through remotePlanner', async () => {
    const send = vi.fn<FetchLike>((url, init) => handler(new Request(url, init as RequestInit)));
    const planned = createUitive({
      contract: shop,
      now: () => 0,
      planner: remotePlanner({
        url: 'https://shop.example/api/uitive',
        headers: { cookie: 'session=abc' },
        fetch: send,
      }),
    });
    await planned.plan();
    expect(send).toHaveBeenCalledWith('https://shop.example/api/uitive/plan', expect.anything());
  });
});

describe('the curation example', () => {
  it('is a curation the CLI accepts', () => {
    const text = readFileSync(
      new URL('../../docs/examples/agents/curation.json', import.meta.url),
      'utf8',
    );
    expect(parseCuration(JSON.parse(text))).toHaveProperty('curation');
  });
});

describe('the discovery example', () => {
  it('finds the route, its region, the navigation and an action in one snapshot', () => {
    expect(discovery.routes.map((route) => route.path)).toEqual(['/orders']);
    expect(discovery.regions.map((region) => region.name)).toEqual(['orders']);
    expect(discovery.lists.map((list) => list.items)).toEqual([['Orders', 'Customers']]);
    expect(discovery.actions).toEqual([
      { route: 'orders', button: 'Cancel order', action: 'orders.cancel', score: 1 },
    ]);
  });
});
