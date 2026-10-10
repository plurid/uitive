import { describe, expect, it } from 'vitest';
import { query, type Filter } from '@plurid/uitive-core';
import { payments } from '../../core/src/__fixtures__/payments.js';
import { previousOf } from './period.js';

const created = (op: Filter['op'], value: string): Filter => ({
  field: 'payments.created',
  op,
  values: [value],
});

const before = (filter: Filter[], at?: number) =>
  previousOf(
    payments,
    query('payments', { filter, aggregate: { measure: 'count' } }),
    at,
  )?.filter.filter((entry) => entry.field === 'payments.created');

describe('previousOf', () => {
  it('writes the period before as the period was written, so the same query gives the same one', () => {
    expect(before([created('gte', '-30d')])).toEqual([
      created('gte', '-60d'),
      created('lt', '-30d'),
    ]);
    expect(before([created('gte', '-30d')])).toEqual(before([created('gte', '-30d')]));
    expect(before([created('gte', '-14d'), created('lt', '-7d')])).toEqual([
      created('gte', '-21d'),
      created('lt', '-14d'),
    ]);
  });

  it('compares a calendar period so far with the same part of the one before', () => {
    expect(before([created('gte', 'start:month')])).toEqual([
      created('gte', 'start:month-1mo'),
      created('lt', '-1mo'),
    ]);
    expect(before([created('gte', 'today')])).toEqual([
      created('gte', 'start:day-1d'),
      created('lt', '-1d'),
    ]);
    expect(before([created('gte', 'start:month'), created('lt', 'start:month+1mo')])).toEqual([
      created('gte', 'start:month-1mo'),
      created('lt', 'start:month'),
    ]);
  });

  it('shifts fixed ranges by their length, dates as dates', () => {
    expect(before([created('gte', '2026-09-01'), created('lt', '2026-10-01')])).toEqual([
      created('gte', '2026-08-02'),
      created('lt', '2026-09-01'),
    ]);
    expect(
      before([created('gte', '2026-10-01T00:00:00Z'), created('lt', '2026-10-01T06:00:00Z')]),
    ).toEqual([
      created('gte', '2026-09-30T18:00:00.000Z'),
      created('lt', '2026-10-01T00:00:00.000Z'),
    ]);
  });

  it('waits for when the figure ran before comparing a fixed start with now', () => {
    expect(before([created('gte', '2026-10-01')])).toBeUndefined();
    expect(before([created('gte', '2026-10-01')], Date.UTC(2026, 9, 3, 12))).toEqual([
      created('gte', '2026-09-28'),
      created('lt', '2026-10-01'),
    ]);
  });
});
