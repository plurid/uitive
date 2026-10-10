import { describe, expect, it } from 'vitest';
import { describeFields, field } from '@plurid/uitive-core';
import { z } from 'zod';
import { paramsFrom, showsEvery } from './params.js';

const fields = describeFields(
  z.object({
    notify: field.bool(),
    seats: field.number(),
    amount: field.money({ currency: 'currency', minor: true }),
    currency: z.string(),
    when: field.time({ unit: 's' }),
    note: z.string().optional(),
  }),
);

describe('paramsFrom', () => {
  it('parses text as validation does, money into its currency’s minor units', () => {
    expect(
      paramsFrom(fields, {
        notify: 'yes',
        seats: '1,000',
        amount: '$12.50',
        currency: 'usd',
        when: '2026-10-01',
        note: '',
      }),
    ).toEqual({ notify: true, seats: 1000, amount: 1250, currency: 'usd', when: 1_790_812_800 });
    expect(paramsFrom(fields, { amount: '5000', currency: 'jpy' }).amount).toBe(5000);
  });

  it('keeps values that aren’t text, and text it can’t parse for the schema to refuse', () => {
    expect(paramsFrom(fields, { amount: 1999, seats: 'many' })).toEqual({
      amount: 1999,
      seats: 'many',
    });
  });
});

describe('showsEvery', () => {
  it('counts a param as shown when typed, or known, parsed and in a known currency', () => {
    const shown = (raw: Record<string, unknown>, typed: string[] = []) =>
      showsEvery(fields, new Set(typed), raw, paramsFrom(fields, raw));
    const all = { notify: 'no', seats: '2', amount: '5', currency: 'eur', when: 'today' };
    expect(shown(all, ['note'])).toBe(true);
    expect(shown(all)).toBe(false);
    expect(shown({ ...all, currency: '' }, ['note'])).toBe(false);
    expect(shown({ ...all, seats: 'many' }, ['note'])).toBe(false);
    expect(shown({ ...all, currency: '' }, ['note', 'currency'])).toBe(false);
    expect(shown({ ...all, amount: '', currency: '' }, ['note', 'amount', 'currency'])).toBe(true);
  });
});
