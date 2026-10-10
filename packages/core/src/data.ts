import type { AnyContract, RowOf, SourceIdOf } from './contract.js';
import { minorDigits, type Field } from './field.js';
import {
  currencyField,
  NONE,
  type Bucket,
  type Direction,
  type Filter,
  type Query,
} from './query.js';
import type { FieldPath, Op, ResolvedSource } from './source.js';
import { dateIn, parseValue, partsIn, startOf, timeOf, type Clock } from './values.js';

/** A value as a source stores it: money in its own units, times in the field's unit. */
export type Stored = string | number | boolean;

/** One filter a binding is asked to apply, on one of the source's own fields. */
export interface FetchFilter {
  /** One of the source's own fields. */
  field: string;
  /** The operator, one the source's capabilities declare. */
  op: Op;
  /** The values, parsed by the field's type. */
  values: readonly Stored[];
}

/**
 * What a binding is asked for. It applies only what its source's capabilities declare;
 * core does the rest.
 */
export interface FetchRequest {
  /** The source to read. */
  source: string;
  /** The fields core needs, for bindings that select columns. */
  fields: readonly string[];
  /** Filters to apply, from those the source declares. */
  filter: readonly FetchFilter[];
  /** Sorts to apply, from those the source declares. */
  sort: readonly { field: string; direction: Direction }[];
  /** Rows per page. */
  limit: number;
  /** The `next` of the previous page. */
  cursor?: string;
  /** Text to look for, when the source searches itself. */
  search?: string;
  /** An `AbortSignal` where the platform has one. */
  signal?: unknown;
}

/**
 * What a `fetch` binding answers: the rows, where the next page starts, and the total when the API
 * knows it.
 */
export interface FetchResult<R = unknown> {
  /** The rows, as the API returns them. */
  rows: readonly R[];
  /** Passed back as `cursor` for the next page; absent on the last page. */
  next?: string;
  /** Every matching row, when the API counts them. */
  total?: number;
}

/** Who and where the user is, as far as the binding knows. */
export interface BindingContext {
  /** The signed-in user, for `$me`: the value fields that hold a person are compared with. */
  me?: string;
  /** An IANA time zone, for "today" and time buckets. @default 'UTC' */
  timeZone?: string;
  /** A BCP 47 locale, for formatting. */
  locale?: string;
}

/**
 * The application's code that reads a source: a request in, rows out. It reads with the person's
 * own permissions, applying only the filters, sorts and paging its source declares.
 */
export type Fetch<R = unknown> = (
  request: FetchRequest,
  context: BindingContext,
) => Promise<FetchResult<R>>;

/** One fetcher for every source, or one per source. */
export type Fetchers<C extends AnyContract = AnyContract> =
  Fetch | { [S in SourceIdOf<C>]?: Fetch<RowOf<C, S>> };

/** A result row, keyed by qualified field name. */
export type Row = Readonly<Record<string, unknown>>;

/** One group of a summary. Money is in major units. */
export interface Group {
  /** The group's value of the grouping field, or `null` for one number. */
  by: Stored | null;
  /**
   * The group's value, as people read it. Time buckets read as local dates in the person's time
   * zone: `2026-10-03T14:00` for hours, `2026-10-03` for days and weeks, `2026-10`, `2026-Q4`
   * and `2026` for months, quarters and years. Rows without a time group as `None`, last.
   */
  label: string;
  /** The value of the second grouping, or `null` without one. */
  split: Stored | null;
  /** The second grouping's value, as people read it. */
  splitLabel: string;
  /** The measure, or `null` when nothing was measured. */
  value: number | null;
  /** For money: the currency the value is in, when one applies. */
  currency?: string;
}

/**
 * A query's answer: rows, or groups for a summary, and whether it was cut short. Money keeps its
 * currency beside it: `orders.currency` beside `orders.total`, and `orders.customer.currency`
 * beside `orders.customer.balance`.
 */
export interface QueryResult {
  /** The rows, for queries without a summary. */
  rows: readonly Row[];
  /** The groups, for summaries. */
  groups: readonly Group[];
  /**
   * Not every row was read: the scan cap stopped before the last page, a source without paging
   * filled its one page, or related rows were left unread. Counts and sums may be low.
   */
  partial: boolean;
  /** When the data was read, in milliseconds. */
  at: number;
  /** Every source read, for invalidation. */
  reads: readonly string[];
}

/** What running a query needs besides the query: the clock and the person's context. */
export interface RunOptions {
  /** The time and time zone relative values such as `-7d` resolve against. */
  clock: Clock;
  /** The key of the row a page is about, for `$current`. */
  current?: string;
  /** Who and where the person is, for `$me` and the bindings. */
  context?: BindingContext;
  /** An `AbortSignal` that cancels the fetches. */
  signal?: unknown;
}

const PAGE = 100;

type Data = Record<string, unknown>;

/** Runs a checked query: pushes down what the binding supports, does the rest here. */
export async function runQuery(
  contract: AnyContract,
  fetchers: Fetchers,
  query: Query,
  options: RunOptions,
): Promise<QueryResult> {
  const source = contract.source(query.source);
  if (!source) throw new Error(`No source "${query.source}"`);
  const fetchFor = (id: string): Fetch => {
    const found =
      typeof fetchers === 'function'
        ? fetchers
        : Object.hasOwn(fetchers, id)
          ? (fetchers as Record<string, Fetch>)[id]
          : undefined;
    if (!found) throw new Error(`No fetch binding for ${id}`);
    return found;
  };
  const context = options.context ?? {};
  const clock = {
    ...options.clock,
    ...(context.timeZone === undefined ? {} : { timeZone: context.timeZone }),
  };
  const zone = clock.timeZone ?? 'UTC';
  const path = (name: string) => contract.path(name) as FieldPath;
  const reads = new Set([source.id]);

  const resolvedFilters = query.filter.map((entry) => ({
    path: path(entry.field),
    op: entry.op,
    values: entry.values.map((value) => resolveToken(value, options.current, context.me)),
  }));

  // What the binding can do itself.
  const pushed: FetchFilter[] = [];
  const local: typeof resolvedFilters = [];
  for (const entry of resolvedFilters) {
    const ops = source.capabilities.filter[entry.path.field.name] ?? [];
    const stored =
      entry.path.via === undefined && ops.includes(entry.op)
        ? toStored(entry.path.field, entry.op, entry.values, clock, source, resolvedFilters)
        : undefined;
    if (stored) pushed.push({ field: entry.path.field.name, op: entry.op, values: stored });
    else local.push(entry);
  }
  const aggregate = query.aggregate.measure !== 'none';
  const searchPushed = query.search !== '' && source.capabilities.search;
  const sortPushed =
    query.sort.length > 0 &&
    !aggregate &&
    query.sort.every((entry) => {
      const sortPath = path(entry.field);
      return sortPath.via === undefined && source.capabilities.sort.includes(sortPath.field.name);
    });
  // When the binding does everything, the first `limit` rows are the answer.
  const exact =
    local.length === 0 &&
    !aggregate &&
    (query.search === '' || searchPushed) &&
    (query.sort.length === 0 || sortPushed);

  const needed = neededFields(query, source, path);
  const base: Data[] = [];
  let cursor: string | undefined;
  let partial = false;
  const paged = source.capabilities.pagination !== 'none';
  do {
    const limit = exact ? query.limit - base.length : Math.min(PAGE, source.scan);
    const page = await fetchFor(source.id)(
      {
        source: source.id,
        fields: needed,
        filter: pushed,
        sort: sortPushed
          ? query.sort.map((entry) => ({
              field: path(entry.field).field.name,
              direction: entry.direction,
            }))
          : [],
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(searchPushed ? { search: query.search } : {}),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      context,
    );
    base.push(...(page.rows as Data[]));
    cursor = paged && page.rows.length > 0 ? page.next : undefined;
    // A source without paging answers once, so a full page may have left rows behind.
    if (!paged && !exact && page.rows.length >= limit) partial = true;
    if (exact) {
      if (base.length >= query.limit) break;
    } else if (cursor !== undefined && base.length >= source.scan) {
      partial = true;
      break;
    }
  } while (cursor !== undefined);

  // Follow relations the query reaches through.
  const hops = new Map<string, Map<string, Data>>();
  const vias = new Set<string>();
  for (const name of [
    ...query.fields,
    ...query.filter.map((entry) => entry.field),
    ...query.sort.map((entry) => entry.field),
    query.aggregate.of,
  ]) {
    if (name === NONE) continue;
    const via = path(name).via;
    if (via !== undefined) vias.add(via);
  }
  const by = query.aggregate.by === NONE ? undefined : path(query.aggregate.by);
  const split = query.aggregate.split === NONE ? undefined : path(query.aggregate.split);
  for (const grouping of [by, split]) {
    if (grouping?.via !== undefined) vias.add(grouping.via);
    if (grouping?.via === undefined && grouping?.field.type === 'ref')
      vias.add(grouping.field.name);
  }
  for (const via of vias) {
    const ref = source.fields.find((entry) => entry.name === via) as Field;
    const target = contract.source(ref.source ?? '') as ResolvedSource;
    reads.add(target.id);
    const found = await related(target, base, via, fetchFor(target.id), context, options.signal);
    if (found.partial) partial = true;
    hops.set(via, found.rows);
  }

  const read: Reader = {
    owner(row, fieldPath) {
      if (fieldPath.via === undefined) return row;
      const key = row[fieldPath.via];
      if (key === null || key === undefined) return undefined;
      return hops.get(fieldPath.via)?.get(String(key));
    },
    value: (row, fieldPath) => read.owner(row, fieldPath)?.[fieldPath.field.name],
    // Money is read in its own row's currency: the related row's, for amounts one hop away.
    currency(row, fieldPath) {
      const field = fieldPath.field;
      if (field.type !== 'money') return undefined;
      if (field.code !== undefined) return field.code;
      if (field.currency === undefined) return undefined;
      const code = read.owner(row, fieldPath)?.[field.currency];
      return typeof code === 'string' && code.trim() !== '' ? code.trim().toUpperCase() : undefined;
    },
  };
  // Keys and references name rows, so they compare exactly; text and enums ignore case.
  const exactly = (fieldPath: FieldPath) =>
    fieldPath.field.type === 'ref' ||
    fieldPath.field.name ===
      (fieldPath.via === undefined ? source.key : contract.source(fieldPath.target ?? '')?.key);

  let rows = base.filter((row) =>
    local.every((entry) =>
      matches(
        entry.path.field,
        entry.op,
        entry.values,
        read.value(row, entry.path),
        read.currency(row, entry.path),
        exactly(entry.path),
        clock,
      ),
    ),
  );
  if (query.search !== '' && !searchPushed) {
    const needle = query.search.toLowerCase();
    const texts = source.fields.filter((entry) => entry.type === 'text' || entry.type === 'enum');
    rows = rows.filter((row) =>
      texts.some((entry) =>
        String(row[entry.name] ?? '')
          .toLowerCase()
          .includes(needle),
      ),
    );
  }

  if (aggregate) {
    return {
      rows: [],
      groups: summarize(query, rows, contract, read, hops, clock),
      partial,
      at: clock.now,
      reads: [...reads],
    };
  }

  if (query.sort.length > 0 && !sortPushed) {
    const orders = query.sort.map((entry) => ({
      path: path(entry.field),
      direction: entry.direction,
    }));
    const sortable = (row: Data, fieldPath: FieldPath) =>
      comparable(
        fieldPath.field,
        read.value(row, fieldPath),
        read.currency(row, fieldPath),
        zone,
        true,
      );
    rows = [...rows].sort((a, b) => {
      for (const order of orders) {
        const result = compare(sortable(a, order.path), sortable(b, order.path));
        if (result !== 0) return order.direction === 'asc' ? result : -result;
      }
      return 0;
    });
  }

  const projected = rows.slice(0, query.limit).map((row) => {
    const out: Data = { [`${source.id}.${source.key}`]: row[source.key] };
    for (const name of query.fields) {
      const fieldPath = path(name);
      out[name] = read.value(row, fieldPath) ?? null;
      const currency = currencyField(fieldPath);
      if (currency !== undefined) {
        out[currency] = read.owner(row, fieldPath)?.[fieldPath.field.currency as string] ?? null;
      }
    }
    return out;
  });
  return { rows: projected, groups: [], partial, at: clock.now, reads: [...reads] };
}

/** How a result row's values are read: from the row itself, or from the related row of a hop. */
interface Reader {
  owner(row: Data, path: FieldPath): Data | undefined;
  value(row: Data, path: FieldPath): unknown;
  currency(row: Data, path: FieldPath): string | undefined;
}

function resolveToken(value: string, current: string | undefined, me: string | undefined): string {
  if (value === '$current') {
    if (current === undefined) throw new Error('$current has no row here');
    return current;
  }
  if (value === '$me') {
    if (me === undefined) throw new Error('$me has no signed-in user');
    return me;
  }
  return value;
}

/** Converts filter values to the field's stored form, or undefined when that can't be known. */
function toStored(
  field: Field,
  op: Op,
  values: readonly string[],
  clock: Clock,
  source: ResolvedSource,
  filters: readonly { path: FieldPath; op: Op; values: readonly string[] }[],
): Stored[] | undefined {
  const out: Stored[] = [];
  for (const [index, value] of values.entries()) {
    const parsed = parseValue(field, value, clock);
    if (!parsed) return undefined;
    if (field.type === 'money') {
      const code = field.code ?? fixedCurrency(field, source, filters);
      if (code === undefined && field.minor) return undefined;
      const amount = parsed.value as number;
      out.push(field.minor ? Math.round(amount * 10 ** minorDigits(field, code)) : amount);
    } else if (field.type === 'time') {
      const ms = parsed.value as number;
      out.push(
        field.unit === 's'
          ? Math.floor(ms / 1000)
          : field.unit === 'ms'
            ? ms
            : field.unit === 'date'
              ? dayFor(ms, op, index, clock.timeZone ?? 'UTC')
              : new Date(ms).toISOString(),
      );
    } else {
      out.push(parsed.value);
    }
  }
  return out;
}

/**
 * The day a bound on a date-only field compares with, so the binding keeps exactly the days whose
 * start passes the bound: `gte` and `lt` round a time within a day up to the next day.
 */
function dayFor(ms: number, op: Op, index: number, zone: string): string {
  const up = op === 'gte' || op === 'lt' || (op === 'between' && index === 0);
  if (!up || startOf(ms, 'day', zone) === ms) return dateIn(ms, zone);
  const local = partsIn(ms, zone);
  return dateIn(Date.UTC(local.year, local.month - 1, local.day + 1));
}

/** The one currency a query is about, when it filters on its money field's currency. */
function fixedCurrency(
  field: Field,
  source: ResolvedSource,
  filters: readonly { path: FieldPath; op: Op; values: readonly string[] }[],
): string | undefined {
  if (field.currency === undefined) return undefined;
  const found = filters.find(
    (entry) =>
      entry.path.via === undefined &&
      entry.path.source === source.id &&
      entry.path.field.name === field.currency &&
      entry.op === 'eq',
  );
  return found?.values[0]?.toUpperCase();
}

/** A money value in major units, in its currency. */
function major(field: Field, value: unknown, code: string | undefined): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!field.minor) return value;
  return value / 10 ** minorDigits(field, code);
}

/** A stored value in a form that compares: money in major units, times in milliseconds. */
function comparable(
  field: Field,
  value: unknown,
  code: string | undefined,
  zone: string,
  exact: boolean,
): number | string | boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (field.type === 'money') return major(field, value, code);
  if (field.type === 'time') return timeOf(field, value, zone);
  if (field.type === 'text' || field.type === 'ref' || field.type === 'enum') {
    return exact ? String(value) : String(value).toLowerCase();
  }
  return value as number | boolean;
}

function matches(
  field: Field,
  op: Op,
  values: readonly string[],
  actual: unknown,
  code: string | undefined,
  exact: boolean,
  clock: Clock,
): boolean {
  const empty = actual === null || actual === undefined || actual === '';
  if (op === 'empty') return empty;
  if (op === 'present') return !empty;
  if (empty) return op === 'ne' || op === 'nin';

  const left = comparable(field, actual, code, clock.timeZone ?? 'UTC', exact);
  if (left === undefined) return op === 'ne' || op === 'nin';
  const fold = (value: string) => (exact ? value : value.toLowerCase());
  const parsed = values.map((value) => {
    const result = parseValue(field, value, clock);
    if (!result) return fold(String(value));
    return typeof result.value === 'string' ? fold(result.value) : result.value;
  });
  const [first, second] = parsed;
  // Ordered operators only apply to numbers, money and times, which compare as numbers.
  const number = left as number;
  switch (op) {
    case 'eq':
      return left === first;
    case 'ne':
      return left !== first;
    case 'in':
      return parsed.includes(left);
    case 'nin':
      return !parsed.includes(left);
    case 'gt':
      return number > (first as number);
    case 'gte':
      return number >= (first as number);
    case 'lt':
      return number < (first as number);
    case 'lte':
      return number <= (first as number);
    case 'between':
      return number >= (first as number) && number <= (second as number);
    case 'contains':
      return String(left).includes(String(first));
    case 'prefix':
      return String(left).startsWith(String(first));
  }
}

function compare(
  a: number | string | boolean | undefined,
  b: number | string | boolean | undefined,
): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

/** The fields core reads from the source's rows. */
function neededFields(
  query: Query,
  source: ResolvedSource,
  path: (name: string) => FieldPath,
): string[] {
  const names = new Set<string>([source.key]);
  const add = (name: string) => {
    if (name === NONE) return;
    const found = path(name);
    names.add(found.via ?? found.field.name);
    if (found.via === undefined && found.field.type === 'money' && found.field.currency) {
      names.add(found.field.currency);
    }
  };
  for (const name of query.fields) add(name);
  for (const entry of query.filter) add(entry.field);
  for (const entry of query.sort) add(entry.field);
  add(query.aggregate.of);
  add(query.aggregate.by);
  add(query.aggregate.split);
  return [...names];
}

/**
 * Rows of a related source, by key, fetched in batches where the binding filters by key. Partial
 * when its scan stopped short of rows it was looking for.
 */
async function related(
  target: ResolvedSource,
  rows: readonly Data[],
  via: string,
  fetch: Fetch,
  context: BindingContext,
  signal: unknown,
): Promise<{ rows: Map<string, Data>; partial: boolean }> {
  const keys = [
    ...new Set(
      rows
        .map((row) => row[via])
        .filter((key) => key !== null && key !== undefined)
        .map(String),
    ),
  ];
  const found = new Map<string, Data>();
  if (keys.length === 0) return { rows: found, partial: false };
  const byKey = (target.capabilities.filter[target.key] ?? []).includes('in');
  const reached = target.fields.filter((entry) =>
    [target.key, target.title, ...target.summary].includes(entry.name),
  );
  // Amounts come with their currency, wherever it is kept.
  const fields = [
    ...new Set(
      reached.flatMap((entry) => [entry.name, ...(entry.currency ? [entry.currency] : [])]),
    ),
  ];
  const extra = signal === undefined ? {} : { signal };
  if (byKey) {
    for (let start = 0; start < keys.length; start += 50) {
      const batch = keys.slice(start, start + 50);
      const page = await fetch(
        {
          source: target.id,
          fields,
          filter: [{ field: target.key, op: 'in', values: batch }],
          sort: [],
          limit: batch.length,
          ...extra,
        },
        context,
      );
      for (const row of page.rows as Data[]) found.set(String(row[target.key]), row);
    }
    return { rows: found, partial: false };
  }
  const paged = target.capabilities.pagination !== 'none';
  const limit = Math.min(PAGE, target.scan);
  let cursor: string | undefined;
  let read = 0;
  let stopped = false;
  do {
    const page = await fetch(
      {
        source: target.id,
        fields,
        filter: [],
        sort: [],
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...extra,
      },
      context,
    );
    for (const row of page.rows as Data[]) found.set(String(row[target.key]), row);
    read += page.rows.length;
    cursor = paged && page.rows.length > 0 ? page.next : undefined;
    if (!paged && page.rows.length >= limit) stopped = true;
    if (cursor !== undefined && read >= target.scan) stopped = true;
  } while (cursor !== undefined && !stopped);
  return { rows: found, partial: stopped && keys.some((key) => !found.has(key)) };
}

function summarize(
  query: Query,
  rows: readonly Data[],
  contract: AnyContract,
  read: Reader,
  hops: Map<string, Map<string, Data>>,
  clock: Clock,
): Group[] {
  const { measure, bucket } = query.aggregate;
  const of =
    query.aggregate.of === NONE ? undefined : (contract.path(query.aggregate.of) as FieldPath);
  const by =
    query.aggregate.by === NONE ? undefined : (contract.path(query.aggregate.by) as FieldPath);
  const split =
    query.aggregate.split === NONE
      ? undefined
      : (contract.path(query.aggregate.split) as FieldPath);
  const zone = clock.timeZone ?? 'UTC';

  const keyOf = (row: Data, path: FieldPath | undefined): Stored | null => {
    if (!path) return null;
    const value = read.value(row, path);
    if (value === null || value === undefined || value === '') return null;
    if (path.field.type === 'time') {
      const ms = timeOf(path.field, value, zone);
      return ms === undefined ? null : bucketStart(ms, bucket, zone);
    }
    return value as Stored;
  };
  const labelOf = (path: FieldPath | undefined, key: Stored | null): string => {
    if (!path || key === null) return path ? 'None' : '';
    if (path.field.type === 'time') return bucketLabel(key as number, bucket, zone);
    if (path.field.type === 'bool') return key ? 'Yes' : 'No';
    if (path.field.type === 'ref' && path.via === undefined) {
      const target = contract.source(path.field.source ?? '');
      const row = hops.get(path.field.name)?.get(String(key));
      return target && row ? String(row[target.title] ?? key) : String(key);
    }
    return String(key);
  };

  const buckets = new Map<string, { by: Stored | null; split: Stored | null; rows: Data[] }>();
  for (const row of rows) {
    const groupBy = keyOf(row, by);
    const groupSplit = keyOf(row, split);
    const key = JSON.stringify([groupBy, groupSplit]);
    const entry = buckets.get(key) ?? { by: groupBy, split: groupSplit, rows: [] };
    entry.rows.push(row);
    buckets.set(key, entry);
  }
  if (!by)
    buckets.set(
      JSON.stringify([null, null]),
      buckets.get(JSON.stringify([null, null])) ?? { by: null, split: null, rows: [] },
    );

  const currencyOf = (members: readonly Data[]): string | undefined => {
    if (of?.field.type !== 'money') return undefined;
    if (of.field.code !== undefined) return of.field.code;
    if (of.field.currency === undefined) return undefined;
    const codes = new Set(members.map((row) => read.currency(row, of) ?? ''));
    const [only] = codes;
    return codes.size === 1 && only !== '' ? only : undefined;
  };

  const measured = (members: readonly Data[]): number | null => {
    if (measure === 'count') {
      return of
        ? members.filter((row) => {
            const value = read.value(row, of);
            return value !== null && value !== undefined;
          }).length
        : members.length;
    }
    if (!of) return null;
    if (measure === 'distinct') {
      return new Set(
        members
          .map((row) => read.value(row, of))
          .filter((value) => value !== null && value !== undefined),
      ).size;
    }
    const numbers = members
      .map((row) => {
        const value = read.value(row, of);
        if (of.field.type === 'money') return major(of.field, value, read.currency(row, of));
        if (of.field.type === 'time') return timeOf(of.field, value, zone);
        return typeof value === 'number' ? value : undefined;
      })
      .filter((value): value is number => value !== undefined);
    if (numbers.length === 0) return measure === 'sum' ? 0 : null;
    if (measure === 'sum') return round(numbers.reduce((total, value) => total + value, 0));
    if (measure === 'avg')
      return round(numbers.reduce((total, value) => total + value, 0) / numbers.length);
    if (measure === 'min') return Math.min(...numbers);
    return Math.max(...numbers);
  };

  let groups: Group[] = [...buckets.values()].map((entry) => {
    const currency = currencyOf(entry.rows);
    return {
      by: entry.by,
      label: labelOf(by, entry.by),
      split: entry.split,
      splitLabel: labelOf(split, entry.split),
      value: measured(entry.rows),
      ...(currency === undefined ? {} : { currency }),
    };
  });

  const timed = by?.field.type === 'time';
  // Rows without a time can't sit on a timeline: they come last, whatever the limit keeps.
  const undated = timed ? groups.filter((group) => group.by === null) : [];
  if (timed) groups = groups.filter((group) => group.by !== null);
  const order = query.sort[0];
  const byGrouping = order !== undefined && by !== undefined && order.field === by.name;
  if (
    timed &&
    (measure === 'count' || measure === 'sum' || measure === 'distinct') &&
    groups.length > 0 &&
    !split
  ) {
    const from = byGrouping && order.direction === 'asc' ? 'start' : 'end';
    groups = fillGaps(groups, bucket, zone, query.limit, from);
  }

  groups.sort((a, b) => {
    if (order && byGrouping) {
      const result = compareKeys(a.by, b.by);
      return order.direction === 'asc' ? result : -result;
    }
    if (order) {
      const result = (a.value ?? -Infinity) - (b.value ?? -Infinity);
      return order.direction === 'asc' ? result : -result;
    }
    if (timed) return compareKeys(a.by, b.by);
    return (b.value ?? -Infinity) - (a.value ?? -Infinity) || compareKeys(a.by, b.by);
  });

  let kept: Group[];
  if (timed && !order) {
    const times = [...new Set(groups.map((group) => group.by))].slice(-query.limit);
    kept = groups.filter((group) => times.includes(group.by));
  } else if (split) {
    const keys = [...new Set(groups.map((group) => JSON.stringify(group.by)))].slice(
      0,
      query.limit,
    );
    kept = groups.filter((group) => keys.includes(JSON.stringify(group.by)));
  } else {
    kept = groups.slice(0, query.limit);
  }
  return [...kept, ...undated];
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function compareKeys(a: Stored | null, b: Stored | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/** The start of the bucket containing an instant, by the wall clock in a zone. */
export function bucketStart(ms: number, bucket: Bucket, zone = 'UTC'): number {
  if (bucket === 'none') return ms;
  if (bucket === 'hour') {
    // Some zones are offset by half or three quarters of an hour, so hours start by the wall clock.
    const local = partsIn(ms, zone);
    const within = (((ms % 1000) + 1000) % 1000) + (local.minute * 60 + local.second) * 1000;
    return ms - within;
  }
  return startOf(ms, bucket, zone);
}

/** A bucket as people read it: its start as a local date, as precise as the bucket. */
function bucketLabel(ms: number, bucket: Bucket, zone: string): string {
  const day = dateIn(ms, zone);
  const local = partsIn(ms, zone);
  const pad = (value: number) => String(value).padStart(2, '0');
  switch (bucket) {
    case 'hour':
      return `${day}T${pad(local.hour)}:${pad(local.minute)}`;
    case 'month':
      return day.slice(0, 7);
    case 'quarter':
      return `${day.slice(0, 4)}-Q${Math.floor((local.month - 1) / 3) + 1}`;
    case 'year':
      return day.slice(0, 4);
    case 'none':
      return `${day}T${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)}`;
    default:
      return day;
  }
}

/**
 * Adds empty buckets where nothing happened, so charts show quiet days as zero: only within the
 * `limit` buckets the result keeps, counting from its last bucket, or its first when sorted
 * oldest first.
 */
function fillGaps(
  groups: Group[],
  bucket: Bucket,
  zone: string,
  limit: number,
  from: 'start' | 'end',
): Group[] {
  const times = groups.map((group) => group.by as number).sort((a, b) => a - b);
  const first = times[0] as number;
  const last = times[times.length - 1] as number;
  const present = new Set(times);
  const template = groups[0] as Group;
  const added: Group[] = [];
  let cursor = from === 'end' ? last : first;
  for (let step = 0; step < limit && cursor >= first && cursor <= last; step++) {
    if (!present.has(cursor)) {
      added.push({ ...template, by: cursor, label: bucketLabel(cursor, bucket, zone), value: 0 });
    }
    cursor =
      from === 'end' ? bucketStart(cursor - 1, bucket, zone) : nextBucket(cursor, bucket, zone);
  }
  return [...groups, ...added];
}

function nextBucket(ms: number, bucket: Bucket, zone: string): number {
  const day = 86_400_000;
  switch (bucket) {
    case 'hour':
      return bucketStart(ms + 3_600_000, 'hour', zone);
    case 'day':
      return startOf(ms + day + 3_600_000 * 3, 'day', zone);
    case 'week':
      return startOf(ms + 7 * day + 3_600_000 * 3, 'week', zone);
    case 'month':
      return startOf(ms + 32 * day, 'month', zone);
    case 'quarter':
      return startOf(ms + 93 * day, 'quarter', zone);
    case 'year':
      return startOf(ms + 367 * day, 'year', zone);
    default:
      return ms + day;
  }
}

/**
 * A fetcher over rows held in memory, applying every filter, sort and page it is asked for, as an
 * API would: values compare exactly, and only `contains` and `prefix` ignore case. For
 * demonstrations, tests and data an application already has.
 */
export function fromRows(rows: Readonly<Record<string, readonly object[]>>): Fetch {
  return async (request) => {
    const own = Object.hasOwn(rows, request.source) ? rows[request.source] : undefined;
    let found = [...((own ?? []) as readonly Data[])];
    for (const filter of request.filter) {
      found = found.filter((row) => matchStored(row[filter.field], filter.op, filter.values));
    }
    if (request.search) {
      const needle = request.search.toLowerCase();
      found = found.filter((row) =>
        Object.values(row).some(
          (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
        ),
      );
    }
    for (const order of [...request.sort].reverse()) {
      found.sort((a, b) => {
        const result = compareKeys(
          (a[order.field] ?? null) as Stored | null,
          (b[order.field] ?? null) as Stored | null,
        );
        return order.direction === 'asc' ? result : -result;
      });
    }
    const start = request.cursor === undefined ? 0 : Number(request.cursor);
    const page = found.slice(start, start + request.limit);
    const end = start + page.length;
    return {
      rows: page,
      total: found.length,
      ...(end < found.length ? { next: String(end) } : {}),
    };
  };
}

/** Whether a stored value passes a pushed-down filter: exactly, but `contains` and `prefix`. */
export function matchStored(value: unknown, op: Op, values: readonly Stored[]): boolean {
  const empty = value === null || value === undefined || value === '';
  if (op === 'empty') return empty;
  if (op === 'present') return !empty;
  if (empty) return op === 'ne' || op === 'nin';
  if (op === 'contains' || op === 'prefix') {
    const text = String(value).toLowerCase();
    const needle = String(values[0] ?? '').toLowerCase();
    return op === 'contains' ? text.includes(needle) : text.startsWith(needle);
  }
  const left = value as Stored;
  const [first, second] = values;
  switch (op) {
    case 'eq':
      return left === first;
    case 'ne':
      return left !== first;
    case 'in':
      return values.includes(left);
    case 'nin':
      return !values.includes(left);
    case 'gt':
      return left > (first as Stored);
    case 'gte':
      return left >= (first as Stored);
    case 'lt':
      return left < (first as Stored);
    case 'lte':
      return left <= (first as Stored);
    case 'between':
      return left >= (first as Stored) && left <= (second as Stored);
  }
}

/**
 * Whether a result row, keyed by qualified field name, passes filters as a query applies them:
 * money in major units, times as instants, `$current` and `$me` as what they stand for. A filter
 * on a field the row lacks passes; a token that stands for nothing here fails.
 */
export function rowMatches(
  contract: AnyContract,
  filters: readonly Filter[],
  row: Row,
  options: { clock: Clock; current?: string; me?: string },
): boolean {
  return filters.every((filter) => {
    const path = contract.path(filter.field);
    if (!path || !(filter.field in row)) return true;
    let values: string[];
    try {
      values = filter.values.map((value) => resolveToken(value, options.current, options.me));
    } catch {
      return false;
    }
    const field = path.field;
    // Results carry money's currency beside it, the related row's for amounts one hop away.
    const projected =
      field.currency === undefined
        ? undefined
        : row[`${path.source}.${path.via === undefined ? '' : `${path.via}.`}${field.currency}`];
    const code =
      field.type !== 'money'
        ? undefined
        : (field.code ??
          (typeof projected === 'string' && projected.trim() !== ''
            ? projected.trim().toUpperCase()
            : undefined));
    // Keys and references name rows, so they compare exactly, as the executor compares them.
    const exact =
      field.type === 'ref' ||
      field.name ===
        contract.source(path.via === undefined ? path.source : (path.target ?? ''))?.key;
    return matches(field, filter.op, values, row[filter.field], code, exact, options.clock);
  });
}
