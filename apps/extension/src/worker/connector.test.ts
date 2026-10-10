import type { FetchRequest } from '@plurid/uitive-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../__fixtures__/chrome.ts';
import { adapterById } from '../adapters.ts';
import { cacheSize, connectorFetch, forgetReads } from './connector.ts';
import { meter, READ_BUDGET } from './limits.ts';

vi.mock('./secrets.ts', () => ({ getSecret: async () => 'rk_test_unit' }));

const loaded = adapterById('stripe-dashboard');
if (!loaded) throw new Error('No adapter');
const { adapter, contract } = loaded;

const list = (extra: Partial<FetchRequest> = {}): FetchRequest => ({
  source: 'charges',
  fields: ['id', 'amount', 'currency'],
  filter: [],
  sort: [],
  limit: 10,
  ...extra,
});
const charge = (id: string, description = 'Order') => ({
  id,
  object: 'charge',
  amount: 500,
  currency: 'eur',
  description,
  metadata: { internal: 'not in the contract' },
  payment_method_details: { card: { brand: 'visa', last4: '4242' } },
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

let calls: string[];
let fake: ReturnType<typeof fakeChrome>;
beforeEach(() => {
  fake = fakeChrome({ delay: 1 });
  vi.stubGlobal('chrome', fake.chrome);
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const item = /\/v1\/charges\/(\w+)$/.exec(url)?.[1];
      return json(
        item ? charge(item) : { data: [charge('ch_1'), charge('ch_2')], has_more: false },
      );
    }),
  );
  forgetReads();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the connector', () => {
  it('keeps only the fields the contract declares, lifted ones included', async () => {
    const result = await connectorFetch(adapter, contract, 'test', list());
    expect(result.rows[0]).toEqual({
      id: 'ch_1',
      amount: 500,
      currency: 'eur',
      description: 'Order',
      card_brand: 'visa',
      card_last4: '4242',
    });
  });

  it('reuses a result for a minute, in memory only', async () => {
    await connectorFetch(adapter, contract, 'test', list());
    await connectorFetch(adapter, contract, 'test', list());
    expect(calls).toHaveLength(1);
    expect(await chrome.storage.session.get(null)).toEqual({});
    expect(cacheSize().entries).toBe(1);
  });

  it('counts every read, and stops at the budget even within one lookup', async () => {
    await chrome.storage.local.set({
      [`meter:reads:${new Date().toISOString().slice(0, 7)}`]: READ_BUDGET - 1,
    });
    const lookup = list({ filter: [{ field: 'id', op: 'in', values: ['ch_a', 'ch_b', 'ch_c'] }] });
    await expect(connectorFetch(adapter, contract, 'test', lookup)).rejects.toMatchObject({
      code: 'over-budget',
      message: expect.not.stringMatching(/settings/),
    });
    expect(calls).toHaveLength(1);
    expect(await meter('reads')).toBe(READ_BUDGET);
  });

  it('counts reads made at the same time without losing one', async () => {
    await Promise.all([
      connectorFetch(adapter, contract, 'test', list({ limit: 1 })),
      connectorFetch(adapter, contract, 'test', list({ limit: 2 })),
      connectorFetch(adapter, contract, 'test', list({ limit: 3 })),
    ]);
    expect(await meter('reads')).toBe(3);
  });

  it('leaves nothing behind from a read under way when everything is forgotten', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return json({ data: [charge('ch_1')], has_more: false });
      }),
    );
    const reading = connectorFetch(adapter, contract, 'test', list());
    await new Promise((resolve) => setTimeout(resolve, 10));
    forgetReads();
    release();
    await expect(reading).rejects.toMatchObject({ code: 'unavailable' });
    expect(cacheSize()).toEqual({ entries: 0, size: 0 });
  });

  it('keeps the cache within its size, and huge results out of it', async () => {
    const big = 'x'.repeat(200 * 1024);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        json({
          data: url.includes('limit=99')
            ? [charge('ch_h', 'y'.repeat(600 * 1024))]
            : [charge('ch_b', big)],
          has_more: false,
        }),
      ),
    );
    await connectorFetch(adapter, contract, 'test', list({ limit: 99 }));
    expect(cacheSize().entries).toBe(0);
    for (let limit = 1; limit <= 24; limit++) {
      await connectorFetch(adapter, contract, 'test', list({ limit }));
    }
    expect(cacheSize().size).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(cacheSize().entries).toBeLessThan(24);
  }, 20_000);
});
