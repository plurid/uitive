import { describe, expect, it } from 'vitest';
import { NOW, payments, rows } from './__fixtures__/payments.js';
import { createData } from './cache.js';
import { fromRows, type Fetch, type FetchRequest, type FetchResult } from './data.js';
import { query } from './query.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(fetch: Fetch = fromRows(rows)) {
  let now = NOW * 1000;
  const calls: FetchRequest[] = [];
  const data = createData(
    payments,
    (request, context) => {
      calls.push(request);
      return fetch(request, context);
    },
    { now: () => now },
  );
  let notified = 0;
  data.subscribe(() => notified++);
  return {
    data,
    calls,
    advance: (ms: number) => {
      now += ms;
    },
    notified: () => notified,
  };
}

const failed = query('payments', {
  fields: ['payments.id'],
  filter: [{ field: 'payments.status', op: 'eq', values: ['failed'] }],
});
const withCustomers = query('payments', { fields: ['payments.customer.name'], limit: 2 });

describe('createData', () => {
  it('shares one fetch between readers and keeps the entry stable', async () => {
    const { data, calls, notified } = harness();
    expect(data.read(failed).status).toBe('loading');
    expect(data.read(failed)).toBe(data.read(failed));
    await settle();
    expect(calls).toHaveLength(1);
    const entry = data.read(failed);
    expect(entry.status).toBe('ready');
    expect(entry.result?.rows).toHaveLength(7);
    expect(data.read(failed)).toBe(entry);
    expect(notified()).toBe(1);
    expect(await data.load(failed)).toBe(entry.result);
    expect(calls).toHaveLength(1);
  });

  it('shows stale results while fetching fresh ones after the source ttl', async () => {
    const { data, calls, advance } = harness();
    await data.load(failed);
    const first = data.read(failed);
    advance(31_000);
    const stale = data.read(failed);
    expect(stale).toMatchObject({ status: 'ready', stale: true });
    expect(stale.result).toBe(first.result);
    await settle();
    expect(calls).toHaveLength(2);
    expect(data.read(failed)).toMatchObject({ status: 'ready', stale: false });
    expect(data.read(failed).result).not.toBe(first.result);
  });

  it('invalidates every result that read a source, including through relations', async () => {
    const { data, calls } = harness();
    await data.load(failed);
    await data.load(withCustomers);
    const before = calls.length;
    data.invalidate(['customers']);
    expect(data.read(failed).stale).toBe(false);
    expect(data.read(withCustomers).stale).toBe(true);
    await settle();
    expect(calls.length).toBe(before + 2);
    expect(data.read(withCustomers).stale).toBe(false);
  });

  it('runs at most four fetches at once', async () => {
    const pending: ((result: FetchResult) => void)[] = [];
    const { data, calls } = harness(
      () => new Promise<FetchResult>((resolve) => pending.push(resolve)),
    );
    for (let limit = 1; limit <= 5; limit++) {
      data.read(query('payments', { fields: ['payments.id'], limit }));
    }
    await settle();
    expect(calls).toHaveLength(4);
    pending[0]?.({ rows: [] });
    await settle();
    expect(calls).toHaveLength(5);
  });

  it('reports errors, keeps the last result, and retries after a pause', async () => {
    let fail = false;
    const inner = fromRows(rows);
    const { data, calls, advance } = harness((request, context) =>
      fail ? Promise.reject(new Error('Network down')) : inner(request, context),
    );
    await data.load(failed);
    fail = true;
    data.invalidate(['payments']);
    data.read(failed);
    await settle();
    const entry = data.read(failed);
    expect(entry).toMatchObject({ status: 'error', error: 'Network down' });
    expect(entry.result?.rows).toHaveLength(7);
    data.read(failed);
    await settle();
    expect(calls).toHaveLength(2);
    fail = false;
    advance(6_000);
    data.read(failed);
    await settle();
    expect(calls).toHaveLength(3);
    expect(data.read(failed).status).toBe('ready');
  });

  it('keys relative times on the minute, and the page entity apart', async () => {
    const { data, calls, advance } = harness();
    const recent = query('payments', {
      fields: ['payments.id'],
      filter: [{ field: 'payments.created', op: 'gte', values: ['-7d'] }],
    });
    await data.load(recent);
    advance(20_000);
    await data.load(recent);
    advance(40_000);
    await data.load(recent);
    expect(calls).toHaveLength(2);
    const mine = query('payments', {
      fields: ['payments.id'],
      filter: [{ field: 'payments.customer', op: 'eq', values: ['$current'] }],
    });
    const ada = await data.load(mine, { current: 'cus_ada' });
    const bo = await data.load(mine, { current: 'cus_bo' });
    expect(ada.rows).not.toEqual(bo.rows);
  });
});
