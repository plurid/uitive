import { z } from 'zod';
import type { Effect } from './action.js';
import {
  defineApp,
  type ActionSpec,
  type AnyContract,
  type AnyPageSpec,
  type BlockSpec,
  type CollectionSpec,
  type Contract,
  type RegionSpec,
  type SurfaceSpec,
} from './contract.js';
import { FIELD_META, type Field, type FieldMeta } from './field.js';
import { stableStringify } from './hash.js';
import { validatePage, type AnyPage } from './page.js';
import type { Filter } from './query.js';
import type { RouteSpec } from './route.js';
import type { AnySourceSpec, Capabilities } from './source.js';

/** What a JSON contract says it is, in its `format` field. */
export const CONTRACT_FORMAT = 'uitive.contract';
/** The JSON contract format's version. */
export const FORMAT_VERSION = 2;

/** One field as JSON: its JSON type, and what it means under `x-uitive`. */
export interface FieldJson {
  /** The JSON type the value is stored as. */
  type: 'string' | 'number' | 'boolean';
  /** For enums: every value. */
  enum?: string[];
  /** What the field holds. */
  description?: string;
  /** What the value means to Uitive, beyond its JSON type, such as a money field's currency. */
  [FIELD_META]: FieldMeta;
}

/** Flat fields as a JSON Schema object: a source's row or an action's params. */
export interface FieldsJson {
  /** Always an object. */
  type: 'object';
  /** Each field, by name. */
  properties: Record<string, FieldJson>;
  /** The fields every row or run has. */
  required: string[];
}

/** One action as JSON: its label, description, params as JSON Schema, and effect. */
export interface ActionJson {
  /** Shown to people and to the model. */
  label: string;
  /** What the action does. */
  description: string;
  /** The action's group. */
  group?: string;
  /** Former IDs, so stored usage survives a rename. */
  aliases?: string[];
  /** What a run takes. */
  params?: FieldsJson;
  /** What a run does to data. */
  effect?: Effect;
  /** For destructive actions: the phrase a run asks for. */
  confirm?: string;
  /** For row actions: the rows it applies to. */
  when?: Filter[];
  /** Sources a run changes. */
  invalidates?: string[];
}

/** One source as JSON: its fields, key, capabilities and limits. */
export interface SourceJson {
  /** What people call it. */
  label: string;
  /** What its rows are. */
  description: string;
  /** Other words people use for it. */
  keywords: string[];
  /** The fields of its rows. */
  row: FieldsJson;
  /** The field that identifies a row. */
  key: string;
  /** The field that names a row. */
  title: string;
  /** The fields that sum a row up. */
  summary: string[];
  /** What the binding does by itself. */
  capabilities: Required<Capabilities>;
  /** Most rows fetched to answer one query on the client. */
  scan: number;
  /** Most rows one query may ask for. */
  maxLimit: number;
  /** Seconds a result stays fresh. */
  ttl: number;
}

/** One surface as JSON, by kind: functions are evaluated, so a page's standard is written out. */
export type SurfaceJson =
  | {
      kind: 'list';
      label: string;
      description: string;
      items: string[];
      capacity: number;
      required?: string[];
      reorderable?: boolean;
      context?: string;
      /** The items each context value offers. */
      available?: Record<string, string[]>;
    }
  | { kind: 'choice'; label: string; description: string; values: string[]; default: string }
  | {
      kind: 'collection';
      label: string;
      description: string;
      /** The item's JSON Schema. */
      item: Record<string, unknown>;
      max: number;
      /** The item property that titles it. */
      title: string;
    }
  | {
      kind: 'page';
      label: string;
      description: string;
      context?: string;
      entity?: string;
      generic?: boolean | string[];
      maxElements?: number;
      maxDepth?: number;
      maxQueries?: number;
      blocks: Record<
        string,
        { label: string; description: string; props: Record<string, unknown> }
      >;
      /** The standard page, and the context values whose standard page differs. */
      standard: { page: AnyPage; values?: Record<string, AnyPage> };
    };

/** A contract as data: what adapters, agents and hosted planners exchange. */
export interface ContractJson {
  /** Says what the document is. */
  format: typeof CONTRACT_FORMAT;
  /** The JSON format's version. */
  formatVersion: typeof FORMAT_VERSION;
  /** The application's ID. */
  id: string;
  /** The version the application gave. */
  version: string;
  /** What the application is, for the model. */
  description: string;
  /** Every action, by ID. */
  actions: Record<string, ActionJson>;
  /** Every context, with its values. */
  contexts: Record<string, string[]>;
  /** Every source, by ID. */
  sources: Record<string, SourceJson>;
  /** Every region, by name. */
  regions: Record<string, RegionSpec>;
  /** Every route, by ID. */
  routes: Record<string, RouteSpec>;
  /** Every surface, by name, with pages' standards written out. */
  surfaces: Record<string, SurfaceJson>;
  /** The contract's hash, for checking that two sides mean the same contract. */
  hash: string;
}

/** Functions a JSON contract can't carry, reattached when it is loaded. */
export interface Runtime {
  /** Validators by `surface.block` for page blocks, or by surface for collections. */
  validators?: Readonly<
    Record<string, (value: never, context: string | undefined) => string | undefined>
  >;
}

const TITLES = ['label', 'title', 'name'];

/**
 * A contract as data. Functions become data (a list's items per context value, standard pages)
 * or are left out (validators). Schemas that would not survive the trip back are refused, so
 * `fromJson(toJson(c)).hash === c.hash`.
 */
export function toJson(contract: AnyContract): ContractJson {
  const actions: Record<string, ActionJson> = {};
  for (const id of contract.actionIds) {
    const spec = contract.actions[id] as ActionSpec;
    actions[id] = {
      label: spec.label,
      description: spec.description,
      ...(spec.group === undefined ? {} : { group: spec.group }),
      ...(spec.aliases === undefined ? {} : { aliases: [...spec.aliases] }),
      ...(spec.params === undefined ? {} : { params: fieldsToJson(contract.params(id)) }),
      ...(spec.effect === undefined ? {} : { effect: spec.effect }),
      ...(spec.confirm === undefined ? {} : { confirm: spec.confirm }),
      ...(spec.when === undefined
        ? {}
        : { when: spec.when.map((filter) => ({ ...filter, values: [...filter.values] })) }),
      ...(spec.invalidates === undefined ? {} : { invalidates: [...spec.invalidates] }),
    };
  }

  const sources: Record<string, SourceJson> = {};
  for (const id of contract.sourceIds) {
    const entry = contract.source(id);
    if (!entry) continue;
    sources[id] = {
      label: entry.label,
      description: entry.description,
      keywords: [...entry.keywords],
      row: fieldsToJson(entry.fields),
      key: entry.key,
      title: entry.title,
      summary: [...entry.summary],
      capabilities: {
        filter: Object.fromEntries(
          Object.entries(entry.capabilities.filter).map(([name, ops]) => [name, [...(ops ?? [])]]),
        ),
        sort: [...entry.capabilities.sort],
        search: entry.capabilities.search,
        pagination: entry.capabilities.pagination,
      },
      scan: entry.scan,
      maxLimit: entry.maxLimit,
      ttl: entry.ttl,
    };
  }

  const surfaces: Record<string, SurfaceJson> = {};
  for (const id of contract.surfaceIds) {
    surfaces[id] = surfaceToJson(contract, id, contract.surfaces[id] as SurfaceSpec);
  }

  return {
    format: CONTRACT_FORMAT,
    formatVersion: FORMAT_VERSION,
    id: contract.id,
    version: contract.version,
    description: contract.description,
    actions,
    contexts: Object.fromEntries(
      Object.entries(contract.contexts).map(([name, values]) => [name, [...values]]),
    ),
    sources,
    regions: Object.fromEntries(
      Object.entries(contract.regions).map(([name, region]) => [
        name,
        {
          label: region.label,
          description: region.description,
          ...(region.entity === undefined ? {} : { entity: region.entity }),
        },
      ]),
    ),
    routes: Object.fromEntries(
      contract.routeIds.map((id) => {
        const route = contract.routes[id] as RouteSpec;
        return [
          id,
          {
            path: route.path,
            ...(route.label === undefined ? {} : { label: route.label }),
            ...(route.entity === undefined ? {} : { entity: route.entity }),
            ...(route.key === undefined ? {} : { key: route.key }),
            ...(route.page === undefined ? {} : { page: route.page }),
            ...(route.action === undefined ? {} : { action: route.action }),
          },
        ];
      }),
    ),
    surfaces,
    hash: contract.hash,
  };
}

function surfaceToJson(contract: AnyContract, id: string, spec: SurfaceSpec): SurfaceJson {
  const base = { label: spec.label, description: spec.description };
  if (spec.kind === 'list') {
    const values = spec.context === undefined ? [] : (contract.contexts[spec.context] ?? []);
    return {
      kind: 'list',
      ...base,
      items: [...spec.items],
      capacity: spec.capacity,
      ...(spec.required === undefined ? {} : { required: [...spec.required] }),
      ...(spec.reorderable === undefined ? {} : { reorderable: spec.reorderable }),
      ...(spec.context === undefined ? {} : { context: spec.context }),
      ...(spec.available === undefined
        ? {}
        : {
            available: Object.fromEntries(
              values.map((value) => [value, [...(spec.available?.(value) ?? spec.items)]]),
            ),
          }),
    };
  }
  if (spec.kind === 'choice') {
    return { kind: 'choice', ...base, values: [...spec.values], default: spec.default };
  }
  if (spec.kind === 'collection') {
    const item = exactSchema(spec.item, `surface ${id} items`);
    const properties = (item.properties ?? {}) as Record<string, { type?: unknown }>;
    const title = TITLES.find((name) => properties[name]?.type === 'string');
    if (title === undefined) {
      throw new Error(`surface ${id}: items need a label, title or name to be described as data`);
    }
    return { kind: 'collection', ...base, item, max: spec.max, title };
  }
  const page = spec as AnyPageSpec;
  const values = page.context === undefined ? [undefined] : (contract.contexts[page.context] ?? []);
  const pages = values.map((value) => validatePage(contract, page, page.standard(value), value));
  const counts = new Map<string, number>();
  for (const entry of pages) {
    const key = stableStringify(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // The most common standard page is the default; values whose page differs are listed.
  const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const standard = pages.find((entry) => stableStringify(entry) === common) as AnyPage;
  const differing = values.flatMap((value, index) =>
    value !== undefined && stableStringify(pages[index]) !== common
      ? [[value, pages[index] as AnyPage] as const]
      : [],
  );
  return {
    kind: 'page',
    ...base,
    ...(page.context === undefined ? {} : { context: page.context }),
    ...(page.entity === undefined ? {} : { entity: page.entity }),
    ...(page.generic === undefined
      ? {}
      : {
          generic:
            page.generic === true || page.generic === false ? page.generic : [...page.generic],
        }),
    ...(page.maxElements === undefined ? {} : { maxElements: page.maxElements }),
    ...(page.maxDepth === undefined ? {} : { maxDepth: page.maxDepth }),
    ...(page.maxQueries === undefined ? {} : { maxQueries: page.maxQueries }),
    blocks: Object.fromEntries(
      Object.entries(page.blocks).map(([name, block]) => [
        name,
        {
          label: block.label,
          description: block.description,
          props: exactSchema(block.props, `surface ${id} block ${name}`),
        },
      ]),
    ),
    standard: {
      page: standard,
      ...(differing.length === 0 ? {} : { values: Object.fromEntries(differing) }),
    },
  };
}

/** A zod schema as JSON Schema, refusing schemas the trip back would change. */
function exactSchema(schema: z.ZodType, owner: string): Record<string, unknown> {
  let json: Record<string, unknown>;
  try {
    json = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  } catch {
    throw new Error(`${owner}: the schema can't be written as JSON Schema`);
  }
  const back = z.toJSONSchema(z.fromJSONSchema(json as never), { target: 'draft-2020-12' });
  if (stableStringify(back) !== stableStringify(json)) {
    throw new Error(
      `${owner}: the schema would change on the way back from JSON; keep to types and plain constraints`,
    );
  }
  return json;
}

/** Fields as canonical JSON: every meaning written out, so nothing is inferred on the way back. */
export function fieldsToJson(fields: readonly Field[]): FieldsJson {
  const properties: Record<string, FieldJson> = {};
  for (const entry of fields) {
    const meta: FieldMeta = {
      type: entry.type,
      label: entry.label,
      ...(entry.currency === undefined ? {} : { currency: entry.currency }),
      ...(entry.code === undefined ? {} : { code: entry.code }),
      ...(entry.minor ? { minor: true } : {}),
      ...(entry.unit === undefined ? {} : { unit: entry.unit }),
      ...(entry.source === undefined ? {} : { source: entry.source }),
    };
    const numeric =
      entry.type === 'number' ||
      entry.type === 'money' ||
      (entry.type === 'time' && entry.unit !== 'iso');
    properties[entry.name] = {
      type: numeric ? 'number' : entry.type === 'bool' ? 'boolean' : 'string',
      ...(entry.type === 'enum' ? { enum: [...entry.values] } : {}),
      ...(entry.description === '' ? {} : { description: entry.description }),
      [FIELD_META]: meta,
    };
  }
  return {
    type: 'object',
    properties,
    required: fields.filter((entry) => !entry.nullable).map((entry) => entry.name),
  };
}

/** Fields back from JSON, as the zod object describeFields reads them from. */
export function fieldsFromJson(json: FieldsJson): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, entry] of Object.entries(json.properties)) {
    const base =
      entry.type === 'number'
        ? z.number()
        : entry.type === 'boolean'
          ? z.boolean()
          : entry.enum !== undefined && entry.enum.length > 0
            ? z.enum(entry.enum as [string, ...string[]])
            : z.string();
    const tagged = base.meta({
      [FIELD_META]: entry[FIELD_META],
      ...(entry.description === undefined ? {} : { description: entry.description }),
    });
    shape[name] = json.required.includes(name) ? tagged : tagged.nullable().optional();
  }
  return z.object(shape);
}

const fieldsJson = z.object({
  type: z.literal('object'),
  properties: z.record(
    z.string(),
    z.object({
      type: z.enum(['string', 'number', 'boolean']),
      enum: z.array(z.string()).optional(),
      description: z.string().optional(),
      [FIELD_META]: z.object({ type: z.string() }).loose(),
    }),
  ),
  required: z.array(z.string()),
});

const contractJson = z.object({
  format: z.literal(CONTRACT_FORMAT),
  formatVersion: z.literal(FORMAT_VERSION),
  id: z.string(),
  version: z.string(),
  description: z.string(),
  actions: z.record(
    z.string(),
    z.object({ label: z.string(), description: z.string(), params: fieldsJson.optional() }).loose(),
  ),
  contexts: z.record(z.string(), z.array(z.string())),
  sources: z.record(
    z.string(),
    z
      .object({ label: z.string(), description: z.string(), row: fieldsJson, key: z.string() })
      .loose(),
  ),
  regions: z.record(z.string(), z.object({ label: z.string(), description: z.string() }).loose()),
  routes: z.record(z.string(), z.object({ path: z.string() }).loose()),
  surfaces: z.record(
    z.string(),
    z
      .object({
        kind: z.enum(['list', 'choice', 'collection', 'page']),
        label: z.string(),
        description: z.string(),
      })
      .loose(),
  ),
  hash: z.string().optional(),
});

/**
 * Loads a contract from JSON. It is checked as `defineApp` checks any contract; validators can
 * be reattached through `runtime`, since JSON can't carry them.
 */
export function fromJson(raw: unknown, runtime: Runtime = {}): Contract {
  const parsed = contractJson.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Not a Uitive contract: ${issue?.path.join('.') || 'value'} ${issue?.message ?? ''}`.trim(),
    );
  }
  const json = raw as ContractJson;
  const validator = (key: string) => runtime.validators?.[key];

  const actions: Record<string, ActionSpec> = {};
  for (const [id, entry] of Object.entries(json.actions)) {
    const { params, ...rest } = entry;
    actions[id] = { ...rest, ...(params === undefined ? {} : { params: fieldsFromJson(params) }) };
  }
  const sources: Record<string, AnySourceSpec> = {};
  for (const [id, entry] of Object.entries(json.sources)) {
    sources[id] = { ...entry, row: fieldsFromJson(entry.row) };
  }
  const surfaces: Record<string, SurfaceSpec> = {};
  for (const [id, entry] of Object.entries(json.surfaces)) {
    if (entry.kind === 'list') {
      const { available, ...rest } = entry;
      surfaces[id] = {
        ...rest,
        ...(available === undefined
          ? {}
          : { available: (value: string) => available[value] ?? rest.items }),
      };
    } else if (entry.kind === 'choice') {
      surfaces[id] = { ...entry };
    } else if (entry.kind === 'collection') {
      const { item, title, ...rest } = entry;
      const check = validator(id);
      const spec: CollectionSpec = {
        ...rest,
        item: z.fromJSONSchema(item as never),
        title: (value) => String((value as Record<string, unknown>)[title] ?? ''),
        ...(check === undefined ? {} : { validate: check as CollectionSpec['validate'] }),
      };
      surfaces[id] = spec;
    } else {
      const { blocks, standard, generic, ...rest } = entry;
      const spec: AnyPageSpec = {
        ...rest,
        ...(generic === undefined ? {} : { generic: generic as AnyPageSpec['generic'] }),
        blocks: Object.fromEntries(
          Object.entries(blocks).map(([name, block]) => {
            const check = validator(`${id}.${name}`);
            const built: BlockSpec = {
              label: block.label,
              description: block.description,
              props: z.fromJSONSchema(block.props as never),
              ...(check === undefined ? {} : { validate: check as BlockSpec['validate'] }),
            };
            return [name, built];
          }),
        ),
        standard: (value) =>
          (value === undefined ? undefined : standard.values?.[value]) ?? standard.page,
      };
      surfaces[id] = spec;
    }
  }

  return defineApp({
    id: json.id,
    version: json.version,
    description: json.description,
    actions,
    contexts: json.contexts,
    sources,
    regions: json.regions,
    routes: json.routes,
    surfaces,
  }) as unknown as Contract;
}
