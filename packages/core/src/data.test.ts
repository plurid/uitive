import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NOW, payments, rows, sources } from './__fixtures__/payments.js';
import { action, defineApp } from './contract.js';
import { fromRows, runQuery, type Fetch, type FetchRequest } from './data.js';
import { field } from './field.js';
import { query, type Query } from './query.js';
import { source } from './source.js';

const DAY = 86_400;
const clock = { now: NOW * 1000 };

/** The fixture's rows behind a binding that records what it was asked. */
function recorded(data: Record<string, readonly Record<string, unknown>[]> = rows) {
  const requests: FetchRequest[] = [];
  const inner = fromRows(data);
  const fetch: Fetch = (request, context) => {
    requests.push(request);
    return inner(request, context);
  };
  return { fetch, requests };
}

const run = (q: Query, options: { current?: string } = {}, binding = recorded()) =>
  runQuery(payments, binding.fetch, q, { clock, ...options });

const ids = (result: { rows: readonly Record<string, unknown>[] }) =>
  result.rows.map((row) => row['payments.id']);

const major = (row: (typeof rows.payments)[number]) =>
  row.currency === 'jpy' ? row.amount : row.amount / 100;

describe('runQuery', () => {
  it('lets the binding answer what it can, in one page of the limit', async () => {
    const binding = recorded();
    const result = await run(
      query('payments', {
        fields: ['payments.id', 'payments.status'],
        filter: [
          { field: 'payments.status', op: 'eq', values: ['failed'] },
          { field: 'payments.created', op: 'gte', values: ['-60d'] },
        ],
        sort: [{ field: 'payments.created', direction: 'desc' }],
        limit: 5,
      }),
      {},
      binding,
    );
    expect(binding.requests).toHaveLength(1);
    expect(binding.requests[0]).toMatchObject({
      source: 'payments',
      filter: [
        { field: 'status', op: 'eq', values: ['failed'] },
        { field: 'created', op: 'gte', values: [NOW - 60 * DAY] },
      ],
      sort: [{ field: 'created', direction: 'desc' }],
      limit: 5,
    });
    expect(ids(result)).toEqual(['ch_000', 'ch_006', 'ch_012', 'ch_018', 'ch_024']);
    expect(result).toMatchObject({ partial: false, at: NOW * 1000, reads: ['payments'] });
  });

  it('filters, searches and sorts on the client what the binding cannot', async () => {
    const binding = recorded();
    const refunded = await run(
      query('payments', {
        fields: ['payments.id'],
        filter: [{ field: 'payments.refunded', op: 'eq', values: ['true'] }],
      }),
      {},
      binding,
    );
    expect(binding.requests[0]).toMatchObject({ filter: [], limit: 100 });
    expect(ids(refunded)).toEqual(['ch_005', 'ch_018', 'ch_031']);

    const searched = await run(
      query('payments', { fields: ['payments.id'], search: 'order 1003' }),
    );
    expect(ids(searched)).toEqual(['ch_003']);

    const sorted = await run(
      query('payments', {
        fields: ['payments.id', 'payments.amount'],
        sort: [{ field: 'payments.amount', direction: 'desc' }],
        limit: 3,
      }),
    );
    const expected = [...rows.payments].sort((a, b) => major(b) - major(a)).slice(0, 3);
    expect(ids(sorted)).toEqual(expected.map((row) => row.id));
    // Money keeps its currency beside it, for display.
    expect(sorted.rows[0]).toHaveProperty('payments.currency', 'jpy');
  });

  it('compares money in major units, row by row, whatever the currency', async () => {
    const result = await run(
      query('payments', {
        fields: ['payments.id'],
        filter: [{ field: 'payments.amount', op: 'gt', values: ['50'] }],
        limit: 100,
      }),
    );
    expect(ids(result)).toEqual(
      rows.payments.filter((row) => major(row) > 50).map((row) => row.id),
    );
  });

  it('pushes money filters down only when the currency is known', async () => {
    const orders = defineApp({
      id: 'shop',
      description: 'A shop',
      actions: { open: action({ label: 'Open', description: 'Open' }) },
      sources: {
        orders: source({
          label: 'Orders',
          description: 'Orders',
          row: z.object({
            id: z.string(),
            total: field.money({ currency: 'currency', minor: true }),
            currency: z.string(),
          }),
          key: 'id',
          capabilities: { filter: { total: ['gt'], currency: ['eq'] } },
        }),
      },
      surfaces: {},
    });
    const data = {
      orders: [
        { id: 'o1', total: 9000, currency: 'usd' },
        { id: 'o2', total: 40, currency: 'jpy' },
        { id: 'o3', total: 60, currency: 'jpy' },
      ],
    };
    const ask = async (filter: Query['filter']) => {
      const binding = recorded(data);
      const result = await runQuery(
        orders,
        binding.fetch,
        query('orders', { fields: ['orders.id'], filter }),
        {
          clock,
        },
      );
      return {
        pushed: binding.requests[0]?.filter,
        ids: result.rows.map((row) => row['orders.id']),
      };
    };
    const over50 = { field: 'orders.total', op: 'gt' as const, values: ['50'] };
    expect(await ask([{ field: 'orders.currency', op: 'eq', values: ['jpy'] }, over50])).toEqual({
      pushed: [
        { field: 'currency', op: 'eq', values: ['jpy'] },
        { field: 'total', op: 'gt', values: [50] },
      ],
      ids: ['o3'],
    });
    expect(
      await ask([{ field: 'orders.currency', op: 'eq', values: ['usd'] }, over50]),
    ).toMatchObject({
      pushed: [
        { field: 'currency', op: 'eq', values: ['usd'] },
        { field: 'total', op: 'gt', values: [5000] },
      ],
    });
    expect(await ask([over50])).toEqual({ pushed: [], ids: ['o1', 'o3'] });
  });

  it('follows relations one hop, for fields and filters', async () => {
    const binding = recorded();
    const joined = await run(
      query('payments', { fields: ['payments.description', 'payments.customer.name'], limit: 3 }),
      {},
      binding,
    );
    expect(joined.rows.map((row) => row['payments.customer.name'])).toEqual([
      'Customer ada',
      'Customer bo',
      'Customer cy',
    ]);
    expect(joined.reads).toEqual(['payments', 'customers']);
    expect(binding.requests.map((request) => request.source)).toEqual(['payments', 'customers']);

    const orphan = await run(
      query('payments', {
        fields: ['payments.customer.name'],
        filter: [{ field: 'payments.id', op: 'eq', values: ['ch_010'] }],
      }),
    );
    expect(orphan.rows[0]).toMatchObject({ 'payments.customer.name': null });

    const byEmail = await run(
      query('payments', {
        fields: ['payments.id'],
        filter: [{ field: 'payments.customer.email', op: 'eq', values: ['ADA@example.com'] }],
      }),
    );
    expect(ids(byEmail)).toEqual(
      rows.payments.filter((row) => row.customer === 'cus_ada').map((row) => row.id),
    );
  });

  it('resolves $current from the page, and pushes it down', async () => {
    const binding = recorded();
    const result = await run(
      query('payments', {
        fields: ['payments.id'],
        filter: [{ field: 'payments.customer', op: 'eq', values: ['$current'] }],
      }),
      { current: 'cus_bo' },
      binding,
    );
    expect(binding.requests[0]?.filter).toEqual([
      { field: 'customer', op: 'eq', values: ['cus_bo'] },
    ]);
    expect(ids(result)).toEqual(['ch_001', 'ch_009', 'ch_017', 'ch_025', 'ch_033']);
    await expect(
      run(
        query('payments', {
          fields: ['payments.id'],
          filter: [{ field: 'payments.customer', op: 'eq', values: ['$current'] }],
        }),
      ),
    ).rejects.toThrow(/\$current has no row here/);
  });

  it('marks results partial when the scan stops before the last page', async () => {
    const small = defineApp({
      id: 'small',
      description: 'Small scans',
      actions: { open: action({ label: 'Open', description: 'Open' }) },
      sources: { ...sources, payments: { ...sources.payments, scan: 10 } },
      surfaces: {},
    });
    const result = await runQuery(
      small,
      fromRows(rows),
      query('payments', {
        fields: ['payments.id'],
        filter: [{ field: 'payments.refunded', op: 'eq', values: ['true'] }],
      }),
      { clock },
    );
    expect(result.partial).toBe(true);
    expect(result.rows.map((row) => row['payments.id'])).toEqual(['ch_005']);
  });

  describe('summaries', () => {
    const summary = (aggregate: Partial<Query['aggregate']>, rest: Partial<Query> = {}) =>
      run({ ...query('payments', { aggregate }), ...rest });

    it('counts by group, largest first', async () => {
      const result = await summary({ measure: 'count', by: 'payments.status' });
      expect(result.groups.map((group) => [group.label, group.value])).toEqual([
        ['succeeded', 29],
        ['failed', 7],
        ['pending', 4],
      ]);
      const total = await summary({ measure: 'count' });
      expect(total.groups).toEqual([
        { by: null, label: '', split: null, splitLabel: '', value: 40 },
      ]);
    });

    it('sums amounts per currency, in major units, saying which currency', async () => {
      const result = await summary({
        measure: 'sum',
        of: 'payments.amount',
        by: 'payments.currency',
      });
      const expected = (code: string) =>
        rows.payments
          .filter((row) => row.currency === code)
          .reduce((total, row) => total + major(row), 0);
      const usd = result.groups.find((group) => group.by === 'usd');
      const jpy = result.groups.find((group) => group.by === 'jpy');
      expect(usd?.value).toBeCloseTo(expected('usd'), 6);
      expect(usd?.currency).toBe('USD');
      expect(jpy?.value).toBeCloseTo(expected('jpy'), 6);
      expect(jpy?.currency).toBe('JPY');
    });

    it('labels groups of refs with the related row title', async () => {
      const result = await summary(
        { measure: 'sum', of: 'payments.amount', by: 'payments.customer' },
        { filter: [{ field: 'payments.currency', op: 'eq', values: ['usd'] }] },
      );
      const labels = result.groups.map((group) => group.label);
      expect(labels).toContain('Customer ada');
      expect(labels).toContain('None');
      expect(result.reads).toContain('customers');
    });

    it('buckets time, oldest first, filling quiet days with zero and keeping the latest', async () => {
      const result = await summary({ measure: 'count', by: 'payments.created', bucket: 'day' });
      expect(result.groups).toHaveLength(20);
      const last = result.groups.slice(-4).map((group) => [group.label.slice(0, 10), group.value]);
      expect(last).toEqual([
        ['2026-09-30', 1],
        ['2026-10-01', 0],
        ['2026-10-02', 1],
        ['2026-10-03', 1],
      ]);
      const labels = result.groups.map((group) => group.label);
      expect([...labels].sort()).toEqual(labels);
    });

    it('splits groups for stacked charts', async () => {
      const result = await summary({
        measure: 'count',
        by: 'payments.created',
        bucket: 'month',
        split: 'payments.status',
      });
      const october = result.groups.filter((group) => group.label.startsWith('2026-10'));
      expect(october.map((group) => group.splitLabel).sort()).toEqual(['failed', 'succeeded']);
    });

    it('measures the smallest, largest and distinct values', async () => {
      const max = await summary({ measure: 'max', of: 'payments.created' });
      expect(max.groups[0]?.value).toBe(NOW * 1000);
      const customers = await summary({ measure: 'distinct', of: 'payments.customer' });
      expect(customers.groups[0]?.value).toBe(8);
    });
  });
});
