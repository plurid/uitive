import { z } from 'zod';
import type { AnyContract } from './contract.js';
import type { Field } from './field.js';
import { ARITY, OPS, OPS_BY_TYPE, type FieldPath, type Op, type ResolvedSource } from './source.js';
import { isToken, parseValue, type Clock } from './values.js';

/** Every way a summary measures its rows; `none` for queries that return rows. */
export const MEASURES = ['none', 'count', 'sum', 'avg', 'min', 'max', 'distinct'] as const;
/** How a summary measures its rows: count, sum, average, minimum, maximum or distinct values. */
export type Measure = (typeof MEASURES)[number];

/** Every way time may group; `none` when it doesn't. */
export const BUCKETS = ['none', 'hour', 'day', 'week', 'month', 'quarter', 'year'] as const;
/** How time groups: by hour, day, ISO week, month, quarter or year. */
export type Bucket = (typeof BUCKETS)[number];

/** Both sort directions. */
export const DIRECTIONS = ['asc', 'desc'] as const;
/** A sort direction: ascending or descending. */
export type Direction = (typeof DIRECTIONS)[number];

/** Stands in for "no field" wherever a schema can't leave a value out. */
export const NONE = 'none';

/**
 * One filter of a query: a field, an operator, and its values as text, parsed by the field's type.
 */
export interface Filter {
  /** A qualified field name, such as `payments.status`. */
  field: string;
  /** The operator, one the field's type allows. */
  op: Op;
  /** The values, as text: `between` takes two, `empty` and `present` none. */
  values: readonly string[];
}

/** One sort of a query: a field and a direction. */
export interface Sort {
  /** A qualified field name, such as `orders.placed`. */
  field: string;
  /** Ascending or descending. */
  direction: Direction;
}

/** A summary instead of rows: one number, or one per group. */
export interface Aggregate {
  /** What to compute: a count, a sum, an average, a minimum, a maximum or a distinct count. */
  measure: Measure;
  /** The field measured, or `none` to count rows. */
  of: string;
  /** The field rows group by, or `none` for one number. */
  by: string;
  /** A second grouping, for stacked charts, or `none`. */
  split: string;
  /** For time groupings: the size of each group. */
  bucket: Bucket;
}

/**
 * A question about a source, as plain data: planners fill these in, and policy checks every
 * part. Nothing is optional, so the planner schema needs neither optional fields nor unions.
 */
export interface Query {
  /** The source asked about. */
  source: string;
  /** Qualified field names: the source's own, or one hop through a ref. */
  fields: readonly string[];
  /** Filters, all of which a row must pass. */
  filter: readonly Filter[];
  /** Sorts, in order of precedence. */
  sort: readonly Sort[];
  /** Most rows to return. */
  limit: number;
  /** Text to look for, or empty. */
  search: string;
  /** A summary instead of rows; `measure: 'none'` for rows. */
  aggregate: Aggregate;
}

/** Fields a query may read. */
export const MAX_FIELDS = 12;
/** Filters a query may apply. */
export const MAX_FILTERS = 8;
/** Sorts a query may apply. */
export const MAX_SORTS = 3;
/** Characters a query's search may hold. */
export const SEARCH_LENGTH = 100;
/** Rows a query returns when it doesn't say. */
export const DEFAULT_LIMIT = 20;

/** The aggregate of a query that returns rows: no measure, no grouping. */
export const NO_AGGREGATE: Aggregate = {
  measure: 'none',
  of: NONE,
  by: NONE,
  split: NONE,
  bucket: 'none',
};

/** Builds a query in code, filling in what's left out. */
export function query(
  source: string,
  parts: {
    fields?: readonly string[];
    filter?: readonly Filter[];
    sort?: readonly Sort[];
    limit?: number;
    search?: string;
    aggregate?: Partial<Aggregate>;
  } = {},
): Query {
  return {
    source,
    fields: parts.fields ?? [],
    filter: parts.filter ?? [],
    sort: parts.sort ?? [],
    limit: parts.limit ?? DEFAULT_LIMIT,
    search: parts.search ?? '',
    aggregate: { ...NO_AGGREGATE, ...parts.aggregate },
  };
}

const rawQuery = z.object({
  source: z.string(),
  fields: z.array(z.string()).default([]),
  filter: z
    .array(z.object({ field: z.string(), op: z.string(), values: z.array(z.string()).default([]) }))
    .default([]),
  sort: z.array(z.object({ field: z.string(), direction: z.string() })).default([]),
  limit: z.number().default(DEFAULT_LIMIT),
  search: z.string().default(''),
  aggregate: z
    .object({
      measure: z.string().default('none'),
      of: z.string().default(NONE),
      by: z.string().default(NONE),
      split: z.string().default(NONE),
      bucket: z.string().default('none'),
    })
    .default(NO_AGGREGATE),
});

/** What a query may refer to where it is used. */
export interface QueryScope {
  /** The source a page is about, so `$current` names its row. */
  entity?: string;
  /** Whether the binding knows who `$me` is. @default false */
  me?: boolean;
  /** The most rows the block showing the result can display. */
  limit?: number;
  /** Validates relative times; any clock will do. @default the current time, in UTC */
  clock?: Clock;
}

/** What checking a query gives: the query in canonical spelling, or the problem with it. */
export type QueryCheck = { ok: true; query: Query } | { ok: false; problem: string };

class Problem extends Error {}

const fail = (message: string): never => {
  throw new Problem(message);
};

/**
 * Checks a query against the contract and returns it in canonical spelling: the source exists,
 * every field belongs to it, operators suit their fields, values parse, tokens sit where they
 * mean something, limits hold and aggregates are well formed.
 */
export function checkQuery(
  contract: AnyContract,
  raw: unknown,
  scope: QueryScope = {},
): QueryCheck {
  try {
    return { ok: true, query: canonicalQuery(contract, raw, scope) };
  } catch (error) {
    if (error instanceof Problem) return { ok: false, problem: error.message };
    throw error;
  }
}

function canonicalQuery(contract: AnyContract, raw: unknown, scope: QueryScope): Query {
  const parsed = rawQuery.safeParse(raw);
  if (!parsed.success) fail('A query needs a source, fields, filters, sorting and a limit');
  const input = parsed.data as z.infer<typeof rawQuery>;
  const source = contract.source(input.source) ?? fail(`No source "${input.source}"`);
  const clock = scope.clock ?? { now: Date.now() };

  const own = (name: string): FieldPath => {
    const path = contract.path(name);
    if (!path || path.source !== source.id) fail(`"${name}" is not a field of ${source.label}`);
    return path as FieldPath;
  };
  const optional = (name: string): FieldPath | undefined =>
    name.trim() === '' || name.trim().toLowerCase() === NONE ? undefined : own(name);

  const fields = [...new Set(input.fields.map((name) => own(name).name))];
  if (fields.length > MAX_FIELDS) fail(`At most ${MAX_FIELDS} fields`);

  if (input.filter.length > MAX_FILTERS) fail(`At most ${MAX_FILTERS} filters`);
  const filter = input.filter.map((entry): Filter => {
    const path = own(entry.field);
    const op = OPS.find((candidate) => candidate === entry.op.trim().toLowerCase());
    if (!op) return fail(`No operator "${entry.op}"`);
    if (!OPS_BY_TYPE[path.field.type].includes(op)) {
      fail(`${path.field.label} can't be filtered with ${op}`);
    }
    const [least, most] = ARITY[op];
    if (entry.values.length < least || entry.values.length > most) {
      fail(
        least === most
          ? `${op} takes ${least === 0 ? 'no values' : least === 1 ? 'one value' : `${least} values`}`
          : `${op} takes ${least} to ${most} values`,
      );
    }
    const values = entry.values.map((value) =>
      checkValue(contract, path, op, value, source, scope, clock),
    );
    return { field: path.name, op, values };
  });

  const aggregate = checkAggregate(input.aggregate, optional, filter, source);

  if (input.sort.length > MAX_SORTS) fail(`At most ${MAX_SORTS} sort orders`);
  const sort = input.sort.map((entry): Sort => {
    const path = own(entry.field);
    const direction = DIRECTIONS.find((value) => value === entry.direction.trim().toLowerCase());
    if (!direction) return fail(`No direction "${entry.direction}"`);
    if (aggregate.measure !== 'none' && path.name !== aggregate.by && path.name !== aggregate.of) {
      fail('A summary sorts by its grouping or by the measured field');
    }
    return { field: path.name, direction };
  });

  if (aggregate.measure === 'none' && fields.length === 0) fail('Pick at least one field');

  const cap = Math.min(source.maxLimit, scope.limit ?? Number.POSITIVE_INFINITY);
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > cap) {
    fail(`The limit must be a whole number from 1 to ${cap}`);
  }

  const search = input.search.trim();
  if (search.length > SEARCH_LENGTH) fail(`Searches stay under ${SEARCH_LENGTH} characters`);
  if (search.length > 0 && !source.fields.some((entry) => entry.type === 'text')) {
    fail(`${source.label} has no text to search`);
  }

  return { source: source.id, fields, filter, sort, limit: input.limit, search, aggregate };
}

function checkValue(
  contract: AnyContract,
  path: FieldPath,
  op: Op,
  value: string,
  source: ResolvedSource,
  scope: QueryScope,
  clock: Clock,
): string {
  if (isToken(value)) {
    const token = value.trim().toLowerCase();
    if (!['eq', 'ne', 'in', 'nin'].includes(op))
      fail(`${token} only compares with eq, ne, in or nin`);
    if (token === '$me') {
      if (!scope.me) fail('This application has no signed-in user to compare with');
      return token;
    }
    const entity = scope.entity ?? fail('$current only works on pages about one row');
    const refersToEntity =
      path.via === undefined && path.field.type === 'ref' && path.field.source === entity;
    const isKey =
      path.via === undefined && path.source === entity && path.field.name === source.key;
    const isHopKey = path.target === entity && path.field.name === contract.source(entity)?.key;
    if (!refersToEntity && !isKey && !isHopKey) {
      fail(`$current is one of ${entity}; ${path.field.label} holds something else`);
    }
    return token;
  }
  const parsed = parseValue(path.field, value, clock);
  if (!parsed) fail(`${path.field.label} can't be "${value}"${hint(path.field)}`);
  return path.field.type === 'enum' && parsed?.kind === 'text' ? parsed.value : value.trim();
}

function hint(entry: Field): string {
  switch (entry.type) {
    case 'enum':
      return `: use one of ${entry.values.join(', ')}`;
    case 'time':
      return ': use a date such as 2026-10-01, or now, today, -7d, start:month';
    case 'number':
    case 'money':
      return ': use a number';
    case 'bool':
      return ': use true or false';
    default:
      return '';
  }
}

function checkAggregate(
  raw: z.infer<typeof rawQuery>['aggregate'],
  optional: (name: string) => FieldPath | undefined,
  filter: readonly Filter[],
  source: ResolvedSource,
): Aggregate {
  const measure = MEASURES.find((value) => value === raw.measure.trim().toLowerCase());
  if (!measure) return fail(`No measure "${raw.measure}"`);
  const bucket = BUCKETS.find((value) => value === raw.bucket.trim().toLowerCase());
  if (!bucket) return fail(`No bucket "${raw.bucket}"`);
  const of = optional(raw.of);
  const by = optional(raw.by);
  const split = optional(raw.split);

  if (measure === 'none') {
    if (of || by || split || bucket !== 'none') {
      fail('Without a measure, leave of, by, split and bucket as none');
    }
    return NO_AGGREGATE;
  }
  if (measure === 'count' && of && of.field.type === 'money')
    fail('Count rows, or sum the amounts');
  if ((measure === 'sum' || measure === 'avg') && (!of || !numeric(of.field))) {
    fail(`${measure} needs a number or an amount to measure`);
  }
  if (
    (measure === 'min' || measure === 'max') &&
    (!of || !(numeric(of.field) || of.field.type === 'time'))
  ) {
    fail(`${measure} needs a number, an amount or a time`);
  }
  if (measure === 'distinct' && !of) fail('distinct needs a field to count the values of');

  if (by && !['enum', 'ref', 'bool', 'time', 'text'].includes(by.field.type)) {
    fail(`Rows can't group by ${by.field.label}`);
  }
  if (by?.field.type === 'time' && bucket === 'none')
    fail(`Grouping by ${by.field.label} needs a bucket`);
  if (by?.field.type !== 'time' && bucket !== 'none') fail('Buckets only apply to time groupings');
  if (split) {
    if (!by) fail('Split needs a grouping first');
    if (!['enum', 'ref', 'bool', 'text'].includes(split.field.type)) {
      fail(`Rows can't split by ${split.field.label}`);
    }
    if (split.name === by?.name) fail('Split by something other than the grouping');
  }

  // Summing amounts in several currencies would add dollars to yen.
  if (
    of?.field.type === 'money' &&
    of.field.currency !== undefined &&
    measure !== 'count' &&
    measure !== 'distinct'
  ) {
    const currency = `${source.id}.${of.field.currency}`;
    const fixed = filter.some(
      (entry) => entry.field === currency && entry.op === 'eq' && entry.values.length === 1,
    );
    if (!fixed && by?.name !== currency && split?.name !== currency) {
      fail('Amounts are in several currencies: filter by one, or group by currency');
    }
  }

  return {
    measure,
    of: of?.name ?? NONE,
    by: by?.name ?? NONE,
    split: split?.name ?? NONE,
    bucket,
  };
}

const numeric = (entry: Field) => entry.type === 'number' || entry.type === 'money';
