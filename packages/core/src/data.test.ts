import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NOW, payments, rows, sources } from './__fixtures__/payments.js';
import { NOW as SHOP_NOW, order, shop } from './__fixtures__/shop.js';
import { action, defineApp } from './contract.js';
import {
  fromRows,
  rowMatches,
  runQuery,
  type Fetch,
  type FetchRequest,
  type RunOptions,
} from './data.js';
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

describe('runQuery on the shop', () => {
  const at: RunOptions = { clock: { now: SHOP_NOW } };
  const customers = [
    { id: 'c1', name: 'Ada', balance: 50_000, currency: 'usd' },
    { id: 'c2', name: 'Yui', balance: 5_000, currency: 'jpy' },
  ];
  const two = [order('o1', { customer: 'c1' }), order('o2', { customer: 'c2' })];
  const ask = (q: Query, data: Record<string, readonly object[]>, options: RunOptions = at) =>
    runQuery(shop, fromRows(data), q, options);

  it('reads amounts one hop away in their own currency, and keeps it beside them', async () => {
    const sums = await ask(
      query('orders', {
        aggregate: {
          measure: 'sum',
          of: 'orders.customer.balance',
          by: 'orders.customer.currency',
        },
      }),
      { orders: two, customers },
    );
    expect(sums.groups.map((group) => [group.by, group.value, group.currency])).toEqual([
      ['jpy', 5000, 'JPY'],
      ['usd', 500, 'USD'],
    ]);
    // 5,000 yen is at least 1,000; 500 dollars is not.
    const rich = await ask(
      query('orders', {
        fields: ['orders.id', 'orders.customer.balance'],
        filter: [{ field: 'orders.customer.balance', op: 'gte', values: ['1000'] }],
      }),
      { orders: two, customers },
    );
    expect(rich.rows).toEqual([
      {
        'orders.id': 'o2',
        'orders.customer.balance': 5000,
        'orders.customer.currency': 'jpy',
      },
    ]);
  });

  it('fetches the related rows a summary measures', async () => {
    const distinct = await ask(
      query('orders', { aggregate: { measure: 'distinct', of: 'orders.customer.name' } }),
      { orders: two, customers },
    );
    expect(distinct.groups[0]?.value).toBe(2);
    expect(distinct.reads).toEqual(['orders', 'customers']);
  });

  it('compares keys and references exactly, and text ignoring case', async () => {
    const orders = [order('o1', { customer: 'cus_abc' }), order('o2', { customer: 'cus_AbC' })];
    const keyed = await ask(
      query('orders', {
        fields: ['orders.id'],
        filter: [{ field: 'orders.customer', op: 'in', values: ['cus_AbC'] }],
      }),
      { orders, customers: [] },
    );
    expect(keyed.rows.map((row) => row['orders.id'])).toEqual(['o2']);
    const named = await ask(
      query('orders', {
        fields: ['orders.id'],
        filter: [{ field: 'orders.customer.name', op: 'eq', values: ['ADA'] }],
      }),
      { orders: two, customers },
    );
    expect(named.rows.map((row) => row['orders.id'])).toEqual(['o1']);
  });

  it('puts rows without a time last, after the buckets the limit keeps', async () => {
    const orders = [
      order('o1', { placed: '2026-10-01T10:00:00Z' }),
      order('o2', { placed: '2026-10-02T10:00:00Z' }),
      order('o3'),
    ];
    const result = await ask(
      query('orders', {
        aggregate: { measure: 'count', by: 'orders.placed', bucket: 'day' },
        limit: 10,
      }),
      { orders, customers },
    );
    expect(result.groups.map((group) => [group.label, group.value])).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 1],
      ['None', 1],
    ]);
  });

  it('fills quiet buckets only within what the limit keeps', async () => {
    const orders = [
      order('o1', { placed: '2026-08-01T00:00:00Z' }),
      order('o2', { placed: '2026-10-01T00:30:00Z' }),
    ];
    const latest = await ask(
      query('orders', {
        aggregate: { measure: 'count', by: 'orders.placed', bucket: 'hour' },
        limit: 3,
      }),
      { orders, customers },
    );
    expect(latest.groups.map((group) => [group.label, group.value])).toEqual([
      ['2026-09-30T22:00', 0],
      ['2026-09-30T23:00', 0],
      ['2026-10-01T00:00', 1],
    ]);
    const oldest = await ask(
      query('orders', {
        aggregate: { measure: 'count', by: 'orders.placed', bucket: 'hour' },
        sort: [{ field: 'orders.placed', direction: 'asc' }],
        limit: 2,
      }),
      { orders, customers },
    );
    expect(oldest.groups.map((group) => [group.label, group.value])).toEqual([
      ['2026-08-01T00:00', 1],
      ['2026-08-01T01:00', 0],
    ]);
  });

  it('buckets and labels time by the wall clock where the person is', async () => {
    const orders = [
      // 10:45 and 11:05 in Kathmandu, five and three quarters of an hour ahead of UTC.
      order('o1', { placed: '2026-10-03T05:00:00Z' }),
      order('o2', { placed: '2026-10-03T05:20:00Z' }),
    ];
    const hours = await ask(
      query('orders', { aggregate: { measure: 'count', by: 'orders.placed', bucket: 'hour' } }),
      { orders, customers },
      { clock: { now: SHOP_NOW, timeZone: 'Asia/Kathmandu' } },
    );
    expect(hours.groups.map((group) => group.label)).toEqual([
      '2026-10-03T10:00',
      '2026-10-03T11:00',
    ]);
    const days = await ask(
      query('orders', { aggregate: { measure: 'count', by: 'orders.placed', bucket: 'day' } }),
      { orders: [order('o1', { placed: '2026-10-02T16:00:00Z' })], customers },
      { clock: { now: SHOP_NOW, timeZone: 'Asia/Tokyo' } },
    );
    expect(days.groups.map((group) => group.label)).toEqual(['2026-10-03']);
  });

  it('says partial when a source without paging fills its one page', async () => {
    const orders = Array.from({ length: 250 }, (_, index) => order(`o${index}`));
    const count = await ask(query('orders', { aggregate: { measure: 'count' } }), {
      orders,
      customers,
    });
    expect(count.groups[0]?.value).toBe(100);
    expect(count.partial).toBe(true);
    const few = await ask(query('orders', { aggregate: { measure: 'count' } }), {
      orders: two,
      customers,
    });
    expect(few.partial).toBe(false);
  });

  it('says partial when related rows were left unread', async () => {
    const many = Array.from({ length: 150 }, (_, index) => ({
      id: `c${index}`,
      name: `Name ${index}`,
      balance: 0,
      currency: 'usd',
    }));
    const result = await ask(query('orders', { fields: ['orders.id', 'orders.customer.name'] }), {
      orders: [order('o1', { customer: 'c140' })],
      customers: many,
    });
    expect(result.rows[0]?.['orders.customer.name']).toBe(null);
    expect(result.partial).toBe(true);
    const found = await ask(query('orders', { fields: ['orders.id', 'orders.customer.name'] }), {
      orders: [order('o1', { customer: 'c40' })],
      customers: many,
    });
    expect(found.partial).toBe(false);
  });

  it('pushes days down as days, keeping the rows a local filter keeps', async () => {
    const binding = recorded({ orders: [order('o1', { day: '2026-10-03' })], customers });
    const today = await runQuery(
      shop,
      binding.fetch,
      query('orders', {
        fields: ['orders.id'],
        filter: [{ field: 'orders.day', op: 'gte', values: ['today'] }],
      }),
      at,
    );
    expect(binding.requests[0]?.filter).toEqual([
      { field: 'day', op: 'gte', values: ['2026-10-03'] },
    ]);
    expect(today.rows).toHaveLength(1);
    // From noon yesterday, the first whole day is today.
    const since = await runQuery(
      shop,
      binding.fetch,
      query('orders', {
        fields: ['orders.id'],
        filter: [{ field: 'orders.day', op: 'gte', values: ['-1d'] }],
      }),
      at,
    );
    expect(binding.requests[1]?.filter[0]?.values).toEqual(['2026-10-03']);
    expect(since.rows).toHaveLength(1);
  });

  it('resolves $me from the binding context', async () => {
    const mine = query('orders', {
      fields: ['orders.id'],
      filter: [{ field: 'orders.customer', op: 'eq', values: ['$me'] }],
    });
    const result = await ask(mine, { orders: two, customers }, { ...at, context: { me: 'c2' } });
    expect(result.rows.map((row) => row['orders.id'])).toEqual(['o2']);
    await expect(ask(mine, { orders: two, customers })).rejects.toThrow(/no signed-in user/);
  });
});

describe('runQuery paging', () => {
  it('keeps paging an exact read until it has the limit, however small the pages', async () => {
    const inner = fromRows(rows);
    const requests: FetchRequest[] = [];
    // An API whose pages hold at most ten rows, whatever the limit.
    const fetch: Fetch = (request, context) => {
      requests.push(request);
      return inner({ ...request, limit: Math.min(request.limit, 10) }, context);
    };
    const result = await runQuery(
      payments,
      fetch,
      query('payments', { fields: ['payments.id'], limit: 25 }),
      { clock },
    );
    expect(result.rows).toHaveLength(25);
    expect(result.partial).toBe(false);
    expect(requests.map((request) => request.limit)).toEqual([25, 15, 5]);
  });

  it('asks only per-source bindings it has, never ones an object inherits', async () => {
    const odd = defineApp({
      id: 'odd',
      description: 'A source named like a member of every object',
      actions: { open: action({ label: 'Open', description: 'Open' }) },
      sources: {
        constructor: source({
          label: 'Builders',
          description: 'Builders',
          row: z.object({ id: z.string() }),
          key: 'id',
        }),
      },
      surfaces: {},
    });
    const ask = query('constructor', { fields: ['constructor.id'] });
    await expect(runQuery(odd, {}, ask, { clock })).rejects.toThrow(
      'No fetch binding for constructor',
    );
    const result = await runQuery(odd, fromRows({}), ask, { clock });
    expect(result.rows).toEqual([]);
  });
});

describe('rowMatches', () => {
  const at = { clock: { now: SHOP_NOW } };

  it("reads money one hop away in the related row's currency", () => {
    // 5000 yen is ¥5,000: read with dollars' two digits it would be 50 and fail.
    const row = { 'orders.customer.balance': 5000, 'orders.customer.currency': 'jpy' };
    const filter = { field: 'orders.customer.balance', op: 'gte' as const, values: ['1000'] };
    expect(rowMatches(shop, [filter], row, at)).toBe(true);
  });

  it('compares references exactly, as the executor does', () => {
    const filter = { field: 'orders.customer', op: 'eq' as const, values: ['cus_AbC'] };
    expect(rowMatches(shop, [filter], { 'orders.customer': 'cus_abc' }, at)).toBe(false);
    expect(rowMatches(shop, [filter], { 'orders.customer': 'cus_AbC' }, at)).toBe(true);
  });
});
