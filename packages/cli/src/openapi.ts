import { normalize, upgrade } from '@scalar/openapi-parser';
import { FIELD_PATTERN, OPS_BY_TYPE, pointer, SOURCE_PATTERN } from '@plurid/uitive-core';
import type { Effect, FieldType, Op, RestAction, RestSource } from '@plurid/uitive-core';

type Json = Record<string, unknown>;

/**
 * One field of an API's rows, as the mapper reads it: its type, meaning and where it is in a row.
 */
export interface ApiField {
  /** The field's name in the contract. */
  name: string;
  /** What the value means, which decides how it shows and filters. */
  type: FieldType;
  /** Whether rows may lack a value. */
  nullable: boolean;
  /** What the field holds, from the API description. */
  description: string;
  /** For enums. */
  values: string[];
  /** For times: an ISO string, or seconds or milliseconds since 1970. */
  unit?: 'iso' | 's' | 'ms';
  /** For money: the field holding the currency. */
  currency?: string;
  /** For money: whether amounts are in minor units, such as cents. */
  minor?: boolean;
  /** For refs: the source referred to. */
  source?: string;
  /** For a value lifted from a nested object or renamed: where it is in a row. */
  pointer?: string;
  /** What people call it, when its name doesn't say, such as "Order" for `display_id`. */
  label?: string;
}

/** Something the mapper left out, and why. */
export interface Skipped {
  /** What was left out, such as a field or an operation. */
  name: string;
  /** Why, in a few words. */
  reason: string;
}

/**
 * One source the mapper read from an API description: its fields, capabilities and REST endpoint.
 */
export interface ApiSource {
  /** The source's ID, which the curation uses. */
  id: string;
  /** What people call it. */
  label: string;
  /** What its rows are, for people and models. */
  description: string;
  /** Other words people use for it, so requests find it. */
  keywords: string[];
  /** The row schema's component name, when it has one. */
  schema: string;
  /** The operation that lists its rows, such as `GET /v1/charges`. */
  operation: string;
  /** The field that identifies a row. */
  key: string;
  /** The field that names a row. */
  title: string;
  /** The fields that sum a row up. */
  summary: string[];
  /** The fields kept. */
  fields: ApiField[];
  /** Fields understood but left out to keep the source small; the curation can bring them back. */
  extra: ApiField[];
  /** Fields left out, and why. */
  skipped: Skipped[];
  /** What the endpoint does by itself: filters by field, sorting, search and paging. */
  capabilities: {
    filter: Record<string, Op[]>;
    sort: string[];
    search: boolean;
    pagination: 'cursor' | 'offset' | 'none';
  };
  /** How `restFetch` reads it. */
  rest: RestSource;
  /** Guesses worth checking against the running API. */
  notes: string[];
  /** Most rows fetched to answer one query on the client, when the curation sets it. */
  scan?: number;
  /** Seconds a result stays fresh, when the curation sets it. */
  ttl?: number;
}

/** One param of an action, as the mapper reads it. */
export interface ApiParam extends ApiField {
  /** Whether a run needs it. */
  required: boolean;
}

/** One action the mapper read from an API description: its params, effect, and REST endpoint. */
export interface ApiAction {
  /** The action's ID, which the curation uses. */
  id: string;
  /** What people call it. */
  label: string;
  /** What it does, for people and models. */
  description: string;
  /** The operation it runs, such as `POST /v1/refunds`. */
  operation: string;
  /** The source the action works on, when there is one. */
  resource: string | null;
  /** What a run does to data: `read`, `write` or `destructive`. */
  effect: Effect;
  /** Why the effect was chosen. */
  reason: string;
  /** What a run takes, besides the path's own params. */
  params: ApiParam[];
  /** Params left out, and why. */
  skipped: Skipped[];
  /** Sources a run changes, so results that read them refresh. */
  invalidates: string[];
  /** How `restPerform` runs it. */
  rest: RestAction;
  /** For destructive actions: the phrase a run asks for. */
  confirm?: string;
  /** Qualified filters on the row's source, such as `charges.status`. */
  when?: { field: string; op: Op; values: string[] }[];
}

/** Everything the mapper read from an API description: sources, actions, and what it skipped. */
export interface ApiInventory {
  /** The API's title, from its description. */
  title: string;
  /** The API's version, from its description. */
  version: string;
  /** The base URL requests go to. */
  server: string;
  /** Every source read. */
  sources: ApiSource[];
  /** Every action read. */
  actions: ApiAction[];
  /** Operations that became neither, and why. */
  skipped: { operation: string; reason: string }[];
}

const MAX_FIELDS = 40;
const MAX_MONEY = 6;
const MAX_OPTIONAL_PARAMS = 8;
const MAX_ENUM = 60;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Reads an OpenAPI 2.0, 3.0 or 3.1 document, JSON or YAML, as OpenAPI 3.1. */
export function readSpec(source: string | Record<string, unknown>): Record<string, unknown> {
  const normalised = normalize(source as string);
  if (!isObject(normalised) || Array.isArray(normalised)) {
    throw new Error('Expected one OpenAPI document');
  }
  const { specification } = upgrade(normalised);
  if (!isObject(specification) || !isObject(specification.paths)) {
    throw new Error('Not an OpenAPI 2.0, 3.0 or 3.1 document with paths');
  }
  return specification;
}

/** Plain text from a description: no HTML or Markdown, whole sentences, at most `length` characters. */
export function plain(value: string, length = 240): string {
  const flat = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/&nbsp;|&#\d+;|&[a-z]+;/g, ' ')
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= length) return flat;
  // Sentences end at punctuation followed by a space, so "$1.00" stays whole.
  let out = '';
  for (const sentence of flat.split(/(?<=[.!?])\s+/)) {
    if (`${out} ${sentence}`.trim().length > length) break;
    out = `${out} ${sentence}`.trim();
  }
  return out || `${flat.slice(0, length - 3).trimEnd()}...`;
}

/** An English word in the singular, as source IDs need for relations: `orders` gives `order`. */
export function singular(word: string): string {
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(ches|shes|xes|zes|sses|uses)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** A name in kebab case, as IDs are written: `OrderItems` gives `order-items`. */
export const kebab = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const snake = (value: string) => kebab(value).replace(/-/g, '_');

/** Sentence case, keeping acronyms. */
const sentence = (value: string) =>
  value
    .split(/\s+/)
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : /^[A-Z0-9]{2,}$/.test(word) || /[a-z][A-Z]/.test(word)
          ? word
          : word.toLowerCase(),
    )
    .join(' ');

/** What a schema says once references, `allOf` and nullability are resolved. */
interface View {
  name: string;
  types: Set<string>;
  nullable: boolean;
  format: string;
  values: unknown[];
  description: string;
  properties: Map<string, unknown>;
  required: Set<string>;
  items: unknown;
  members: View[];
}

class Resolver {
  constructor(private readonly doc: Json) {}

  target(node: unknown): { node: Json; name: string } {
    let current = node;
    let name = '';
    for (let hops = 0; hops < 32 && isObject(current) && typeof current.$ref === 'string'; hops++) {
      const ref = current.$ref;
      if (!ref.startsWith('#')) {
        throw new Error(
          `External reference ${ref}: bundle the spec into one file first, for example with \`npx @redocly/cli bundle\``,
        );
      }
      name = decodeURIComponent(ref.slice(ref.lastIndexOf('/') + 1));
      current = pointer(this.doc, ref.slice(1));
    }
    return { node: isObject(current) ? current : {}, name };
  }

  view(node: unknown, depth = 0): View {
    const { node: schema, name } = this.target(node);
    const view: View = {
      name,
      types: new Set(),
      nullable: false,
      format: text(schema.format),
      values: Array.isArray(schema.enum) ? schema.enum : [],
      description: text(schema.description),
      properties: new Map(),
      required: new Set(),
      items: schema.items,
      members: [],
    };
    if (depth > 8) return view;
    const types = schema.type;
    for (const type of Array.isArray(types) ? types : types === undefined ? [] : [types]) {
      if (type === 'null') view.nullable = true;
      else view.types.add(String(type));
    }
    if (schema.nullable === true) view.nullable = true;
    if (isObject(schema.properties)) {
      for (const [key, value] of Object.entries(schema.properties)) view.properties.set(key, value);
    }
    if (Array.isArray(schema.required))
      for (const key of schema.required) view.required.add(String(key));
    for (const part of Array.isArray(schema.allOf) ? schema.allOf : []) {
      merge(view, this.view(part, depth + 1), false);
    }
    const union = [
      ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
      ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
    ];
    for (const part of union) {
      const member = this.view(part, depth + 1);
      const onlyNull = member.types.size === 0 && member.nullable && member.properties.size === 0;
      if (member.nullable) view.nullable = true;
      if (!onlyNull) view.members.push(member);
    }
    const [only] = view.members;
    if (view.members.length === 1 && only && view.types.size === 0) {
      merge(view, only, true);
      view.members = [];
    }
    if (view.types.size === 0 && view.members.length === 0) {
      if (view.properties.size > 0) view.types.add('object');
      else if (view.items !== undefined) view.types.add('array');
      else if (view.values.length > 0) view.types.add(typeof view.values[0]);
    }
    return view;
  }
}

function merge(into: View, from: View, named: boolean) {
  for (const type of from.types) into.types.add(type);
  for (const [key, value] of from.properties)
    if (!into.properties.has(key)) into.properties.set(key, value);
  for (const key of from.required) into.required.add(key);
  into.nullable ||= from.nullable;
  into.format ||= from.format;
  into.description ||= from.description;
  if (into.values.length === 0) into.values = from.values;
  into.items ??= from.items;
  into.members.push(...from.members);
  if (named) into.name ||= from.name;
}

type Scalar = 'string' | 'number' | 'integer' | 'boolean';

function scalarOf(view: View): Scalar | undefined {
  const types = [...view.types];
  if (types.length === 2 && types.includes('integer') && types.includes('number')) return 'number';
  const [type] = types;
  if (types.length !== 1) return undefined;
  return type === 'string' || type === 'number' || type === 'integer' || type === 'boolean'
    ? type
    : undefined;
}

interface Index {
  /** Row schema name to source id. */
  bySchema: Map<string, string>;
  /** Singular snake-case name to source id, such as `payment_intent` to `payment-intents`. */
  byName: Map<string, string>;
}

const PREFIXES = /^(v\d+(\.\d+)?|api|rest|admin|public|internal)$/i;
const MONEY_NAME =
  /(^|_)(amount|total|subtotal|price|cost|balance|fee|tax|discount|refunded|captured|net|gross)(_|$)/;
const TIME_NAME = /(^|_)(created|updated|deleted|date|time|timestamp)$|_at$|_on$/;
const DESTRUCTIVE = new Set([
  'refund',
  'void',
  'capture',
  'payout',
  'transfer',
  'pay',
  'charge',
  'confirm',
  'approve',
  'decline',
  'cancel',
  'close',
  'reject',
  'revoke',
  'terminate',
  'archive',
  'delete',
  'remove',
  'purge',
  'reset',
  'disable',
  'deactivate',
  'expire',
  'finalize',
  'finalise',
  'uncollectible',
  'reverse',
  'send',
  'submit',
  'ship',
  'shipment',
  'fulfill',
  'fulfil',
  'fulfillment',
  'complete',
  'authorize',
  'authorise',
]);

/** The source a field names, such as `customer_id`, or `type_id` on products for `product-types`. */
function refTarget(name: string, index: Index, owner: string): string | undefined {
  if (name === 'id') return undefined;
  const base = /_id$/.test(name)
    ? name.slice(0, -3)
    : /[a-z]Id$/.test(name)
      ? snake(name.slice(0, -2))
      : name;
  return (
    index.byName.get(base) ?? (owner === '' ? undefined : index.byName.get(`${owner}_${base}`))
  );
}

function currencyFor(name: string, siblings: ReadonlyMap<string, View>): string | undefined {
  const prefix = name.split('_')[0] ?? '';
  for (const candidate of ['currency', 'currency_code', `${prefix}_currency`]) {
    const sibling = siblings.get(candidate);
    if (sibling && scalarOf(sibling) === 'string') return candidate;
  }
  return undefined;
}

type Classified = { field: Omit<ApiField, 'name'> } | { reason: string };

function classify(
  name: string,
  view: View,
  siblings: ReadonlyMap<string, View>,
  index: Index,
  owner = '',
): Classified {
  const base = { nullable: view.nullable, description: plain(view.description, 160), values: [] };
  let scalar = scalarOf(view);
  if (view.members.length > 0) {
    // An id, or the object it names when expanded (Stripe's style).
    const target = view.members.map((member) => index.bySchema.get(member.name)).find(Boolean);
    if (target && view.members.some((member) => scalarOf(member) === 'string')) {
      return { field: { ...base, type: 'ref', source: target } };
    }
    const scalars = new Set(view.members.map(scalarOf));
    const [first] = scalars;
    // An id or a named object is an id; `''` beside an object (to clear it) is not.
    const id = (member: View) =>
      scalarOf(member) === 'string' &&
      (member.values.length === 0 || member.values.some((value) => value !== ''));
    if (
      view.members.some(id) &&
      view.members.every((member) => id(member) || (objectLike(member) && member.name !== ''))
    ) {
      scalar = 'string';
    } else if (scalars.size !== 1 || first === undefined) {
      return { reason: 'a union' };
    } else {
      scalar = first;
    }
  }
  if (!scalar) {
    if (view.types.has('object')) return { reason: view.name ? `nested ${view.name}` : 'nested' };
    if (view.types.has('array')) return { reason: 'a list' };
    return { reason: 'untyped' };
  }
  if (scalar === 'boolean') return { field: { ...base, type: 'bool' } };
  if (scalar === 'string') {
    if (view.format === 'date-time' || view.format === 'date') {
      return { field: { ...base, type: 'time', unit: 'iso' } };
    }
    const values = view.values.filter((value): value is string => typeof value === 'string');
    if (view.values.length === 1) return { reason: 'a constant' };
    if (values.length >= 2 && values.length <= MAX_ENUM) {
      return { field: { ...base, type: 'enum', values } };
    }
    const target = refTarget(name, index, owner);
    if (target) return { field: { ...base, type: 'ref', source: target } };
    if (/_at$/.test(name) && /date|time/i.test(view.description)) {
      return { field: { ...base, type: 'time', unit: 'iso' } };
    }
    return { field: { ...base, type: 'text' } };
  }
  if (
    view.format === 'unix-time' ||
    (scalar === 'integer' && TIME_NAME.test(name)) ||
    /seconds since|unix (time|epoch)/i.test(view.description)
  ) {
    return {
      field: { ...base, type: 'time', unit: /millisecond/i.test(view.description) ? 'ms' : 's' },
    };
  }
  const currency = currencyFor(name, siblings);
  if (currency && MONEY_NAME.test(name)) {
    const minor = scalar === 'integer' || /smallest currency unit|cents/i.test(view.description);
    return { field: { ...base, type: 'money', currency, minor } };
  }
  return { field: { ...base, type: 'number' } };
}

const TITLES = [
  'name',
  'title',
  'display_name',
  'full_name',
  'label',
  'subject',
  'display_id',
  'number',
  'email',
  'description',
  'code',
  'handle',
  'slug',
];
const PAGE_SIZE = new Set([
  'limit',
  'per_page',
  'perpage',
  'page_size',
  'pagesize',
  'size',
  'take',
]);
const CURSOR = new Set([
  'starting_after',
  'after',
  'cursor',
  'page_token',
  'pagetoken',
  'next_token',
  'continuation_token',
]);
const BACKWARDS = new Set(['ending_before', 'before']);
const OFFSET = new Set(['offset', 'skip']);
const PAGE = new Set(['page', 'page_number']);
const SEARCH = new Set(['q', 'query', 'search', 'term', 'keyword', 'keywords']);
const SORT = new Set(['sort', 'order', 'order_by', 'orderby', 'sort_by', 'sortby', 'ordering']);
const IGNORED = new Set([
  'expand',
  'fields',
  'include',
  'select',
  'embed',
  'populate',
  '$and',
  '$or',
]);
const OPERATORS: Record<string, Op> = {
  eq: 'eq',
  ne: 'ne',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  in: 'in',
  nin: 'nin',
};
const SUFFIXES: [RegExp, Op][] = [
  [/^(.+)_(after|since|from|gte|min|start)$/, 'gte'],
  [/^(.+)_(gt)$/, 'gt'],
  [/^(.+)_(before|until|lt)$/, 'lt'],
  [/^(.+)_(to|lte|max|end)$/, 'lte'],
  [/^min_(.+)$/, 'gte'],
  [/^max_(.+)$/, 'lte'],
];

interface Operation {
  path: string;
  method: string;
  op: Json;
  params: Json[];
  key: string;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function successSchema(
  resolver: Resolver,
  op: Json,
): { schema: unknown; type: string } | undefined {
  const responses = isObject(op.responses) ? op.responses : {};
  const found = ['200', '201', '2XX', '2xx', 'default']
    .map((code) => responses[code])
    .find((response) => response !== undefined);
  const response = resolver.target(found).node;
  const content = isObject(response.content) ? response.content : {};
  const type = Object.keys(content).find((name) => /json/.test(name));
  if (!type) return undefined;
  const media = content[type];
  return isObject(media) ? { schema: media.schema, type } : undefined;
}

const objectLike = (view: View) => view.types.has('object') || view.properties.size > 0;

/** How the mapper reads a description: which nested values to lift into fields. */
export interface InventoryOptions {
  /** Values lifted from nested objects, by source: field name to JSON pointer in a row. */
  picks?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Builds the inventory: every list endpoint a source, every write an action. */
export function inventory(
  doc: Record<string, unknown>,
  options: InventoryOptions = {},
): ApiInventory {
  const resolver = new Resolver(doc);
  const info = isObject(doc.info) ? doc.info : {};
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  const server = text(isObject(servers[0]) ? servers[0].url : '').replace(/\/$/, '');
  const operations: Operation[] = [];
  for (const [path, entry] of Object.entries(isObject(doc.paths) ? doc.paths : {})) {
    const item = resolver.target(entry).node;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;
      const own = Array.isArray(op.parameters) ? op.parameters : [];
      const byName = new Map<string, Json>();
      for (const raw of [...shared, ...own]) {
        const param = resolver.target(raw).node;
        byName.set(`${text(param.in)}:${text(param.name)}`, param);
      }
      operations.push({
        path,
        method,
        op,
        params: [...byName.values()],
        key: text(op.operationId) || `${method.toUpperCase()} ${path}`,
      });
    }
  }
  const skipped: ApiInventory['skipped'] = [];
  const statics = (path: string) =>
    path.split('/').filter((part) => part !== '' && !part.startsWith('{'));
  const tags = new Map<string, string>();
  for (const tag of Array.isArray(doc.tags) ? doc.tags : []) {
    if (isObject(tag)) tags.set(text(tag.name), text(tag.description));
  }

  // First pass: list endpoints and their row schemas, so fields can refer to sources.
  const candidates: Built[] = [];
  for (const operation of operations) {
    if (operation.method !== 'get' || operation.op.deprecated === true) continue;
    const success = successSchema(resolver, operation.op);
    if (!success) continue;
    const response = resolver.view(success.schema);
    const last = statics(operation.path).at(-1) ?? '';
    let listed = rowsOf(resolver, response, last);
    if (!listed) continue;
    if (operation.path.includes('{')) {
      skipped.push({ operation: operation.key, reason: 'a list inside another resource' });
      continue;
    }
    // Some specs leave rows untyped; the endpoint for one row usually says more.
    const endpoint = itemOf(resolver, operations, operation.path, singular(last), listed.item.name);
    if (listed.item.properties.size === 0 && endpoint) {
      listed = { rows: listed.rows, item: endpoint.view };
    }
    const parts = statics(operation.path);
    while (parts.length > 1 && PREFIXES.test(parts[0] ?? '')) parts.shift();
    const id = kebab(parts.join('-'));
    if (!SOURCE_PATTERN.test(id)) {
      skipped.push({ operation: operation.key, reason: `a name no source can have (${id})` });
      continue;
    }
    candidates.push({ operation, id, rows: listed.rows, item: listed.item, response, endpoint });
  }
  const seen = new Map<string, number>();
  for (const candidate of candidates) {
    const count = (seen.get(candidate.id) ?? 0) + 1;
    seen.set(candidate.id, count);
    if (count > 1) candidate.id = `${candidate.id}-${count}`;
  }

  // Which source a field refers to: by its row schema, or by a name such as `customer_id`.
  const index: Index = { bySchema: new Map(), byName: new Map() };
  const named = (id: string) => {
    const words = id.split('-');
    return snake([...words.slice(0, -1), singular(words.at(-1) ?? '')].join('-'));
  };
  const fit = (candidate: Built, schema: string) =>
    snake(schema).endsWith(named(candidate.id)) ? 0 : candidate.operation.path.length;
  const bySchema = new Map<string, Built>();
  for (const candidate of candidates) {
    const schema = candidate.item.name;
    if (!schema) continue;
    const current = bySchema.get(schema);
    if (!current || fit(candidate, schema) < fit(current, schema)) bySchema.set(schema, candidate);
  }
  for (const [schema, candidate] of bySchema) index.bySchema.set(schema, candidate.id);
  for (const candidate of candidates) index.byName.set(named(candidate.id), candidate.id);

  const sources: ApiSource[] = [];
  for (const candidate of candidates) {
    const built = buildSource(
      resolver,
      candidate,
      index,
      tags,
      options.picks?.[candidate.id] ?? {},
    );
    if ('skip' in built) skipped.push({ operation: candidate.operation.key, reason: built.skip });
    else sources.push(built);
  }
  const ids = new Set(sources.map((entry) => entry.id));
  const actions: ApiAction[] = [];
  const taken = new Set<string>();
  for (const operation of operations) {
    if (operation.method === 'get') continue;
    if (operation.op.deprecated === true) {
      skipped.push({ operation: operation.key, reason: 'deprecated' });
      continue;
    }
    const built = buildAction(resolver, operation, sources, ids, index);
    if ('skip' in built) {
      skipped.push({ operation: operation.key, reason: built.skip });
      continue;
    }
    let id = built.id;
    if (taken.has(id)) id = `${id}.${operation.method}`;
    taken.add(id);
    actions.push({ ...built, id });
  }
  return {
    title: text(info.title) || 'API',
    version: text(info.version),
    server,
    sources,
    actions,
    skipped,
  };
}

function rowsOf(
  resolver: Resolver,
  response: View,
  last: string,
): { rows: string; item: View } | undefined {
  if (response.types.has('array')) {
    const item = resolver.view(response.items);
    return objectLike(item) ? { rows: '', item } : undefined;
  }
  if (!objectLike(response)) return undefined;
  const lists: [string, View][] = [];
  for (const [name, raw] of response.properties) {
    const view = resolver.view(raw);
    if (!view.types.has('array')) continue;
    const item = resolver.view(view.items);
    if (objectLike(item)) lists.push([name, item]);
  }
  const preferred = ['data', 'items', 'results', 'records', 'rows', 'entries', last, snake(last)];
  const found = lists.length === 1 ? lists[0] : lists.find(([name]) => preferred.includes(name));
  if (found) return { rows: `/${found[0]}`, item: found[1] };
  // Specs sometimes declare the rows as one object; paging fields beside it give it away.
  const paged = ['count', 'total', 'limit', 'offset', 'has_more', 'next'].some((name) =>
    response.properties.has(name),
  );
  const property = [last, snake(last)].find((name) => response.properties.has(name));
  if (!paged || property === undefined) return undefined;
  const item = resolver.view(response.properties.get(property));
  return objectLike(item) ? { rows: `/${property}`, item } : undefined;
}

/** What a JSON pointer names inside a row schema, for picking nested values. */
function at(
  resolver: Resolver,
  row: View,
  path: string,
): { view: View; siblings: Map<string, View> } | undefined {
  let current = row;
  let siblings = new Map<string, View>();
  for (const raw of path.replace(/^\//, '').split('/')) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current.members.length > 0) current = current.members.find(objectLike) ?? current;
    if (/^\d+$/.test(part) && current.types.has('array')) {
      current = resolver.view(current.items);
      continue;
    }
    const next = current.properties.get(part);
    if (next === undefined) return undefined;
    siblings = new Map([...current.properties].map(([name, raw]) => [name, resolver.view(raw)]));
    current = resolver.view(next);
  }
  return { view: current, siblings };
}

/** The endpoint for one row, such as `/orders/{id}`, and where the row is in its response. */
function itemOf(
  resolver: Resolver,
  operations: readonly Operation[],
  path: string,
  name: string,
  schema: string,
): { path: string; row: string; view: View } | undefined {
  const pattern = new RegExp(`^${literal(path)}/\\{[^}/]+\\}$`);
  const found = operations.find((entry) => entry.method === 'get' && pattern.test(entry.path));
  const success = found && successSchema(resolver, found.op);
  if (!found || !success) return undefined;
  let response = resolver.view(success.schema);
  // A row or its deleted stub, as Stripe answers: the row is the member named like the list's rows.
  if (response.members.length > 0) {
    response =
      response.members.find((member) => schema !== '' && member.name === schema) ??
      response.members.find(objectLike) ??
      response;
  }
  if (!objectLike(response)) return undefined;
  for (const [property, raw] of response.properties) {
    const view = resolver.view(raw);
    if (objectLike(view) && ((schema !== '' && view.name === schema) || property === snake(name))) {
      return { path: found.path, row: `/${property}`, view };
    }
  }
  return { path: found.path, row: '', view: response };
}

interface Built {
  operation: Operation;
  id: string;
  rows: string;
  item: View;
  response: View;
  endpoint: { path: string; row: string; view: View } | undefined;
}

function buildSource(
  resolver: Resolver,
  candidate: Built,
  index: Index,
  tags: ReadonlyMap<string, string>,
  picks: Readonly<Record<string, string>>,
): ApiSource | { skip: string } {
  const { item, operation, id } = candidate;
  const siblings = new Map<string, View>();
  for (const [name, raw] of item.properties) siblings.set(name, resolver.view(raw));
  const fields: ApiField[] = [];
  const skipped: Skipped[] = [];
  for (const [original, view] of siblings) {
    const name = FIELD_PATTERN.test(original) ? original : snake(original);
    if (!FIELD_PATTERN.test(name)) {
      skipped.push({ name: original, reason: 'a name no field can have' });
      continue;
    }
    const classified = classify(name, view, siblings, index, snake(singular(id)));
    if ('reason' in classified) {
      skipped.push({ name: original, reason: classified.reason });
      continue;
    }
    fields.push({
      name,
      ...classified.field,
      ...(name === original
        ? {}
        : { pointer: `/${original.replace(/~/g, '~0').replace(/\//g, '~1')}` }),
    });
  }
  const picked = new Set<string>();
  for (const [name, path] of Object.entries(picks)) {
    const found = at(resolver, item, path);
    const classified =
      found && classify(name, found.view, found.siblings, index, snake(singular(id)));
    if (!FIELD_PATTERN.test(name) || !classified || 'reason' in classified) {
      skipped.push({ name, reason: `can't be picked from ${path}` });
      continue;
    }
    const existing = fields.findIndex((entry) => entry.name === name);
    if (existing >= 0) fields.splice(existing, 1);
    fields.push({ name, ...classified.field, nullable: true, pointer: path });
    picked.add(name);
  }
  const has = (name: string) => fields.some((entry) => entry.name === name);
  const key = has('id')
    ? 'id'
    : (fields.find((entry) => ['key', 'uuid', 'code', 'slug'].includes(entry.name))?.name ??
      fields.find((entry) => entry.name === `${snake(singular(id))}_id`)?.name);
  if (!key) return { skip: 'no key field' };
  const keyField = fields.find((entry) => entry.name === key);
  if (keyField && keyField.type === 'ref') {
    keyField.type = 'text';
    delete keyField.source;
  }
  const title =
    TITLES.find((name) =>
      fields.some((entry) => entry.name === name && entry.type !== 'bool' && entry.type !== 'ref'),
    ) ?? key;

  // Keep the fields pages use most when there are too many.
  const rank = (entry: ApiField) =>
    entry.name === key || entry.name === title
      ? 0
      : entry.type === 'enum'
        ? 1
        : entry.type === 'ref'
          ? 2
          : entry.type === 'time'
            ? /created/.test(entry.name)
              ? 2
              : 3
            : entry.type === 'money'
              ? 3 + entry.name.length / 100
              : entry.type === 'text'
                ? 5
                : 6;
  const kept = new Set<string>(picked);
  let money = 0;
  for (const entry of [...fields].sort((a, b) => rank(a) - rank(b))) {
    if (kept.size >= MAX_FIELDS) break;
    if (entry.type === 'money' && money >= MAX_MONEY) continue;
    if (entry.type === 'money') money++;
    kept.add(entry.name);
  }
  const chosen = fields.filter((entry) => kept.has(entry.name));
  const extra = fields.filter((entry) => !kept.has(entry.name));
  // Capabilities cover every field understood, so fields the curation brings back keep theirs.
  const named = (name: string) => fields.find((entry) => entry.name === name);
  const summary = [
    title,
    chosen.find((entry) => entry.type === 'money' && /^(amount|total)$/.test(entry.name))?.name ??
      chosen.find((entry) => entry.type === 'money')?.name,
    chosen.find((entry) => entry.type === 'enum' && /(^|_)(status|state)$/.test(entry.name))?.name,
    chosen.find((entry) => entry.type === 'time' && /^created/.test(entry.name))?.name,
  ].filter((name, position, all): name is string => !!name && all.indexOf(name) === position);

  const notes: string[] = [];
  const filters: Record<string, string> = {};
  const capability: Record<string, Op[]> = {};
  const repeat: string[] = [];
  const allow = (field: ApiField, op: Op, param: string) => {
    if (!OPS_BY_TYPE[field.type].includes(op) || filters[`${field.name}:${op}`]) return;
    filters[`${field.name}:${op}`] = param;
    (capability[field.name] ??= []).push(op);
  };
  let size = '';
  let cursor = '';
  let offset = '';
  let page = '';
  let search = '';
  let sort: { param: string; values: string[] } | undefined;
  const required: string[] = [];
  for (const param of operation.params) {
    if (param.in !== 'query') {
      if (param.in === 'path' || param.required === true) required.push(text(param.name));
      continue;
    }
    const name = text(param.name);
    const lower = name.toLowerCase();
    const view = resolver.view(param.schema);
    if (PAGE_SIZE.has(lower)) size = name;
    else if (CURSOR.has(lower)) cursor = name;
    else if (BACKWARDS.has(lower) || IGNORED.has(lower)) continue;
    else if (OFFSET.has(lower)) offset = name;
    else if (PAGE.has(lower)) page = name;
    else if (SEARCH.has(lower) && scalarOf(view) === 'string' && !param.required) search = name;
    else if (SORT.has(lower)) sort = { param: name, values: view.values.map(String) };
    else {
      const direct =
        named(name) ??
        named(name.replace(/_id$/, '')) ??
        named(`${name}_id`) ??
        (name === `${snake(singular(id))}_id` ? named(key) : undefined);
      if (direct) {
        const shapes = view.members.length > 0 ? view.members : [view];
        for (const shape of shapes) {
          const scalar = scalarOf(shape);
          if (scalar) {
            allow(direct, 'eq', name);
          } else if (shape.types.has('array')) {
            allow(direct, 'in', name);
            if (param.explode !== false) repeat.push(name);
          } else if (objectLike(shape)) {
            for (const property of shape.properties.keys()) {
              const op = OPERATORS[property.replace(/^\$/, '')];
              if (op) allow(direct, op, `${name}[${property}]`);
            }
          }
        }
        if (param.required === true) required.push(name);
        continue;
      }
      const suffix = SUFFIXES.map(([pattern, op]) => [name.match(pattern)?.[1], op] as const).find(
        ([target]) => target !== undefined && named(target),
      );
      const [target, op] = suffix ?? [];
      const field = target === undefined ? undefined : named(target);
      if (field && op) allow(field, op, name);
      else if (param.required === true) required.push(name);
    }
  }
  if (required.length > 0) return { skip: `needs ${required.join(', ')}` };
  for (const [field, ops] of Object.entries(capability)) {
    if (ops.includes('gte') && ops.includes('lte') && !ops.includes('between')) ops.push('between');
    if (ops.length === 0) delete capability[field];
  }

  let sortFields: string[] = [];
  let format: 'field:direction' | '-field' = '-field';
  if (sort) {
    const listed = sort.values
      .map((value) => value.replace(/^[-+]/, '').replace(/:(asc|desc)$/i, ''))
      .filter((value) => named(value));
    if (sort.values.some((value) => /:(asc|desc)$/i.test(value))) format = 'field:direction';
    sortFields = [...new Set(listed)];
    if (sortFields.length === 0) {
      sortFields = chosen
        .filter((entry) => entry.type === 'time' && /^(created|updated)/.test(entry.name))
        .map((entry) => entry.name);
      if (sortFields.length > 0) notes.push(`sorting by ${sortFields.join(', ')} is assumed`);
    }
  }

  const listed = (name: string) => {
    const view = candidate.response.properties.get(name);
    return view !== undefined;
  };
  const more = ['has_more', 'hasMore', 'has_next', 'hasNext'].find(listed);
  const next = ['next_cursor', 'nextCursor', 'next_page_token', 'nextPageToken'].find(listed);
  const pagination: RestSource['pagination'] = cursor
    ? { kind: 'cursor', param: cursor, ...(next ? { next: `/${next}` } : {}) }
    : offset
      ? { kind: 'offset', param: offset }
      : page
        ? { kind: 'page', param: page }
        : { kind: 'none' };

  // Rows by key from the endpoint for one row, when the list can't filter by key.
  const endpoint = candidate.endpoint;
  const itemEndpoint: RestSource['item'] = endpoint && {
    path: endpoint.path,
    ...(endpoint.row === '' ? {} : { row: endpoint.row }),
  };
  if (itemEndpoint) {
    for (const op of ['eq', 'in'] as const) {
      if (!capability[key]?.includes(op)) (capability[key] ??= []).push(op);
    }
  }

  const pick = Object.fromEntries(
    chosen.flatMap((entry) => (entry.pointer ? [[entry.name, entry.pointer]] : [])),
  );
  const rest: RestSource = {
    path: operation.path,
    ...(candidate.rows ? { rows: candidate.rows } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(repeat.length > 0 ? { repeat } : {}),
    limit: size,
    pagination,
    ...(more ? { more: `/${more}` } : {}),
    ...(sort && sortFields.length > 0 ? { sort: { param: sort.param, format } } : {}),
    ...(search ? { search } : {}),
    ...(key === 'id' ? {} : { key }),
    ...(Object.keys(pick).length > 0 ? { pick } : {}),
    ...(itemEndpoint ? { item: itemEndpoint } : {}),
  };
  const words = (value: string) =>
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  const label = sentence(id.replace(/-/g, ' '));
  const own = new Set(words(label).map(singular));
  const opTags = (Array.isArray(operation.op.tags) ? operation.op.tags : []).map(text);
  const keywords = [
    ...new Set(
      [kebab(item.name).replace(/^(admin|store|public)-/, ''), ...opTags]
        .map((value) => value.toLowerCase().replace(/[_-]+/g, ' ').trim())
        .filter(
          (value) => value !== '' && !value.split(' ').every((word) => own.has(singular(word))),
        ),
    ),
  ];
  // A schema's own description is best, unless it says next to nothing.
  const described = plain(item.description);
  const tagged = plain(tags.get(opTags[0] ?? '') ?? '');
  return {
    id,
    label,
    description:
      (described.length >= 40 ? described : '') ||
      tagged ||
      described ||
      plain(text(operation.op.summary)) ||
      label,
    keywords,
    schema: item.name,
    operation: operation.key,
    key,
    title,
    summary,
    fields: chosen,
    extra,
    skipped,
    capabilities: {
      filter: capability,
      sort: sort ? sortFields : [],
      search: search !== '',
      pagination:
        pagination.kind === 'cursor' ? 'cursor' : pagination.kind === 'none' ? 'none' : 'offset',
    },
    rest,
    notes,
  };
}

const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildAction(
  resolver: Resolver,
  operation: Operation,
  sources: readonly ApiSource[],
  ids: ReadonlySet<string>,
  index: Index,
): ApiAction | { skip: string } {
  const segments = operation.path.split('/').filter(Boolean);
  const owner = sources
    .filter(
      (entry) =>
        operation.path === entry.rest.path || operation.path.startsWith(`${entry.rest.path}/`),
    )
    .sort((a, b) => b.rest.path.length - a.rest.path.length)[0];
  const isParam = (part: string) => part.startsWith('{');
  const rest = owner ? segments.slice(owner.rest.path.split('/').filter(Boolean).length) : segments;
  const parts = rest.filter((part) => !isParam(part)).map(kebab);
  if (!owner) while (parts[0] !== undefined && PREFIXES.test(parts[0])) parts.shift();
  const resource = owner?.id ?? parts.shift();
  if (resource === undefined) return { skip: 'no resource in its path' };
  const method = operation.method;
  const last = rest.at(-1);
  if (owner && rest.length === 0 && method === 'delete') {
    return { skip: 'deletes a whole collection' };
  }
  let verb: string | undefined;
  if (rest.length === 0 || (last !== undefined && isParam(last))) {
    verb =
      method === 'post' && rest.filter(isParam).length === 0
        ? 'create'
        : method === 'delete'
          ? 'delete'
          : 'update';
  } else if (method === 'delete') verb = 'delete';
  else if (method !== 'post') verb = 'update';
  else if (last !== undefined && (ids.has(kebab(last)) || singular(last) !== last)) verb = 'create';
  const id = [resource, ...parts, ...(verb ? [verb] : [])].join('.');

  const body = resolver.target(operation.op.requestBody).node;
  const content = isObject(body.content) ? body.content : {};
  const types = Object.keys(content);
  const json = types.find((type) => /json/.test(type));
  const form = types.find((type) => type === 'application/x-www-form-urlencoded');
  if (types.length > 0 && !json && !form) return { skip: 'takes files or another body format' };
  const media = content[json ?? form ?? ''];
  const schema = isObject(media) ? resolver.view(media.schema) : undefined;

  const params: ApiParam[] = [];
  const skipped: Skipped[] = [];
  const own = rest.filter(isParam).map((part) => part.slice(1, -1));
  let template = operation.path;
  for (const original of segments.filter(isParam).map((part) => part.slice(1, -1))) {
    const name = FIELD_PATTERN.test(original) ? original : snake(original);
    if (!FIELD_PATTERN.test(name)) return { skip: `a path parameter named ${original}` };
    template = template.replace(`{${original}}`, `{${name}}`);
    // The first parameter after the resource's path is its row's key: a row action.
    const row = owner !== undefined && original === own[0];
    params.push({
      name,
      type: row ? 'ref' : 'text',
      ...(row ? { source: owner.id } : {}),
      nullable: false,
      required: true,
      description: '',
      values: [],
    });
  }
  if (schema) {
    const siblings = new Map<string, View>();
    for (const [name, raw] of schema.properties) siblings.set(name, resolver.view(raw));
    const candidates: ApiParam[] = [];
    for (const [name, view] of siblings) {
      const required = schema.required.has(name);
      const mark = required ? ' (required)' : '';
      if (params.some((entry) => entry.name === name)) continue;
      if (!FIELD_PATTERN.test(name)) {
        skipped.push({ name, reason: `a name no param can have${mark}` });
        continue;
      }
      const classified = classify(name, view, siblings, index, snake(singular(resource)));
      if ('reason' in classified) {
        skipped.push({ name, reason: `${classified.reason}${mark}` });
        continue;
      }
      candidates.push({ name, ...classified.field, nullable: !required, required });
    }
    const optional = candidates.filter((entry) => !entry.required);
    params.push(
      ...candidates.filter((entry) => entry.required),
      ...optional.slice(0, MAX_OPTIONAL_PARAMS),
    );
    for (const entry of optional.slice(MAX_OPTIONAL_PARAMS)) {
      skipped.push({ name: entry.name, reason: 'one too many' });
    }
  }

  // What the action does, plus, for creations, what it creates: creating a refund moves money.
  const words = [...parts, verb ?? '', ...(verb === 'create' ? [resource] : [])]
    .flatMap((part) => part.split('-'))
    .map(singular);
  const word = words.find((entry) => DESTRUCTIVE.has(entry));
  const effect: ApiAction['effect'] = method === 'delete' || word ? 'destructive' : 'write';
  const reason = method === 'delete' ? 'deletes' : word ? `${word}: hard to undo` : 'changes data';

  const summary = text(operation.op.summary);
  const thing = (part: string) => singular(part).replace(/-/g, ' ');
  const fallback = verb
    ? `${verb} ${[resource, ...parts].slice(-2).map(thing).join(' ')}`
    : `${(parts.at(-1) ?? method).replace(/-/g, ' ')} ${thing(resource)}`;
  const label = sentence(
    summary && summary.length <= 60 && !/[<>]/.test(summary) ? summary : fallback,
  );
  const sub = parts.at(-1);
  const invalidates = [owner?.id, sub !== undefined && ids.has(sub) ? sub : undefined].filter(
    (value, position, all): value is string =>
      value !== undefined && all.indexOf(value) === position,
  );
  return {
    id,
    label,
    description: plain(text(operation.op.description)) || plain(summary) || label,
    operation: operation.key,
    resource: owner?.id ?? null,
    effect,
    reason,
    params,
    skipped,
    invalidates,
    rest: {
      method: method.toUpperCase() as RestAction['method'],
      path: template,
      ...(form && !json ? { body: 'form' as const } : {}),
    },
  };
}
