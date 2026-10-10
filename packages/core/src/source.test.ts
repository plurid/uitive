import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { payments, sources } from './__fixtures__/payments.js';
import { action, defineApp, type RowOf, type SourceIdOf } from './contract.js';
import { currencyDigits, describeFields, field, humanize } from './field.js';
import { qualifiedFields, source } from './source.js';
import { formatValue } from './values.js';

const base = {
  id: 'app',
  description: 'An app',
  actions: { open: action({ label: 'Open', description: 'Open it' }) },
  surfaces: {},
};

const customers = source({
  label: 'Customers',
  description: 'People who pay',
  row: z.object({ id: z.string(), name: z.string() }),
  key: 'id',
});

describe('fields', () => {
  it('infers types from plain zod and from field helpers', () => {
    const fields = describeFields(
      z.object({
        id: z.string(),
        count: z.number(),
        active: z.boolean(),
        tier: z.enum(['free', 'pro']),
        at: z.iso.datetime(),
        amount: field.money({ currency: 'currency', minor: true }),
        flat: field.money({ code: 'eur' }),
        created: field.time({ unit: 's' }),
        customer: field.ref('customers'),
        note: z.string().describe('Anything the customer said').optional(),
      }),
    );
    const byName = Object.fromEntries(fields.map((entry) => [entry.name, entry]));
    expect(Object.values(byName).map((entry) => entry.type)).toEqual([
      'text',
      'number',
      'bool',
      'enum',
      'time',
      'money',
      'money',
      'time',
      'ref',
      'text',
    ]);
    expect(byName.tier?.values).toEqual(['free', 'pro']);
    expect(byName.at?.unit).toBe('iso');
    expect(byName.amount).toMatchObject({ currency: 'currency', minor: true });
    expect(byName.flat).toMatchObject({ code: 'EUR', minor: false });
    expect(byName.created?.unit).toBe('s');
    expect(byName.customer?.source).toBe('customers');
    expect(byName.note).toMatchObject({
      nullable: true,
      description: 'Anything the customer said',
      label: 'Note',
    });
  });

  it('keeps metadata through nullable and optional wrappers, and custom labels', () => {
    const [entry] = describeFields(
      z.object({ arrival: field.time({ unit: 'ms', label: 'Arrival date' }).nullable() }),
    );
    expect(entry).toMatchObject({
      type: 'time',
      unit: 'ms',
      nullable: true,
      label: 'Arrival date',
    });
  });

  it('rejects nested values and names that are not identifiers', () => {
    expect(() => describeFields(z.object({ address: z.object({ city: z.string() }) }))).toThrow(
      /flatten it or leave it out/,
    );
    expect(() => describeFields(z.object({ tags: z.array(z.string()) }))).toThrow(/flatten/);
    expect(() => describeFields(z.object({ 'first-name': z.string() }))).toThrow(/must match/);
    expect(() => describeFields(z.string())).toThrow(/z\.object/);
  });

  it('rejects metadata that contradicts the zod type', () => {
    const bad = z.boolean().meta({ 'x-uitive': { type: 'money' } });
    expect(() => describeFields(z.object({ bad }))).toThrow(/can't be money/);
  });

  it('humanizes names and knows currency digits', () => {
    expect(humanize('amount_refunded')).toBe('Amount refunded');
    expect(humanize('createdAt')).toBe('Created at');
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('jpy')).toBe(0);
    expect(currencyDigits('KWD')).toBe(3);
    expect(currencyDigits('nope')).toBe(2);
  });

  it("knows ISO 4217's minor units, which display digits differ from", () => {
    expect(['IDR', 'COP', 'HUF', 'PKR', 'MGA'].map(currencyDigits)).toEqual([2, 2, 2, 2, 2]);
    expect(['IQD', 'TND', 'BHD'].map(currencyDigits)).toEqual([3, 3, 3]);
    expect(['ISK', 'KRW', 'VND', 'XOF', 'CLP'].map(currencyDigits)).toEqual([0, 0, 0, 0, 0]);
    expect(['CLF', 'UYW'].map(currencyDigits)).toEqual([4, 4]);
    const [amount] = describeFields(z.object({ amount: field.money({ minor: true }) }));
    // 1,000,000 cents of a peso is 10,000 pesos.
    expect(formatValue(amount!, 1_000_000, 'COP', 'en')).toMatch(/10,000/);
  });

  it('takes minor units where an API differs from ISO 4217', () => {
    const [amount] = describeFields(
      z.object({ amount: field.money({ currency: 'c', minor: true, digits: { isk: 2, MGA: 0 } }) }),
    );
    expect(amount?.digits).toEqual({ ISK: 2, MGA: 0 });
    expect(formatValue(amount!, 10_000, 'ISK', 'en')).toMatch(/100/);
    expect(formatValue(amount!, 10_000, 'MGA', 'en')).toMatch(/10,000/);
    expect(() =>
      describeFields(z.object({ amount: field.money({ minor: true, digits: { ISK: 7 } }) })),
    ).toThrow(/ISK takes 0 to 4 decimal places/);
  });

  it('knows dates without a time', () => {
    const fields = describeFields(
      z.object({ day: z.iso.date(), at: z.iso.datetime(), on: field.time({ unit: 'date' }) }),
    );
    expect(fields.map((entry) => entry.unit)).toEqual(['date', 'iso', 'date']);
    expect(formatValue(fields[0]!, '2026-10-03', undefined, 'en-US')).toBe('Oct 3, 2026');
  });
});

describe('sources', () => {
  it('fills defaults and finds sources ignoring case', () => {
    const contract = defineApp({ ...base, sources: { customers } });
    expect(contract.sourceIds).toEqual(['customers']);
    expect(contract.source('Customers')).toMatchObject({
      key: 'id',
      title: 'id',
      summary: ['id'],
      scan: 500,
      maxLimit: 100,
      ttl: 30,
      capabilities: { filter: {}, sort: [], search: false, pagination: 'none' },
    });
    expect(contract.source('nope')).toBeUndefined();
  });

  it('resolves qualified field names, one hop away through summary fields only', () => {
    expect(payments.path('payments.amount')?.field.type).toBe('money');
    expect(payments.path('PAYMENTS.Customer.Email')).toMatchObject({
      name: 'payments.customer.email',
      source: 'payments',
      via: 'customer',
    });
    expect(payments.path('payments.customer.country')).toBeUndefined();
    expect(payments.path('payments.status.name')).toBeUndefined();
    expect(payments.path('payments')).toBeUndefined();
    expect(payments.path('orders.amount')).toBeUndefined();
    expect(payments.path('disputes.payment.amount')?.field.type).toBe('money');
  });

  it('lists every qualified field a query may use', () => {
    const names = qualifiedFields(
      Object.fromEntries(payments.sourceIds.map((id) => [id, payments.source(id)!])),
      ['payments'],
    );
    expect(names).toContain('payments.amount');
    expect(names).toContain('payments.customer.name');
    expect(names).toContain('payments.customer.id');
    expect(names).not.toContain('payments.customer.country');
    expect(names.every((name) => name.startsWith('payments.'))).toBe(true);
  });

  it('rejects broken sources', () => {
    const attempt = (spec: Record<string, unknown>) => () =>
      defineApp({ ...base, sources: { customers, broken: { ...customers, ...spec } as never } });
    expect(attempt({ key: 'missing' })).toThrow(/key "missing" is not a field/);
    expect(attempt({ summary: ['nope'] })).toThrow(/summary field "nope"/);
    expect(attempt({ row: z.object({ id: z.string(), owner: field.ref('teams') }) })).toThrow(
      /unknown source "teams"/,
    );
    expect(attempt({ capabilities: { filter: { name: ['gt'] } } })).toThrow(
      /name can't filter by gt/,
    );
    expect(
      attempt({ row: z.object({ id: z.string(), total: field.money({ currency: 'cur' }) }) }),
    ).toThrow(/currency of total "cur" is not a field/);
    expect(attempt({ scan: 0 })).toThrow(/scan must be an integer/);
    expect(
      attempt({ row: z.object({ id: z.string(), Name: z.string(), name: z.string() }) }),
    ).toThrow(/collides/);
    expect(() => defineApp({ ...base, sources: { 'Bad.Id': customers } })).toThrow(/must match/);
  });

  it('changes the hash when a source changes, and not for contracts without sources', () => {
    const plain = defineApp(base);
    expect(defineApp(base).hash).toBe(plain.hash);
    const one = defineApp({ ...base, sources: { customers } });
    const renamed = defineApp({
      ...base,
      sources: { customers: { ...customers, label: 'Clients' } },
    });
    expect(one.hash).not.toBe(plain.hash);
    expect(renamed.hash).not.toBe(one.hash);
  });

  it('types rows from their schemas', () => {
    expectTypeOf<SourceIdOf<typeof payments>>().toEqualTypeOf<keyof typeof sources>();
    expectTypeOf<RowOf<typeof payments, 'payouts'>>().toEqualTypeOf<{
      id: string;
      amount: number;
      status: 'paid' | 'pending' | 'in_transit' | 'failed';
      arrival: number;
    }>();
  });
});
