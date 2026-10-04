import type { AnyContract, RowOf, SourceIdOf } from './contract.js';
import { currencyDigits, type Field } from './field.js';
import { NONE, type Bucket, type Direction, type Query } from './query.js';
import type { FieldPath, Op, ResolvedSource } from './source.js';
import { parseValue, startOf, timeOf, type Clock } from './values.js';

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
  /** The signed-in user, for `$me`. */
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
  /** The group's value, as people read it. */
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

/** A query's answer: rows, or groups for a summary, and whether a scan cap made it partial. */
export interface QueryResult {
  /** The rows, for queries without a summary. */
  rows: readonly Row[];
  /** The groups, for summaries. */
  groups: readonly Group[];
  /** The scan stopped before the last page, so counts and sums may be low. */
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
      typeof fetchers === 'function' ? fetchers : (fetchers as Record<string, Fetch>)[id];
    if (!found) throw new Error(`No fetch binding for ${id}`);
    return found;
  };
  const context = options.context ?? {};
  const clock = {
    ...options.clock,
    ...(context.timeZone === undefined ? {} : { timeZone: context.timeZone }),
  };
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
        ? toStored(entry.path.field, entry.values, clock, source, resolvedFilters)
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
  // When the binding does everything, one page of `limit` rows is the answer.
  const exact =
    local.length === 0 &&
    !aggregate &&
    (query.search === '' || searchPushed) &&
    (query.sort.length === 0 || sortPushed);

  const needed = neededFields(query, source, path);
  const base: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  let partial = false;
  const pageSize = exact ? query.limit : Math.min(PAGE, source.scan);
  do {
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
        limit: pageSize,
        ...(cursor === undefined ? {} : { cursor }),
        ...(searchPushed ? { search: query.search } : {}),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      context,
    );
    base.push(...(page.rows as Record<string, unknown>[]));
    cursor = source.capabilities.pagination === 'none' ? undefined : page.next;
    if (exact) break;
    if (cursor !== undefined && base.length >= source.scan) {
      partial = true;
      break;
    }
  } while (cursor !== undefined);

  // Follow relations the query reaches through.
  const hops = new Map<string, Map<string, Record<string, unknown>>>();
  const vias = new Set<string>();
  for (const name of [
    ...query.fields,
    ...query.filter.map((entry) => entry.field),
    ...query.sort.map((entry) => entry.field),
  ]) {
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
    hops.set(via, await related(target, base, via, fetchFor(target.id), context, options.signal));
  }

  const valueOf = (row: Record<string, unknown>, fieldPath: FieldPath): unknown => {
    if (fieldPath.via === undefined) return row[fieldPath.field.name];
    const key = row[fieldPath.via];
    if (key === null || key === undefined) return undefined;
    return hops.get(fieldPath.via)?.get(String(key))?.[fieldPath.field.name];
  };

  let rows = base.filter((row) =>
    local.every((entry) =>
      matches(entry.path, entry.op, entry.values, valueOf(row, entry.path), row, clock),
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
      groups: summarize(query, rows, source, contract, valueOf, hops, clock),
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
    rows = [...rows].sort((a, b) => {
      for (const order of orders) {
        const result = compare(order.path, valueOf(a, order.path), valueOf(b, order.path), a, b);
        if (result !== 0) return order.direction === 'asc' ? result : -result;
      }
      return 0;
    });
  }

  const projected = rows.slice(0, query.limit).map((row) => {
    const out: Record<string, unknown> = { [`${source.id}.${source.key}`]: row[source.key] };
    for (const name of query.fields) {
      const fieldPath = path(name);
      out[name] = valueOf(row, fieldPath) ?? null;
      const currency = fieldPath.field.type === 'money' ? fieldPath.field.currency : undefined;
      if (currency !== undefined && fieldPath.via === undefined) {
        out[`${source.id}.${currency}`] = row[currency] ?? null;
      }
    }
    return out;
  });
  return { rows: projected, groups: [], partial, at: clock.now, reads: [...reads] };
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
  values: readonly string[],
  clock: Clock,
  source: ResolvedSource,
  filters: readonly { path: FieldPath; op: Op; values: readonly string[] }[],
): Stored[] | undefined {
  const out: Stored[] = [];
  for (const value of values) {
    const parsed = parseValue(field, value, clock);
    if (!parsed) return undefined;
    if (field.type === 'money') {
      const code = field.code ?? fixedCurrency(field, source, filters);
      if (code === undefined && field.minor) return undefined;
      const amount = parsed.value as number;
      out.push(field.minor ? Math.round(amount * 10 ** currencyDigits(code ?? 'USD')) : amount);
    } else if (field.type === 'time') {
      const ms = parsed.value as number;
      out.push(
        field.unit === 's'
          ? Math.floor(ms / 1000)
          : field.unit === 'ms'
            ? ms
            : new Date(ms).toISOString(),
      );
    } else {
      out.push(parsed.value);
    }
  }
  return out;
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

/** A money value in major units, given its row. */
function major(
  field: Field,
  value: unknown,
  row: Record<string, unknown> | undefined,
): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!field.minor) return value;
  const code =
    field.code ?? (field.currency === undefined ? undefined : String(row?.[field.currency] ?? ''));
  return value / 10 ** currencyDigits(code && code.length > 0 ? code : 'USD');
}

function matches(
  path: FieldPath,
  op: Op,
  values: readonly string[],
  actual: unknown,
  row: Record<string, unknown>,
  clock: Clock,
): boolean {
  const field = path.field;
  const empty = actual === null || actual === undefined || actual === '';
  if (op === 'empty') return empty;
  if (op === 'present') return !empty;
  if (empty) return op === 'ne' || op === 'nin';

  const owner = path.via === undefined ? row : undefined;
  const comparable = (value: unknown): number | string | boolean | undefined => {
    if (field.type === 'money') return major(field, value, owner);
    if (field.type === 'time') return timeOf(field, value);
    if (field.type === 'text' || field.type === 'ref' || field.type === 'enum') {
      return String(value).toLowerCase();
    }
    return value as number | boolean;
  };
  const left = comparable(actual);
  if (left === undefined) return op === 'ne' || op === 'nin';
  const parsed = values.map((value) => {
    const result = parseValue(field, value, clock);
    if (!result) return String(value).toLowerCase();
    return typeof result.value === 'string' ? result.value.toLowerCase() : result.value;
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
  path: FieldPath,
  a: unknown,
  b: unknown,
  rowA: Record<string, unknown>,
  rowB: Record<string, unknown>,
): number {
  const field = path.field;
  // A hop's money is read without its own row, so its currency comes from the field.
  const ownerA = path.via === undefined ? rowA : undefined;
  const ownerB = path.via === undefined ? rowB : undefined;
  const emptyA = a === null || a === undefined;
  const emptyB = b === null || b === undefined;
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (field.type === 'money')
    return (major(field, a, ownerA) ?? 0) - (major(field, b, ownerB) ?? 0);
  if (field.type === 'time') return (timeOf(field, a) ?? 0) - (timeOf(field, b) ?? 0);
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

/** Rows of a related source, by key, fetched in batches where the binding filters by key. */
async function related(
  target: ResolvedSource,
  rows: readonly Record<string, unknown>[],
  via: string,
  fetch: Fetch,
  context: BindingContext,
  signal: unknown,
): Promise<Map<string, Record<string, unknown>>> {
  const keys = [
    ...new Set(
      rows
        .map((row) => row[via])
        .filter((key) => key !== null && key !== undefined)
        .map(String),
    ),
  ];
  const found = new Map<string, Record<string, unknown>>();
  if (keys.length === 0) return found;
  const byKey = (target.capabilities.filter[target.key] ?? []).includes('in');
  const fields = [...new Set([target.key, target.title, ...target.summary])];
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
      for (const row of page.rows as Record<string, unknown>[])
        found.set(String(row[target.key]), row);
    }
    return found;
  }
  let cursor: string | undefined;
  let read = 0;
  do {
    const page = await fetch(
      {
        source: target.id,
        fields,
        filter: [],
        sort: [],
        limit: PAGE,
        ...(cursor === undefined ? {} : { cursor }),
        ...extra,
      },
      context,
    );
    for (const row of page.rows as Record<string, unknown>[])
      found.set(String(row[target.key]), row);
    read += page.rows.length;
    cursor = target.capabilities.pagination === 'none' ? undefined : page.next;
  } while (cursor !== undefined && read < target.scan);
  return found;
}

function summarize(
  query: Query,
  rows: readonly Record<string, unknown>[],
  source: ResolvedSource,
  contract: AnyContract,
  valueOf: (row: Record<string, unknown>, path: FieldPath) => unknown,
  hops: Map<string, Map<string, Record<string, unknown>>>,
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

  const keyOf = (row: Record<string, unknown>, path: FieldPath | undefined): Stored | null => {
    if (!path) return null;
    const value = valueOf(row, path);
    if (value === null || value === undefined || value === '') return null;
    if (path.field.type === 'time') {
      const ms = timeOf(path.field, value);
      return ms === undefined ? null : bucketStart(ms, bucket, zone);
    }
    return value as Stored;
  };
  const labelOf = (path: FieldPath | undefined, key: Stored | null): string => {
    if (!path || key === null) return path ? 'None' : '';
    if (path.field.type === 'time') return new Date(key as number).toISOString();
    if (path.field.type === 'bool') return key ? 'Yes' : 'No';
    if (path.field.type === 'ref' && path.via === undefined) {
      const target = contract.source(path.field.source ?? '');
      const row = hops.get(path.field.name)?.get(String(key));
      return target && row ? String(row[target.title] ?? key) : String(key);
    }
    return String(key);
  };

  const buckets = new Map<
    string,
    { by: Stored | null; split: Stored | null; rows: Record<string, unknown>[] }
  >();
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

  const currencyOf = (members: readonly Record<string, unknown>[]): string | undefined => {
    if (of?.field.type !== 'money') return undefined;
    if (of.field.code !== undefined) return of.field.code;
    const field = of.field.currency;
    if (field === undefined) return undefined;
    const codes = new Set(members.map((row) => String(row[field] ?? '').toUpperCase()));
    return codes.size === 1 ? [...codes][0] : undefined;
  };

  const measured = (members: readonly Record<string, unknown>[]): number | null => {
    if (measure === 'count') {
      return of
        ? members.filter((row) => valueOf(row, of) !== null && valueOf(row, of) !== undefined)
            .length
        : members.length;
    }
    if (!of) return null;
    if (measure === 'distinct') {
      return new Set(
        members
          .map((row) => valueOf(row, of))
          .filter((value) => value !== null && value !== undefined),
      ).size;
    }
    const numbers = members
      .map((row) => {
        const value = valueOf(row, of);
        if (of.field.type === 'money')
          return major(of.field, value, of.via === undefined ? row : undefined);
        if (of.field.type === 'time') return timeOf(of.field, value);
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
  if (
    timed &&
    (measure === 'count' || measure === 'sum' || measure === 'distinct') &&
    groups.length > 0 &&
    !split
  ) {
    groups = fillGaps(groups, bucket, zone);
  }

  const order = query.sort[0];
  groups.sort((a, b) => {
    if (order && by && order.field === by.name) {
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

  if (timed && !order) {
    const times = [...new Set(groups.map((group) => group.by))].slice(-query.limit);
    return groups.filter((group) => times.includes(group.by));
  }
  if (split) {
    const keys = [...new Set(groups.map((group) => JSON.stringify(group.by)))].slice(
      0,
      query.limit,
    );
    return groups.filter((group) => keys.includes(JSON.stringify(group.by)));
  }
  return groups.slice(0, query.limit);
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function compareKeys(a: Stored | null, b: Stored | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/** The start of the bucket containing an instant. */
export function bucketStart(ms: number, bucket: Bucket, zone = 'UTC'): number {
  if (bucket === 'hour') return Math.floor(ms / 3_600_000) * 3_600_000;
  if (bucket === 'none') return ms;
  return startOf(ms, bucket, zone);
}

/** Adds empty buckets between the first and last, so charts show quiet days as zero. */
function fillGaps(groups: Group[], bucket: Bucket, zone: string): Group[] {
  const times = groups.map((group) => group.by as number).sort((a, b) => a - b);
  const first = times[0] as number;
  const last = times[times.length - 1] as number;
  const present = new Map(groups.map((group) => [group.by as number, group]));
  const template = groups[0] as Group;
  const filled: Group[] = [];
  let cursor = first;
  for (let step = 0; cursor <= last && step < 1000; step++) {
    filled.push(
      present.get(cursor) ?? {
        ...template,
        by: cursor,
        label: new Date(cursor).toISOString(),
        value: 0,
      },
    );
    cursor = nextBucket(cursor, bucket, zone);
  }
  return filled;
}

function nextBucket(ms: number, bucket: Bucket, zone: string): number {
  const day = 86_400_000;
  switch (bucket) {
    case 'hour':
      return ms + 3_600_000;
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
 * A fetcher over rows held in memory, applying every filter, sort and page it is asked for:
 * for demonstrations, tests and data an application already has.
 */
export function fromRows(rows: Readonly<Record<string, readonly object[]>>): Fetch {
  return async (request) => {
    let found = [...((rows[request.source] ?? []) as readonly Record<string, unknown>[])];
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

/** Whether a stored value passes a pushed-down filter. */
export function matchStored(value: unknown, op: Op, values: readonly Stored[]): boolean {
  const empty = value === null || value === undefined || value === '';
  if (op === 'empty') return empty;
  if (op === 'present') return !empty;
  if (empty) return op === 'ne' || op === 'nin';
  const fold = (entry: unknown) => (typeof entry === 'string' ? entry.toLowerCase() : entry);
  const left = fold(value) as Stored;
  const folded = values.map(fold) as Stored[];
  const [first, second] = folded;
  switch (op) {
    case 'eq':
      return left === first;
    case 'ne':
      return left !== first;
    case 'in':
      return folded.includes(left);
    case 'nin':
      return !folded.includes(left);
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
    case 'contains':
      return String(left).includes(String(first));
    case 'prefix':
      return String(left).startsWith(String(first));
  }
}
