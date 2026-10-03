import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createData, defineApp, field, query, restFetch, restPerform, source } from './index.js';
import type { HttpFetch } from './index.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function server(pages: readonly unknown[]) {
  const calls: Call[] = [];
  let index = 0;
  const fetch: HttpFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    const body = pages[Math.min(index++, pages.length - 1)];
    return { ok: true, status: 200, json: async () => body };
  };
  return { calls, fetch };
}

const charges = source({
  label: 'Charges',
  description: 'Attempts to move money',
  row: z.object({
    id: z.string(),
    amount: field.money({ currency: 'currency', minor: true }),
    currency: z.string(),
    status: field.enum(['succeeded', 'failed']),
    created: field.time({ unit: 's' }),
    brand: z.string().nullable(),
  }),
  key: 'id',
  title: 'id',
  capabilities: {
    filter: { created: ['gte', 'lt'], status: ['eq'] },
    sort: [],
    pagination: 'cursor',
  },
});

const app = defineApp({
  id: 'rest',
  version: '1',
  description: 'A REST API',
  actions: {},
  surfaces: {},
  sources: { charges },
});

describe('restFetch', () => {
  it('turns pushed filters into query parameters and follows cursors', async () => {
    const { calls, fetch } = server([
      {
        object: 'list',
        has_more: true,
        data: [
          {
            id: 'ch_1',
            amount: 1200,
            currency: 'eur',
            status: 'failed',
            created: 1759449600,
            card: { brand: 'visa' },
          },
        ],
      },
      {
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'ch_2',
            amount: 800,
            currency: 'eur',
            status: 'failed',
            created: 1759453200,
            card: { brand: 'amex' },
          },
        ],
      },
    ]);
    const data = createData(
      app,
      restFetch({
        base: 'https://api.example.com',
        fetch,
        headers: () => ({ authorization: 'Bearer test' }),
        sources: {
          charges: {
            path: '/v1/charges',
            rows: '/data',
            more: '/has_more',
            filters: {
              'created:gte': 'created[gte]',
              'created:lt': 'created[lt]',
              'status:eq': 'status',
            },
            pagination: { kind: 'cursor', param: 'starting_after' },
            pick: { brand: '/card/brand' },
          },
        },
      }),
      { now: () => Date.parse('2025-10-03T12:00:00Z') },
    );
    const result = await data.load(
      query('charges', {
        fields: ['charges.id', 'charges.amount', 'charges.brand'],
        filter: [
          { field: 'charges.status', op: 'eq', values: ['failed'] },
          { field: 'charges.created', op: 'gte', values: ['2025-10-03'] },
          { field: 'charges.amount', op: 'gt', values: ['10'] },
        ],
      }),
    );
    expect(calls).toHaveLength(2);
    const first = new URL(calls[0]?.url ?? '');
    expect(first.pathname).toBe('/v1/charges');
    expect(first.searchParams.get('status')).toBe('failed');
    expect(first.searchParams.get('created[gte]')).toBe('1759449600');
    expect(first.searchParams.has('amount')).toBe(false);
    expect(calls[0]?.headers.authorization).toBe('Bearer test');
    expect(new URL(calls[1]?.url ?? '').searchParams.get('starting_after')).toBe('ch_1');
    // The amount filter isn't pushed down: core applies it, in major units.
    expect(result.rows.map((row) => row['charges.id'])).toEqual(['ch_1']);
    expect(result.rows[0]?.['charges.brand']).toBe('visa');
  });
});

describe('restFetch by key', () => {
  it('reads rows one by one from an item endpoint and applies the other filters itself', async () => {
    const { calls, fetch } = server([
      { order: { id: 'o 1', status: 'paid' } },
      { order: { id: 'o2', status: 'pending' } },
    ]);
    const binding = restFetch({
      base: '/admin',
      fetch,
      sources: {
        orders: {
          path: '/orders',
          rows: '/orders',
          limit: '',
          filters: { 'status:in': 'status[]' },
          repeat: ['status[]'],
          item: { path: '/orders/{id}', row: '/order' },
        },
      },
    });
    const result = await binding(
      {
        source: 'orders',
        fields: [],
        filter: [
          { field: 'id', op: 'in', values: ['o 1', 'o2'] },
          { field: 'status', op: 'eq', values: ['paid'] },
        ],
        sort: [],
        limit: 10,
      },
      {},
    );
    expect(calls.map((call) => call.url)).toEqual(['/admin/orders/o%201', '/admin/orders/o2']);
    expect(result.rows).toEqual([{ id: 'o 1', status: 'paid' }]);

    await binding(
      {
        source: 'orders',
        fields: [],
        filter: [{ field: 'status', op: 'in', values: ['paid', 'pending'] }],
        sort: [],
        limit: 10,
      },
      {},
    );
    expect(calls[2]?.url).toBe('/admin/orders?status%5B%5D=paid&status%5B%5D=pending');
  });
});

describe('restPerform', () => {
  it('fills path placeholders and sends the rest as the body', async () => {
    const { calls, fetch } = server([{}]);
    const perform = restPerform({
      base: '',
      fetch,
      idempotency: 'Idempotency-Key',
      actions: {
        'charges.refund': { method: 'POST', path: '/v1/charges/{charge}/refunds', body: 'form' },
        'notes.delete': { method: 'DELETE', path: '/notes/{id}' },
      },
    });
    await perform(
      { charge: 'ch_1', amount: 500, reason: null },
      { action: 'charges.refund', idempotencyKey: 'run-1' },
    );
    await perform({ id: 'n 1' }, { action: 'notes.delete', idempotencyKey: 'run-2' });
    expect(calls[0]).toMatchObject({
      url: '/v1/charges/ch_1/refunds',
      method: 'POST',
      body: 'amount=500',
    });
    expect(calls[0]?.headers['Idempotency-Key']).toBe('run-1');
    expect(calls[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(calls[1]).toMatchObject({ url: '/notes/n%201', method: 'DELETE' });
    expect(calls[1]?.body).toBeUndefined();
  });

  it('says which param a path needs', async () => {
    const { fetch } = server([{}]);
    const perform = restPerform({
      base: '',
      fetch,
      actions: { x: { method: 'POST', path: '/x/{id}' } },
    });
    await expect(perform({}, { action: 'x', idempotencyKey: 'k' })).rejects.toThrow('x needs id');
  });
});
