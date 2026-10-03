import { currencyDigits, humanise, type Field } from './field.js';

/** When a query runs, and where: "today" and "this month" depend on the user's time zone. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now: number;
  /** An IANA time zone. @default 'UTC' */
  timeZone?: string;
}

/** A filter value, parsed for its field: money is in major units, times in milliseconds. */
export type Parsed =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'time'; value: number }
  | { kind: 'bool'; value: boolean };

/** The page's entity, and the signed-in user, where the binding knows them. */
export const TOKENS = ['$current', '$me'] as const;
/**
 * A value that stands for something known only when a query runs: `$current`, the page's row, or
 * `$me`, the person.
 */
export type Token = (typeof TOKENS)[number];

/** Whether a value is a token. */
export const isToken = (value: string): value is Token =>
  (TOKENS as readonly string[]).includes(value.trim().toLowerCase());

/** Longest text a filter value may hold. */
export const VALUE_LENGTH = 200;

const UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;
/** Every calendar period relative times may name. */
export const PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const;
/** A calendar period that `start:` tokens and time buckets refer to. */
export type Period = (typeof PERIODS)[number];

const RELATIVE = /^([+-])(\d{1,4})(mo|m|h|d|w|q|y)$/;
const START = /^start:(day|week|month|quarter|year)(?:([+-])(\d{1,4})(mo|m|h|d|w|q|y))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses one filter value for a field. Relative times such as `-7d`, `today` and
 * `start:month` resolve against the clock, so a saved query stays relative.
 */
export function parseValue(field: Field, raw: string, clock: Clock): Parsed | undefined {
  const text = raw.trim();
  if (text.length === 0 || text.length > VALUE_LENGTH) return undefined;
  switch (field.type) {
    case 'text':
    case 'ref':
      return { kind: 'text', value: text };
    case 'enum': {
      const value = field.values.find((entry) => entry.toLowerCase() === text.toLowerCase());
      return value === undefined ? undefined : { kind: 'text', value };
    }
    case 'number':
    case 'money': {
      const cleaned = field.type === 'money' ? text.replace(/^[$€£¥]/, '') : text;
      if (!/^-?[\d,_ ]*\.?\d+$/.test(cleaned)) return undefined;
      const value = Number(cleaned.replace(/[,_ ]/g, ''));
      return Number.isFinite(value) ? { kind: 'number', value } : undefined;
    }
    case 'bool': {
      const lower = text.toLowerCase();
      if (['true', 'yes', '1'].includes(lower)) return { kind: 'bool', value: true };
      if (['false', 'no', '0'].includes(lower)) return { kind: 'bool', value: false };
      return undefined;
    }
    case 'time': {
      const value = parseTime(text, clock);
      return value === undefined ? undefined : { kind: 'time', value };
    }
  }
}

/** An instant in milliseconds, from an ISO date or time, or a token relative to the clock. */
export function parseTime(raw: string, clock: Clock): number | undefined {
  const text = raw.trim().toLowerCase();
  const zone = clock.timeZone ?? 'UTC';
  if (text === 'now') return clock.now;
  if (text === 'today') return startOf(clock.now, 'day', zone);
  if (text === 'yesterday') return shift(startOf(clock.now, 'day', zone), -1, 'd', zone);
  if (text === 'tomorrow') return shift(startOf(clock.now, 'day', zone), 1, 'd', zone);
  const relative = RELATIVE.exec(text);
  if (relative) {
    const amount = Number(relative[2]) * (relative[1] === '-' ? -1 : 1);
    return shift(clock.now, amount, relative[3] as Unit, zone);
  }
  const start = START.exec(text);
  if (start) {
    const base = startOf(clock.now, start[1] as Period, zone);
    if (start[2] === undefined) return base;
    const amount = Number(start[3]) * (start[2] === '-' ? -1 : 1);
    return shift(base, amount, start[4] as Unit, zone);
  }
  const date = DATE.exec(text);
  if (date) {
    const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return zoned(year, month, day, 0, 0, 0, zone);
  }
  if (!/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/.test(text)) return undefined;
  const parsed = Date.parse(raw.trim());
  return Number.isNaN(parsed) ? undefined : parsed;
}

type Unit = 'm' | 'h' | 'd' | 'w' | 'mo' | 'q' | 'y';

function shift(ms: number, amount: number, unit: Unit, zone: string): number {
  if (unit in UNITS) return ms + amount * UNITS[unit as keyof typeof UNITS];
  const months = amount * (unit === 'y' ? 12 : unit === 'q' ? 3 : 1);
  const local = partsIn(ms, zone);
  const index = local.year * 12 + (local.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(local.day, daysIn(year, month));
  return zoned(year, month, day, local.hour, local.minute, local.second, zone);
}

/** The start of the day, ISO week, month, quarter or year containing an instant, in a zone. */
export function startOf(ms: number, period: Period, zone = 'UTC'): number {
  const local = partsIn(ms, zone);
  switch (period) {
    case 'day':
      return zoned(local.year, local.month, local.day, 0, 0, 0, zone);
    case 'week': {
      const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
      const back = (weekday + 6) % 7;
      const monday = new Date(Date.UTC(local.year, local.month - 1, local.day - back));
      return zoned(
        monday.getUTCFullYear(),
        monday.getUTCMonth() + 1,
        monday.getUTCDate(),
        0,
        0,
        0,
        zone,
      );
    }
    case 'month':
      return zoned(local.year, local.month, 1, 0, 0, 0, zone);
    case 'quarter':
      return zoned(local.year, Math.floor((local.month - 1) / 3) * 3 + 1, 1, 0, 0, 0, zone);
    case 'year':
      return zoned(local.year, 1, 1, 0, 0, 0, zone);
  }
}

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A moment's calendar parts in a time zone. */
export interface LocalParts {
  /** The year. */
  year: number;
  /** The month, from 1. */
  month: number;
  /** The day of the month, from 1. */
  day: number;
  /** The hour, from 0 to 23. */
  hour: number;
  /** The minute. */
  minute: number;
  /** The second. */
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, found);
  }
  return found;
}

/** The wall-clock date and time of an instant in a zone. */
export function partsIn(ms: number, zone = 'UTC'): LocalParts {
  if (zone === 'UTC') {
    const date = new Date(ms);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** The instant a wall-clock time in a zone names, settling daylight-saving shifts. */
function zoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  if (zone === 'UTC') return wall;
  const offset = (at: number) => {
    const local = partsIn(at, zone);
    const asUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    return asUtc - Math.floor(at / 1000) * 1000;
  };
  const first = wall - offset(wall);
  return wall - offset(first);
}

/** A stored time as milliseconds since the epoch, whatever the field's unit. */
export function timeOf(field: Field, value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (field.unit === 's' && typeof value === 'number') return value * 1000;
  if (field.unit === 'ms' && typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** Formats a stored value for people, by its field's type. */
export function formatValue(
  field: Field,
  value: unknown,
  currency?: string,
  locale?: string,
): string {
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
    case 'money': {
      if (typeof value !== 'number') return String(value);
      const code = (currency ?? field.code)?.toUpperCase();
      const major = field.minor ? value / 10 ** currencyDigits(code ?? 'USD') : value;
      if (!code) return new Intl.NumberFormat(locale).format(major);
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(major);
      } catch {
        return `${new Intl.NumberFormat(locale).format(major)} ${code}`;
      }
    }
    case 'time': {
      const ms = timeOf(field, value);
      return ms === undefined
        ? String(value)
        : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
    }
    case 'number':
      return typeof value === 'number'
        ? new Intl.NumberFormat(locale).format(value)
        : String(value);
    case 'enum':
      return humanise(String(value));
    case 'bool':
      return value ? 'Yes' : 'No';
    default:
      return String(value);
  }
}
