import { z } from 'zod';
import {
  actionsInScope,
  BUCKETS,
  builtInBlocks,
  DATA_BLOCKS,
  DIRECTIONS,
  genericFor,
  MEASURES,
  METRICS,
  OPS,
  qualifiedFields,
  rowParam,
  type AnyContract,
  type AnyPageSpec,
  type GenericName,
  type ResolvedSource,
  type Subset,
  USER_PAGES,
} from '@plurid/uitive-core';

type Json = Record<string, unknown>;

/** The enum values a planner may emit for actions, contexts and the like, lower-cased once. */
export interface Vocabulary {
  /** The lists' surface names. */
  lists: string[];
  /** The choices' surface names. */
  choices: string[];
  /** The pages' surface names. */
  pages: string[];
  /** Every action ID. */
  actions: string[];
  /** Every context value. */
  contexts: string[];
  /** Every choice value. */
  values: string[];
  /** Every region name. */
  regions: string[];
}

/**
 * Every value a planner may emit for a contract, lower-cased once: action IDs, surfaces by kind,
 * contexts and choice values.
 */
export function vocabulary(contract: AnyContract): Vocabulary {
  const kind = (wanted: string) =>
    contract.surfaceIds.filter((id) => contract.surfaces[id]?.kind === wanted).sort();
  const values = contract.surfaceIds.flatMap((id) => {
    const spec = contract.surfaces[id];
    return spec?.kind === 'choice' ? [...spec.values] : [];
  });
  return {
    lists: kind('list'),
    choices: kind('choice'),
    pages: kind('page'),
    actions: [...contract.actionIds].sort(),
    contexts: [...new Set(Object.values(contract.contexts).flat())].sort(),
    values: [...new Set(values)].sort(),
    regions: Object.keys(contract.regions).sort(),
  };
}

/** What part of a contract a schema covers. */
export interface SchemaOptions {
  /** Scopes sources, and the actions that act on them, to part of a large contract. */
  subset?: Subset;
  /** Whether the application's own blocks are offered. @default true */
  native?: boolean;
}

/**
 * Compiles a contract into the one structured-output schema every call uses: flat operation
 * lists with every field required and explicit `none` sentinels, shared enums under `$defs`,
 * and pages as flat elements that name their children, since grammars can't recurse.
 * One schema per contract means one compiled grammar and one warm prompt cache.
 */
export function outputSchema(
  contract: AnyContract,
  options: SchemaOptions = {},
): Record<string, unknown> {
  const words = vocabulary(contract);
  const subset = options.subset;
  const defs: Json = {};
  const props: Json = {};
  const required: string[] = [];
  const enumOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
  const add = (name: string, schema: Json) => {
    props[name] = schema;
    required.push(name);
  };

  // Scoped requests name only list items and their subset's actions, however large the contract.
  const actions = subset === undefined ? words.actions : actionsInScope(contract, subset);
  defs.action = enumOf(actions.length > 0 ? actions : ['none']);
  defs.context = enumOf(['none', '*', ...words.contexts]);
  defs.basis = { type: 'string', enum: ['request', 'goal', 'usage'] };
  defs.metric = enumOf(['none', ...METRICS]);

  add('status', {
    type: 'string',
    enum: ['done', 'ambiguous', 'unsupported'],
    description:
      'For requests: done, ambiguous (several things fit) or unsupported (outside the app)',
  });
  add('candidates', { type: 'array', items: { type: 'string' } });
  add('note', {
    type: 'string',
    description: 'One short plain sentence, without numbers; may be empty',
  });

  if (words.lists.length > 0) {
    add('lists', {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['surface', 'context', 'op', 'target', 'index', 'basis', 'metric'],
        properties: {
          surface: enumOf(words.lists),
          context: { $ref: '#/$defs/context' },
          op: enumOf(['promote', 'demote', 'move', 'pin', 'unpin', 'hide', 'restore']),
          target: { $ref: '#/$defs/action' },
          index: { type: 'integer', description: 'Position for move; -1 otherwise' },
          basis: { $ref: '#/$defs/basis' },
          metric: { $ref: '#/$defs/metric' },
        },
      },
    });
  }
  if (words.choices.length > 0) {
    add('choices', {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['surface', 'value', 'basis'],
        properties: {
          surface: enumOf(words.choices),
          value: enumOf(words.values),
          basis: { $ref: '#/$defs/basis' },
        },
      },
    });
  }
  if (words.pages.length > 0) {
    const element = (name: string, props: Json): Json => ({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'block', 'props', 'children'],
      properties: {
        id: { type: 'string' },
        block: { type: 'string', const: name },
        props,
        children: { type: 'array', items: { type: 'string' } },
      },
    });
    // One inline union over every block: the schema holds a single union however many there are.
    const variants: Json[] = [
      element('section', propsSchema(builtInBlocks.section.props, defs)),
      element('tabs', propsSchema(builtInBlocks.tabs.props, defs)),
    ];
    if (words.regions.length > 0) {
      variants.push(
        element('region', {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: enumOf(words.regions) },
        }),
      );
    }
    const seen = new Set<string>();
    for (const id of words.pages) {
      const spec = contract.surfaces[id] as AnyPageSpec;
      for (const [name, block] of Object.entries(spec.blocks).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        if (seen.has(name)) continue;
        seen.add(name);
        if (options.native !== false) variants.push(element(name, propsSchema(block.props, defs)));
      }
    }
    const sources = subset?.sources ?? contract.sourceIds;
    const offered = new Set<GenericName>(
      words.pages.flatMap((id) => genericFor(contract, contract.surfaces[id] as AnyPageSpec)),
    );
    const withData = sources.length > 0 && [...offered].some((name) => DATA_BLOCKS.includes(name));
    if (withData) queryDefs(contract, defs, sources);
    for (const name of [...offered].filter((entry) => !seen.has(entry))) {
      if (DATA_BLOCKS.includes(name) && !withData) continue;
      variants.push(element(name, genericProps(name, contract, words, defs, subset)));
    }
    add('pages', {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'surface',
          'context',
          'op',
          'slug',
          'title',
          'root',
          'elements',
          ...(withData ? ['data'] : []),
          'basis',
        ],
        properties: {
          surface: enumOf([...words.pages, USER_PAGES]),
          context: { $ref: '#/$defs/context' },
          op: enumOf(['set', 'reset', 'create', 'rename', 'delete']),
          slug: {
            type: 'string',
            description:
              'For userPages: the page address, short lowercase words joined by dashes; else empty',
          },
          title: { type: 'string', description: 'For userPages create and rename; else empty' },
          root: { type: 'string', description: 'The id of the outermost element' },
          elements: { type: 'array', items: { anyOf: variants } },
          ...(withData
            ? {
                data: {
                  type: 'array',
                  description: 'Named queries; every one shown by a block',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'query'],
                    properties: { name: { type: 'string' }, query: { $ref: '#/$defs/query' } },
                  },
                },
              }
            : {}),
          basis: { $ref: '#/$defs/basis' },
        },
      },
    });
  }

  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties: props,
    $defs: defs,
  };
}

const enumOf = (values: readonly string[]): Json => ({ type: 'string', enum: [...values] });
const object = (properties: Json): Json => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const array = (items: Json): Json => ({ type: 'array', items });
const field = { $ref: '#/$defs/field' };

/** Every qualified field and the query format, shared by every block that shows data. */
function queryDefs(contract: AnyContract, defs: Json, ids: readonly string[]): void {
  const sources = Object.fromEntries(
    contract.sourceIds.map((id) => [id, contract.source(id) as ResolvedSource]),
  );
  defs.field = enumOf(['none', ...qualifiedFields(sources, ids)]);
  defs.query = object({
    source: enumOf(ids),
    fields: array(field),
    filter: array(object({ field, op: enumOf(OPS), values: array({ type: 'string' }) })),
    sort: array(object({ field, direction: enumOf(DIRECTIONS) })),
    limit: { type: 'integer' },
    search: { type: 'string', description: 'Text to look for, or empty' },
    aggregate: object({
      measure: enumOf(MEASURES),
      of: field,
      by: field,
      split: field,
      bucket: enumOf(BUCKETS),
    }),
  });
}

/** A generic block's props, with the contract's names as enums so only real ones are emitted. */
function genericProps(
  name: GenericName,
  contract: AnyContract,
  words: Vocabulary,
  defs: Json,
  subset: Subset | undefined,
): Json {
  // In a subset, actions tied to a source come only with that source's area.
  const tied = (id: string) =>
    rowParam(contract.params(id)) !== undefined ||
    (contract.actions[id]?.invalidates ?? []).length > 0;
  const runs = contract.actionIds
    .filter((id) => contract.actions[id]?.effect !== undefined)
    .filter((id) => subset === undefined || subset.actions.includes(id) || !tied(id))
    .sort();
  const rowActions = runs.filter((id) => rowParam(contract.params(id)) !== undefined);
  const params = runs.flatMap((id) => contract.params(id).map((entry) => `${id}:${entry.name}`));
  if (params.length > 0) defs.param = enumOf(params);
  const set = array(
    object({
      param: params.length > 0 ? { $ref: '#/$defs/param' } : { type: 'string' },
      value: { type: 'string', description: 'A value, $current, or $row.<field> in row actions' },
    }),
  );
  const run = (actions: readonly string[]) =>
    object({ action: actions.length > 0 ? enumOf(actions) : { $ref: '#/$defs/action' }, set });
  const data = { type: 'string', description: 'The name of one of the page’s queries' };
  const link = enumOf(['none', 'entity']);
  switch (name) {
    case 'table':
      return object({
        data,
        columns: array(field),
        lookups: array(object({ data, label: { type: 'string' } })),
        rowActions: array(run(rowActions)),
        density: enumOf(['comfortable', 'compact']),
        link,
      });
    case 'list':
      return object({
        data,
        title: field,
        subtitle: field,
        meta: field,
        badge: field,
        rowActions: array(run(rowActions)),
        link,
      });
    case 'detail':
      return object({ data, fields: array(field), columns: { type: 'integer' } });
    case 'metric':
      return object({ data, label: { type: 'string' }, compare: enumOf(['none', 'previous']) });
    case 'chart':
      return object({
        data,
        kind: enumOf(['line', 'bar', 'area', 'pie']),
        stacked: { type: 'boolean' },
      });
    case 'timeline':
      return object({ data, time: field, title: field, detail: field });
    case 'board':
      return object({ data, column: field, title: field, meta: field });
    case 'form':
      return object({
        action: enumOf(runs.filter((id) => contract.params(id).length > 0)),
        set,
      });
    case 'actions':
      return object({
        list: enumOf(['none', ...words.lists]),
        items: array(object({ action: { $ref: '#/$defs/action' }, set })),
        size: enumOf(['small', 'regular', 'large']),
      });
    case 'note':
      return object({ title: { type: 'string' }, text: { type: 'string' } });
    case 'links':
      return object({
        items: array(
          object({
            label: { type: 'string' },
            route: enumOf(contract.routeIds),
            entity: { type: 'string', description: 'The row key, for routes about one row' },
          }),
        ),
      });
  }
}

/**
 * A block's props as JSON Schema, every field required, with large enums hoisted into `$defs`
 * so each appears once in the grammar however many blocks use it.
 */
function propsSchema(schema: z.ZodType, defs: Json): Json {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' }) as Json;
  delete json.$schema;
  return hoist(json, defs) as Json;
}

function hoist(node: unknown, defs: Json): unknown {
  if (Array.isArray(node)) return node.map((entry) => hoist(entry, defs));
  if (node === null || typeof node !== 'object') return node;
  const entries = Object.entries(node as Json).map(
    ([key, value]) => [key, hoist(value, defs)] as const,
  );
  const object = Object.fromEntries(entries) as Json;
  if (Array.isArray(object.enum) && object.enum.length > 12) {
    const values = object.enum as string[];
    const name = `enum${hashValues(values)}`;
    defs[name] = { type: 'string', enum: values };
    return { $ref: `#/$defs/${name}` };
  }
  if (object.type === 'object' && object.properties) {
    object.required = Object.keys(object.properties as Json);
    object.additionalProperties = false;
  }
  // Numeric and length bounds aren't supported by structured outputs; policy enforces them.
  for (const key of [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minLength',
    'maxLength',
  ]) {
    delete object[key];
  }
  return object;
}

function hashValues(values: readonly string[]): string {
  let hash = 7;
  for (const char of values.join('|')) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

/** How big a schema is: its bytes, and its largest enum, which grammars pay for most. */
export function size(schema: unknown): { bytes: number; largestEnum: number } {
  let largestEnum = 0;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    const object = node as Json;
    if (Array.isArray(object.enum)) largestEnum = Math.max(largestEnum, object.enum.length);
    Object.values(object).forEach(visit);
  };
  visit(schema);
  return { bytes: JSON.stringify(schema).length, largestEnum };
}

/** Counts what structured outputs limit per request: optional and union-typed parameters. */
export function limits(schema: unknown): { optional: number; unions: number } {
  let optional = 0;
  let unions = 0;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    const object = node as Json;
    if (object.type === 'object' && object.properties) {
      const required = new Set((object.required as string[] | undefined) ?? []);
      optional += Object.keys(object.properties as Json).filter((key) => !required.has(key)).length;
    }
    if (Array.isArray(object.anyOf) || Array.isArray(object.type)) unions++;
    Object.values(object).forEach(visit);
  };
  visit(schema);
  return { optional, unions };
}
