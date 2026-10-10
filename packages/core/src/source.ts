import type { z } from 'zod';
import { describeFields, type Field, type FieldType } from './field.js';

/** Every filter operator; which ones a field takes depends on its type. */
export const OPS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'nin',
  'contains',
  'prefix',
  'empty',
  'present',
] as const;
/** A filter operator. Lowercase, since planners emit them as enum values. */
export type Op = (typeof OPS)[number];

/** The operators each field type supports. */
export const OPS_BY_TYPE: Readonly<Record<FieldType, readonly Op[]>> = {
  text: ['eq', 'ne', 'in', 'nin', 'contains', 'prefix', 'empty', 'present'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'nin', 'empty', 'present'],
  money: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'present'],
  time: ['gt', 'gte', 'lt', 'lte', 'between', 'empty', 'present'],
  enum: ['eq', 'ne', 'in', 'nin', 'empty', 'present'],
  ref: ['eq', 'ne', 'in', 'nin', 'empty', 'present'],
  bool: ['eq', 'empty', 'present'],
};

/** How many values each operator takes: `[least, most]`. */
export const ARITY: Readonly<Record<Op, readonly [number, number]>> = {
  eq: [1, 1],
  ne: [1, 1],
  gt: [1, 1],
  gte: [1, 1],
  lt: [1, 1],
  lte: [1, 1],
  between: [2, 2],
  in: [1, 50],
  nin: [1, 50],
  contains: [1, 1],
  prefix: [1, 1],
  empty: [0, 0],
  present: [0, 0],
};

/** Source IDs prefix qualified field names (`payments.amount`), so they hold no dots. */
export const SOURCE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** A source row's field names, as a union. */
export type FieldNameOf<R extends z.ZodObject> = Extract<keyof R['shape'], string>;

/** What a source's binding does itself. Core does everything else on the client. */
export interface Capabilities<F extends string = string> {
  /** Filters the binding applies, by field. @default {} */
  filter?: Partial<Record<F, readonly Op[]>>;
  /** Fields the binding sorts by. @default [] */
  sort?: readonly F[];
  /** Whether the binding searches text itself. @default false */
  search?: boolean;
  /** How the binding pages through results. @default 'none' */
  pagination?: 'cursor' | 'offset' | 'none';
}

/** Data an application exposes for pages to show: a typed read model, never the rows. */
export interface SourceSpec<R extends z.ZodObject = z.ZodObject> {
  /** Shown to people and to the model, such as "Payments". */
  label: string;
  /** What the rows are, written for people and models alike. */
  description: string;
  /** Other words people use for this data, for finding it. @default [] */
  keywords?: readonly string[];
  /** One row: flat fields only. Field helpers say what values mean, such as money in cents. */
  row: R;
  /** The field that identifies a row. */
  key: FieldNameOf<R>;
  /** The field that names a row. @default the key */
  title?: FieldNameOf<R>;
  /** Fields that sum up a row, shown in compact views and reachable through relations. @default [title] */
  summary?: readonly FieldNameOf<R>[];
  /** What the binding does itself: filters, sorts, search and paging. @default none of them */
  capabilities?: Capabilities<FieldNameOf<R>>;
  /** Most rows fetched to answer one query on the client. @default 500 */
  scan?: number;
  /** Most rows one query may ask for. @default 100 */
  maxLimit?: number;
  /** Seconds a result stays fresh, counted from when it arrives; at least one. @default 30 */
  ttl?: number;
}

/** Any source, with its field names widened: what generic code works with. */
export interface AnySourceSpec {
  /** Shown to people and to the model, such as "Payments". */
  label: string;
  /** What the rows are, written for people and models alike. */
  description: string;
  /** Other words people use for this data, for finding it. @default [] */
  keywords?: readonly string[];
  /** One row: flat fields only. */
  row: z.ZodObject;
  /** The field that identifies a row. */
  key: string;
  /** The field that names a row. @default the key */
  title?: string;
  /** Fields that sum up a row, shown in compact views and reachable through relations. @default [title] */
  summary?: readonly string[];
  /** What the binding does itself: filters, sorts, search and paging. @default none of them */
  capabilities?: Capabilities;
  /** Most rows fetched to answer one query on the client. @default 500 */
  scan?: number;
  /** Most rows one query may ask for. @default 100 */
  maxLimit?: number;
  /** Seconds a result stays fresh, counted from when it arrives; at least one. @default 30 */
  ttl?: number;
}

/**
 * Declares data pages can show: a typed read model of rows, with the fields that identify and name
 * them and what the binding does itself. Planners see its schema, never its rows.
 */
export function source<const R extends z.ZodObject>(spec: SourceSpec<R>): SourceSpec<R> {
  return spec;
}

/** Rows fetched to answer one query on the client, unless the source says otherwise. */
export const SCAN = 500;
/** Rows one query may ask for, unless the source says otherwise. */
export const MAX_LIMIT = 100;
/** Seconds a result stays fresh, unless the source says otherwise. */
export const TTL = 30;

/** A source with its fields described and its defaults filled in. */
export interface ResolvedSource {
  /** The source's ID. */
  id: string;
  /** What people call it. */
  label: string;
  /** What its rows are. */
  description: string;
  /** Other words people use for it. */
  keywords: readonly string[];
  /** The field that identifies a row. */
  key: string;
  /** The field that names a row. */
  title: string;
  /** The fields that sum a row up. */
  summary: readonly string[];
  /** Every field, described. */
  fields: readonly Field[];
  /** What the binding does by itself, with nothing left out. */
  capabilities: Required<Capabilities>;
  /** Most rows fetched to answer one query on the client. */
  scan: number;
  /** Most rows one query may ask for. */
  maxLimit: number;
  /** Seconds a result stays fresh. */
  ttl: number;
}

/** Describes and checks every source; refs must point at sources that exist. */
export function resolveSources(
  sources: Readonly<Record<string, AnySourceSpec>>,
): Record<string, ResolvedSource> {
  const resolved: Record<string, ResolvedSource> = {};
  for (const [id, spec] of Object.entries(sources)) {
    const owner = `source ${id}`;
    const fail = (message: string): never => {
      throw new Error(`${owner}: ${message}`);
    };
    if (!SOURCE_PATTERN.test(id)) fail(`IDs must match ${SOURCE_PATTERN}`);
    const fields = describeFields(spec.row, owner);
    const folded = new Map<string, string>();
    for (const entry of fields) {
      const previous = folded.get(entry.name.toLowerCase());
      if (previous !== undefined) fail(`"${entry.name}" collides with "${previous}" ignoring case`);
      folded.set(entry.name.toLowerCase(), entry.name);
    }
    const byName = new Map(fields.map((entry) => [entry.name, entry]));
    const known = (name: string, role: string) => {
      if (!byName.has(name)) fail(`${role} "${name}" is not a field`);
      return byName.get(name) as Field;
    };

    const key = known(spec.key, 'key');
    if (key.type !== 'text' && key.type !== 'number') fail('the key must be text or a number');
    const title = known(spec.title ?? spec.key, 'title').name;
    const summary = spec.summary ?? [title];
    for (const name of summary) known(name, 'summary field');

    for (const entry of fields) {
      if (entry.type === 'money' && entry.currency !== undefined) {
        const currency = known(entry.currency, `currency of ${entry.name}`);
        if (currency.type !== 'text' && currency.type !== 'enum') {
          fail(`currency of ${entry.name} must be a text field`);
        }
      }
    }

    const capabilities = spec.capabilities ?? {};
    const filter: Record<string, readonly Op[]> = {};
    for (const [name, ops] of Object.entries(capabilities.filter ?? {})) {
      const entry = known(name, 'filterable field');
      for (const op of ops ?? []) {
        if (!OPS_BY_TYPE[entry.type].includes(op)) fail(`${name} can't filter by ${op}`);
      }
      filter[name] = ops ?? [];
    }
    for (const name of capabilities.sort ?? []) known(name, 'sortable field');

    const positive = (value: number | undefined, fallback: number, name: string, least = 1) => {
      const chosen = value ?? fallback;
      if (!Number.isInteger(chosen) || chosen < least)
        fail(`${name} must be an integer ≥ ${least}`);
      return chosen;
    };
    resolved[id] = {
      id,
      label: spec.label,
      description: spec.description,
      keywords: spec.keywords ?? [],
      key: key.name,
      title,
      summary,
      fields,
      capabilities: {
        filter,
        sort: capabilities.sort ?? [],
        search: capabilities.search ?? false,
        pagination: capabilities.pagination ?? 'none',
      },
      scan: positive(spec.scan, SCAN, 'scan'),
      maxLimit: positive(spec.maxLimit, MAX_LIMIT, 'maxLimit'),
      ttl: positive(spec.ttl, TTL, 'ttl', 0),
    };
  }

  for (const entry of Object.values(resolved)) {
    for (const item of entry.fields) {
      if (item.type !== 'ref') continue;
      const target = Object.hasOwn(resolved, item.source ?? '')
        ? resolved[item.source ?? '']
        : undefined;
      if (!target) {
        throw new Error(
          `source ${entry.id}: ${item.name} refers to unknown source "${item.source}"`,
        );
      }
      const targetKey = target.fields.find((candidate) => candidate.name === target.key);
      if (targetKey?.type !== 'text') {
        throw new Error(
          `source ${entry.id}: ${item.name} refers to ${target.id}, whose key isn't text`,
        );
      }
    }
  }
  return resolved;
}

/** A field named by a planner: `payments.amount`, or one hop away, `payments.customer.email`. */
export interface FieldPath {
  /** The qualified name, in canonical spelling. */
  name: string;
  /** The source whose rows the query reads. */
  source: string;
  /** The ref field followed, for a hop. */
  via?: string;
  /** The source a hop reaches. */
  target?: string;
  /** The field the name reaches. */
  field: Field;
}

/**
 * Resolves a qualified field name case-insensitively. A hop reaches only the target source's
 * summary fields, which keeps the names a planner can emit few.
 */
export function resolvePath(
  sources: Readonly<Record<string, ResolvedSource>>,
  name: string,
): FieldPath | undefined {
  const parts = name.trim().split('.');
  if (parts.length < 2 || parts.length > 3) return undefined;
  const owner = Object.values(sources).find((entry) => entry.id === (parts[0] ?? '').toLowerCase());
  if (!owner) return undefined;
  const find = (entries: readonly Field[], part: string | undefined) =>
    entries.find((entry) => entry.name.toLowerCase() === (part ?? '').toLowerCase());
  const first = find(owner.fields, parts[1]);
  if (!first) return undefined;
  if (parts.length === 2) {
    return { name: `${owner.id}.${first.name}`, source: owner.id, field: first };
  }
  if (first.type !== 'ref') return undefined;
  const target = Object.hasOwn(sources, first.source ?? '')
    ? sources[first.source ?? '']
    : undefined;
  if (!target) return undefined;
  const reachable = target.fields.filter(
    (entry) => target.summary.includes(entry.name) || entry.name === target.key,
  );
  const last = find(reachable, parts[2]);
  if (!last) return undefined;
  return {
    name: `${owner.id}.${first.name}.${last.name}`,
    source: owner.id,
    via: first.name,
    target: target.id,
    field: last,
  };
}

/** Every qualified field name a query on these sources may use. */
export function qualifiedFields(
  sources: Readonly<Record<string, ResolvedSource>>,
  ids: readonly string[] = Object.keys(sources),
): string[] {
  const names: string[] = [];
  for (const id of ids) {
    const entry = Object.hasOwn(sources, id) ? sources[id] : undefined;
    if (!entry) continue;
    for (const item of entry.fields) {
      names.push(`${id}.${item.name}`);
      if (item.type !== 'ref') continue;
      const target = Object.hasOwn(sources, item.source ?? '')
        ? sources[item.source ?? '']
        : undefined;
      if (!target) continue;
      for (const reached of target.fields) {
        if (target.summary.includes(reached.name) || reached.name === target.key) {
          names.push(`${id}.${item.name}.${reached.name}`);
        }
      }
    }
  }
  return names;
}
