import { describe, expect, it } from 'vitest';
import { NOW, payments } from './__fixtures__/payments.js';
import { checkQuery, query, type Query, type QueryCheck } from './query.js';
import { parseTime, parseValue, startOf, timeOf, type Clock } from './values.js';

const clock: Clock = { now: NOW * 1000 };
const iso = (ms: number | undefined) => (ms === undefined ? undefined : new Date(ms).toISOString());
const field = (name: string) => payments.path(name)!.field;

const ok = (result: QueryCheck): Query => {
  if (!result.ok) throw new Error(result.problem);
  return result.query;
};
const problem = (result: QueryCheck) => (result.ok ? undefined : result.problem);

describe('values', () => {
  it('parses each field type', () => {
    expect(parseValue(field('payments.status'), 'FAILED', clock)).toEqual({
      kind: 'text',
      value: 'failed',
    });
    expect(parseValue(field('payments.status'), 'refunded', clock)).toBeUndefined();
    expect(parseValue(field('payments.amount'), '$1,250.50', clock)).toEqual({
      kind: 'number',
      value: 1250.5,
    });
    expect(parseValue(field('payments.amount'), 'lots', clock)).toBeUndefined();
    expect(parseValue(field('payments.refunded'), 'yes', clock)).toEqual({
      kind: 'bool',
      value: true,
    });
    expect(parseValue(field('payments.customer'), ' cus_ada ', clock)).toEqual({
      kind: 'text',
      value: 'cus_ada',
    });
    expect(parseValue(field('payments.description'), '', clock)).toBeUndefined();
  });

  it('resolves relative times against the clock', () => {
    expect(iso(parseTime('now', clock))).toBe('2026-10-03T12:00:00.000Z');
    expect(iso(parseTime('today', clock))).toBe('2026-10-03T00:00:00.000Z');
    expect(iso(parseTime('yesterday', clock))).toBe('2026-10-02T00:00:00.000Z');
    expect(iso(parseTime('-7d', clock))).toBe('2026-09-26T12:00:00.000Z');
    expect(iso(parseTime('-30m', clock))).toBe('2026-10-03T11:30:00.000Z');
    expect(iso(parseTime('-3mo', clock))).toBe('2026-07-03T12:00:00.000Z');
    expect(iso(parseTime('+1y', clock))).toBe('2027-10-03T12:00:00.000Z');
    expect(iso(parseTime('start:week', clock))).toBe('2026-09-28T00:00:00.000Z');
    expect(iso(parseTime('start:month', clock))).toBe('2026-10-01T00:00:00.000Z');
    expect(iso(parseTime('start:month-1mo', clock))).toBe('2026-09-01T00:00:00.000Z');
    expect(iso(parseTime('start:quarter', clock))).toBe('2026-10-01T00:00:00.000Z');
    expect(iso(parseTime('start:year', clock))).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(parseTime('2026-09-15', clock))).toBe('2026-09-15T00:00:00.000Z');
    expect(iso(parseTime('2026-09-15T08:30:00+02:00', clock))).toBe('2026-09-15T06:30:00.000Z');
    expect(parseTime('last tuesday', clock)).toBeUndefined();
    expect(parseTime('2026-13-01', clock)).toBeUndefined();
  });

  it('uses the time zone for days and periods', () => {
    const paris: Clock = { now: Date.UTC(2026, 9, 3, 23, 30), timeZone: 'Europe/Paris' };
    // 23:30 UTC is already the 4th in Paris, where midnight is 22:00 UTC (summer time).
    expect(iso(parseTime('today', paris))).toBe('2026-10-03T22:00:00.000Z');
    expect(iso(parseTime('2026-12-25', paris))).toBe('2026-12-24T23:00:00.000Z');
    expect(iso(startOf(Date.UTC(2026, 2, 29, 12), 'day', 'Europe/Paris'))).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(iso(parseTime('-1mo', { now: Date.UTC(2026, 2, 31, 12) }))).toBe(
      '2026-02-28T12:00:00.000Z',
    );
  });

  it('reads stored times in any unit', () => {
    expect(timeOf(field('payments.created'), NOW)).toBe(NOW * 1000);
    expect(timeOf({ ...field('payments.created'), unit: 'ms' }, 5)).toBe(5);
    expect(timeOf({ ...field('payments.created'), unit: 'iso' }, '2026-10-03T00:00:00Z')).toBe(
      Date.UTC(2026, 9, 3),
    );
    expect(timeOf(field('payments.created'), null)).toBeUndefined();
  });
});

describe('checkQuery', () => {
  const base = query('payments', { fields: ['payments.amount', 'payments.status'] });

  it('fills defaults and returns canonical spelling', () => {
    expect(base).toMatchObject({ limit: 20, search: '', filter: [], sort: [] });
    const checked = ok(
      checkQuery(payments, {
        ...base,
        source: 'Payments',
        fields: ['PAYMENTS.amount', 'payments.Amount', 'payments.customer.Email'],
        filter: [{ field: 'payments.STATUS', op: 'IN', values: ['Failed', 'pending'] }],
        sort: [{ field: 'payments.created', direction: 'DESC' }],
      }),
    );
    expect(checked.source).toBe('payments');
    expect(checked.fields).toEqual(['payments.amount', 'payments.customer.email']);
    expect(checked.filter).toEqual([
      { field: 'payments.status', op: 'in', values: ['failed', 'pending'] },
    ]);
    expect(checked.sort).toEqual([{ field: 'payments.created', direction: 'desc' }]);
  });

  it('accepts planner output with every part present, and fills in what code leaves out', () => {
    expect(ok(checkQuery(payments, { source: 'payments', fields: ['payments.id'] })).limit).toBe(
      20,
    );
    expect(problem(checkQuery(payments, { fields: [] }))).toMatch(/needs a source/);
  });

  it('rejects unknown sources, fields from elsewhere and fields beyond one hop', () => {
    expect(problem(checkQuery(payments, { ...base, source: 'orders' }))).toBe('No source "orders"');
    expect(problem(checkQuery(payments, { ...base, fields: ['customers.email'] }))).toMatch(
      /not a field of Payments/,
    );
    expect(
      problem(checkQuery(payments, { ...base, fields: ['payments.customer.country'] })),
    ).toMatch(/not a field/);
    expect(problem(checkQuery(payments, { ...base, fields: [] }))).toMatch(/at least one field/);
  });

  it('checks operators, arity and values, with hints', () => {
    const filter = (field: string, op: string, values: string[]) =>
      problem(checkQuery(payments, { ...base, filter: [{ field, op, values }] }));
    expect(filter('payments.status', 'gt', ['failed'])).toMatch(/can't be filtered with gt/);
    expect(filter('payments.amount', 'between', ['10'])).toBe('between takes 2 values');
    expect(filter('payments.amount', 'empty', ['10'])).toBe('empty takes no values');
    expect(filter('payments.amount', 'eq', [])).toBe('eq takes one value');
    expect(filter('payments.status', 'eq', ['lost'])).toMatch(
      /can't be "lost": use one of succeeded, pending, failed/,
    );
    expect(filter('payments.created', 'gte', ['last week'])).toMatch(/start:month/);
    expect(filter('payments.amount', 'like', ['1'])).toBe('No operator "like"');
    expect(filter('payments.created', 'gte', ['-7d'])).toBeUndefined();
    expect(filter('payments.amount', 'between', ['10', '20.5'])).toBeUndefined();
  });

  it('allows $current only where it names the page entity', () => {
    const on = (entity: string | undefined, field: string, op = 'eq') =>
      problem(
        checkQuery(
          payments,
          {
            ...query(field.split('.')[0]!, { fields: [`${field.split('.')[0]}.id`] }),
            filter: [{ field, op, values: ['$current'] }],
          },
          entity === undefined ? {} : { entity },
        ),
      );
    expect(on('customers', 'customers.id')).toBeUndefined();
    expect(on('customers', 'payments.customer')).toBeUndefined();
    expect(on('customers', 'payments.customer.id')).toBeUndefined();
    expect(on('payments', 'disputes.payment')).toBeUndefined();
    expect(on(undefined, 'customers.id')).toMatch(/pages about one row/);
    expect(on('customers', 'payments.description')).toMatch(/holds something else/);
    expect(on('customers', 'payments.customer', 'contains')).toMatch(/can't be filtered/);
    expect(on('customers', 'customers.id', 'ne')).toBeUndefined();
    const me = { ...base, filter: [{ field: 'payments.customer', op: 'eq', values: ['$me'] }] };
    expect(problem(checkQuery(payments, me))).toMatch(/no signed-in user/);
    expect(problem(checkQuery(payments, me, { me: true }))).toBeUndefined();
  });

  it('bounds the limit by the source and the block', () => {
    expect(problem(checkQuery(payments, { ...base, limit: 0 }))).toMatch(/from 1 to 100/);
    expect(problem(checkQuery(payments, { ...base, limit: 101 }))).toMatch(/from 1 to 100/);
    expect(problem(checkQuery(payments, { ...base, limit: 2.5 }))).toMatch(/whole number/);
    expect(problem(checkQuery(payments, { ...base, limit: 12 }, { limit: 10 }))).toMatch(
      /from 1 to 10/,
    );
  });

  it('caps searches', () => {
    expect(ok(checkQuery(payments, { ...base, search: '  order 10 ' })).search).toBe('order 10');
    expect(problem(checkQuery(payments, { ...base, search: 'x'.repeat(101) }))).toMatch(
      /under 100/,
    );
  });

  describe('aggregates', () => {
    const summary = (aggregate: Record<string, string>, rest: Partial<Query> = {}) =>
      checkQuery(payments, { ...query('payments'), ...rest, aggregate });

    it('needs a measure for of, by, split and bucket', () => {
      expect(problem(summary({ measure: 'none', by: 'payments.status' }))).toMatch(
        /Without a measure/,
      );
      expect(problem(summary({ measure: 'median' }))).toBe('No measure "median"');
    });

    it('counts rows, grouped by enums, refs and bucketed times', () => {
      expect(ok(summary({ measure: 'count', by: 'payments.status' })).aggregate).toEqual({
        measure: 'count',
        of: 'none',
        by: 'payments.status',
        split: 'none',
        bucket: 'none',
      });
      expect(problem(summary({ measure: 'count', by: 'payments.created' }))).toMatch(
        /needs a bucket/,
      );
      expect(
        ok(
          summary({
            measure: 'count',
            by: 'payments.created',
            bucket: 'Week',
            split: 'payments.status',
          }),
        ).aggregate.bucket,
      ).toBe('week');
      expect(problem(summary({ measure: 'count', by: 'payments.status', bucket: 'day' }))).toMatch(
        /only apply to time/,
      );
      expect(problem(summary({ measure: 'count', split: 'payments.status' }))).toMatch(
        /grouping first/,
      );
      expect(
        problem(summary({ measure: 'count', by: 'payments.status', split: 'payments.status' })),
      ).toMatch(/other than the grouping/);
      expect(problem(summary({ measure: 'count', by: 'payments.amount' }))).toMatch(/can't group/);
    });

    it('measures numbers, and never adds up amounts in different currencies', () => {
      expect(problem(summary({ measure: 'sum', of: 'payments.status' }))).toMatch(/needs a number/);
      expect(problem(summary({ measure: 'sum', of: 'payments.amount' }))).toMatch(
        /several currencies/,
      );
      const usd = [{ field: 'payments.currency', op: 'eq' as const, values: ['usd'] }];
      expect(
        problem(summary({ measure: 'sum', of: 'payments.amount' }, { filter: usd })),
      ).toBeUndefined();
      expect(
        problem(summary({ measure: 'avg', of: 'payments.amount', by: 'payments.currency' })),
      ).toBeUndefined();
      expect(
        problem(
          checkQuery(payments, {
            ...query('payouts'),
            aggregate: { measure: 'sum', of: 'payouts.amount' },
          }),
        ),
      ).toBeUndefined();
      expect(problem(summary({ measure: 'max', of: 'payments.created' }))).toBeUndefined();
      expect(problem(summary({ measure: 'distinct', of: 'payments.customer' }))).toBeUndefined();
      expect(problem(summary({ measure: 'distinct' }))).toMatch(/needs a field/);
    });

    it('sorts a summary by its grouping or its measure only', () => {
      const sort = (field: string) => [{ field, direction: 'desc' as const }];
      expect(
        problem(
          summary({ measure: 'count', by: 'payments.status' }, { sort: sort('payments.status') }),
        ),
      ).toBeUndefined();
      expect(
        problem(
          summary({ measure: 'count', by: 'payments.status' }, { sort: sort('payments.created') }),
        ),
      ).toMatch(/sorts by its grouping/);
    });
  });
});
