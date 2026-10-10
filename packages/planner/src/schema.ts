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
      element('section', propsSchema('section', builtInBlocks.section.props, defs)),
      element('tabs', propsSchema('tabs', builtInBlocks.tabs.props, defs)),
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
    const offered = offer(contract, words, defs, options);
    for (const [name, block] of offered.own) {
      variants.push(element(name, propsSchema(name, block.props, defs)));
    }
    for (const { name, props } of offered.generic) variants.push(element(name, props));
    const withData = offered.data;
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

interface Offered {
  /** The application's own blocks offered, by name. */
  own: [string, AnyPageSpec['blocks'][string]][];
  /** The generic blocks offered, with their props' schemas. */
  generic: { name: GenericName; props: Json }[];
  /** Whether pages may name queries: some source is in scope and a block shows data. */
  data: boolean;
}

/**
 * What pages may be built from, besides sections, tabs and regions: the application's own blocks,
 * unless `native` is false, and the generic blocks its pages allow that the scope can feed. A
 * generic block that would name nothing, such as a form when no action in scope takes params, is
 * left out.
 */
function offer(
  contract: AnyContract,
  words: Vocabulary,
  defs: Json,
  options: SchemaOptions,
): Offered {
  const offered: Offered = { own: [], generic: [], data: false };
  const seen = new Set<string>();
  for (const id of words.pages) {
    const spec = contract.surfaces[id] as AnyPageSpec;
    for (const [name, block] of Object.entries(spec.blocks).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (options.native !== false) offered.own.push([name, block]);
    }
  }
  const sources = options.subset?.sources ?? contract.sourceIds;
  const allowed = new Set<GenericName>(
    words.pages.flatMap((id) => genericFor(contract, contract.surfaces[id] as AnyPageSpec)),
  );
  offered.data = sources.length > 0 && [...allowed].some((name) => DATA_BLOCKS.includes(name));
  if (offered.data) queryDefs(contract, defs, sources);
  // A page's own block of the same name replaces the generic one, offered or not.
  for (const name of [...allowed].filter((entry) => !seen.has(entry))) {
    if (DATA_BLOCKS.includes(name) && !offered.data) continue;
    const props = genericProps(name, contract, words, defs, options.subset);
    if (!emptyEnum(props)) offered.generic.push({ name, props });
  }
  return offered;
}

/**
 * The blocks a request's schema offers pages besides sections, tabs and regions, by name: the
 * application's own, unless `native` is false, and the generic blocks its scope can feed. The
 * prompt describes these, so it never names a block the schema leaves out.
 */
export function offeredBlocks(
  contract: AnyContract,
  options: SchemaOptions = {},
): { own: string[]; generic: GenericName[] } {
  const offered = offer(contract, vocabulary(contract), {}, options);
  return {
    own: offered.own.map(([name]) => name),
    generic: offered.generic.map((entry) => entry.name),
  };
}

/** Whether a schema holds an enum with no values, which no answer could satisfy. */
function emptyEnum(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(emptyEnum);
  if (node === null || typeof node !== 'object') return false;
  const object = node as Json;
  if (Array.isArray(object.enum) && object.enum.length === 0) return true;
  return Object.values(object).some(emptyEnum);
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
  // In a subset, only the actions in scope run: list items, its areas' and those its words name.
  const inScope = subset === undefined ? undefined : new Set(actionsInScope(contract, subset));
  const runs = contract.actionIds
    .filter((id) => contract.actions[id]?.effect !== undefined)
    .filter((id) => inScope === undefined || inScope.has(id))
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
            entity: {
              type: 'string',
              description:
                "$current for a route about one row, on a page about that route's source; else empty. Never a row key",
            },
          }),
        ),
      });
  }
}

/**
 * A block's props as JSON Schema, every field required, with large enums hoisted into `$defs`
 * so each appears once in the grammar however many blocks use it. Props structured outputs can't
 * take (records, unions and nullable values) fail here, so `uitive check` reports them.
 */
function propsSchema(block: string, schema: z.ZodType, defs: Json): Json {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' }) as Json;
  delete json.$schema;
  const problems: string[] = [];
  const hoisted = hoist(json, defs, '', problems) as Json;
  if (problems.length > 0) {
    throw new Error(
      `Block ${block} has props models can't be given: ${problems.join('; ')}. Use an enum, an empty string or 'none' for no value, and an array of objects for a record`,
    );
  }
  return hoisted;
}

/** Bounds structured outputs don't support; policy enforces them when it checks the props. */
const BOUNDS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
]);

function hoist(node: unknown, defs: Json, path: string, problems: string[]): unknown {
  if (Array.isArray(node)) return node.map((entry) => hoist(entry, defs, path, problems));
  if (node === null || typeof node !== 'object') return node;
  const raw = node as Json;
  const at = path === '' ? 'props' : path;
  if (['anyOf', 'oneOf', 'allOf'].some((key) => key in raw)) {
    problems.push(`${at} is a union`);
    return raw;
  }
  if (Array.isArray(raw.type)) {
    problems.push(`${at} is nullable or of several types`);
    return raw;
  }
  const open = typeof raw.additionalProperties === 'object' && raw.properties === undefined;
  if ('propertyNames' in raw || 'patternProperties' in raw || open) {
    problems.push(`${at} is a record`);
    return raw;
  }
  const object: Json = {};
  for (const [key, value] of Object.entries(raw)) {
    if (BOUNDS.has(key)) continue;
    if (key === 'properties') {
      object[key] = Object.fromEntries(
        Object.entries(value as Json).map(([name, child]) => [
          name,
          hoist(child, defs, path === '' ? name : `${path}.${name}`, problems),
        ]),
      );
    } else {
      object[key] = hoist(value, defs, key === 'items' ? `${at}[]` : path, problems);
    }
  }
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
