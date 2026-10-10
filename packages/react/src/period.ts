import { periodOf, type AnyContract, type Period, type Query } from '@plurid/uitive-core';

const RELATIVE = /^([+-])(\d{1,4})(mo|m|h|d|w|q|y)$/;
const START = /^start:(day|week|month|quarter|year)(?:([+-])(\d{1,4})(mo|m|h|d|w|q|y))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/;
const UNIT: Record<Period, string> = { day: 'd', week: 'w', month: 'mo', quarter: 'q', year: 'y' };
const DAY = 86_400_000;
/** Relative times take at most four digits. */
const MOST = 9999;

/**
 * One end of a period, kept the way it was written: relative to now, to the start of a calendar
 * period, a date, or an instant.
 */
type Bound =
  | { kind: 'now'; amount: number; unit: string }
  | { kind: 'start'; period: Period; amount: number; unit: string }
  | { kind: 'date'; day: number }
  | { kind: 'instant'; ms: number };

function bound(raw: string): Bound | undefined {
  const text = raw.trim().toLowerCase();
  if (text === 'now') return { kind: 'now', amount: 0, unit: '' };
  const day = ['yesterday', 'today', 'tomorrow'].indexOf(text);
  if (day >= 0) return { kind: 'start', period: 'day', amount: day - 1, unit: 'd' };
  const relative = RELATIVE.exec(text);
  if (relative) {
    const amount = Number(relative[2]) * (relative[1] === '-' ? -1 : 1);
    return { kind: 'now', amount, unit: relative[3] as string };
  }
  const start = START.exec(text);
  if (start) {
    const period = start[1] as Period;
    if (start[2] === undefined) return { kind: 'start', period, amount: 0, unit: UNIT[period] };
    const amount = Number(start[3]) * (start[2] === '-' ? -1 : 1);
    return { kind: 'start', period, amount, unit: start[4] as string };
  }
  const date = DATE.exec(text);
  if (date) {
    const [year, month, dayOf] = [Number(date[1]), Number(date[2]), Number(date[3])];
    if (month < 1 || month > 12 || dayOf < 1 || dayOf > 31) return undefined;
    return { kind: 'date', day: Date.UTC(year, month - 1, dayOf) / DAY };
  }
  if (!INSTANT.test(text)) return undefined;
  const ms = Date.parse(raw.trim());
  return Number.isNaN(ms) ? undefined : { kind: 'instant', ms };
}

const offset = (amount: number, unit: string) =>
  `${amount < 0 ? '-' : '+'}${Math.abs(amount)}${unit}`;

function token(end: Bound): string | undefined {
  switch (end.kind) {
    case 'now':
      if (Math.abs(end.amount) > MOST) return undefined;
      return end.amount === 0 ? 'now' : offset(end.amount, end.unit);
    case 'start':
      if (Math.abs(end.amount) > MOST) return undefined;
      return end.amount === 0
        ? `start:${end.period}`
        : `start:${end.period}${offset(end.amount, end.unit)}`;
    case 'date':
      return new Date(end.day * DAY).toISOString().slice(0, 10);
    case 'instant':
      return new Date(end.ms).toISOString();
  }
}

/** The unit two offsets share, when one of them is zero and could be in any. */
function shared(a: { amount: number; unit: string }, b: { amount: number; unit: string }) {
  if (a.amount === 0) return b.unit || a.unit;
  if (b.amount === 0 || a.unit === b.unit) return a.unit;
  return undefined;
}

/**
 * The period of the same length just before one, written the same way, so its query keys the cache
 * as the original does and resolves on the client's own clock and time zone. `at` is when the
 * original ran, for periods that end now and start at a fixed time.
 */
function before(from: Bound, to: Bound, at: number | undefined): [Bound, Bound] | undefined {
  if (from.kind === 'now' && to.kind === 'now') {
    const unit = shared(from, to);
    const span = to.amount - from.amount;
    if (unit === undefined || span <= 0) return undefined;
    return [
      { kind: 'now', amount: from.amount - span, unit },
      { kind: 'now', amount: from.amount, unit },
    ];
  }
  if (from.kind === 'start' && to.kind === 'start' && from.period === to.period) {
    const unit = shared(from, to);
    const span = to.amount - from.amount;
    if (unit === undefined || span <= 0) return undefined;
    return [
      { kind: 'start', period: from.period, amount: from.amount - span, unit },
      { kind: 'start', period: from.period, amount: from.amount, unit },
    ];
  }
  if (from.kind === 'start' && to.kind === 'now' && to.amount === 0) {
    // A period so far, such as this month: the same part of the period before.
    const unit = UNIT[from.period];
    if ((from.amount !== 0 && from.unit !== unit) || from.amount > 0) return undefined;
    return [
      { kind: 'start', period: from.period, amount: 2 * from.amount - 1, unit },
      { kind: 'now', amount: from.amount - 1, unit },
    ];
  }
  if (from.kind === 'date' && to.kind === 'date') {
    const span = to.day - from.day;
    if (span <= 0) return undefined;
    return [
      { kind: 'date', day: from.day - span },
      { kind: 'date', day: from.day },
    ];
  }
  if (from.kind === 'instant' && to.kind === 'instant') {
    const span = to.ms - from.ms;
    if (span <= 0) return undefined;
    return [
      { kind: 'instant', ms: from.ms - span },
      { kind: 'instant', ms: from.ms },
    ];
  }
  if (to.kind !== 'now' || to.amount !== 0 || at === undefined) return undefined;
  if (from.kind === 'date') {
    // Whole days, so the query changes once a day rather than with every refresh.
    const span = Math.max(1, Math.round(at / DAY - from.day));
    return [
      { kind: 'date', day: from.day - span },
      { kind: 'date', day: from.day },
    ];
  }
  if (from.kind === 'instant') {
    const span = Math.floor((at - from.ms) / 60_000) * 60_000;
    if (span <= 0) return undefined;
    return [
      { kind: 'instant', ms: from.ms - span },
      { kind: 'instant', ms: from.ms },
    ];
  }
  return undefined;
}

/**
 * The same query over the period before its time filter, for a metric's comparison, or undefined
 * when there is none. Never reads the clock: the same query always gives the same comparison, so
 * it is fetched once and cached like any other.
 */
export function previousOf(contract: AnyContract, query: Query, at?: number): Query | undefined {
  const period = periodOf(query, contract);
  if (!period) return undefined;
  const from = bound(period.from);
  const to = period.to === undefined ? bound('now') : bound(period.to);
  if (!from || !to) return undefined;
  const range = before(from, to, at);
  const start = range && token(range[0]);
  const end = range && token(range[1]);
  if (start === undefined || end === undefined) return undefined;
  return {
    ...query,
    filter: [
      ...query.filter.filter((entry) => entry.field !== period.field),
      { field: period.field, op: 'gte', values: [start] },
      { field: period.field, op: 'lt', values: [end] },
    ],
  };
}
