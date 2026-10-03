import { z } from 'zod';
import { rowParam } from './action.js';
import type { ActionSpec, AnyContract, AnyPageSpec, BlockSpec } from './contract.js';
import type { Field } from './field.js';
import { TEXT_LENGTH, TITLE_LENGTH } from './limits.js';
import { NONE, type Query } from './query.js';
import type { FieldPath } from './source.js';
import { parseValue } from './values.js';

/** Every generic block's name. */
export const GENERIC = [
  'table',
  'list',
  'detail',
  'metric',
  'chart',
  'timeline',
  'board',
  'form',
  'actions',
  'note',
  'links',
] as const;
/** Blocks Uitive draws itself from the contract's sources and actions. */
export type GenericName = (typeof GENERIC)[number];

/** Blocks that show the result of one of the page's named queries. */
export const DATA_BLOCKS: readonly GenericName[] = [
  'table',
  'list',
  'detail',
  'metric',
  'chart',
  'timeline',
  'board',
];

const set = z.array(z.object({ param: z.string(), value: z.string() }));
const run = z.object({ action: z.string(), set });

/** An action offered on each row, or as a button, with the params it fills in. */
export interface RowAction {
  /** The action's ID. */
  action: string;
  /** Params filled in: literals, `$current`, or `$row.<field>` for row actions. */
  set: readonly { param: string; value: string }[];
}

/**
 * A table of a query's rows: `columns` from its fields, figures from other queries as `lookups`,
 * and actions on each row.
 */
export interface TableProps {
  /** The name of one of the page's queries, whose result the block shows. */
  data: string;
  /** The query's fields to show, in order, such as `orders.total`. */
  columns: readonly string[];
  /** Figures from other queries, one per row: an aggregate grouped by a ref to this source. */
  lookups: readonly { data: string; label: string }[];
  /** Actions on each row; a ref param naming the table's source is filled with the row's key. */
  rowActions: readonly RowAction[];
  /** How tightly rows sit. */
  density: 'comfortable' | 'compact';
  /** `entity` opens each row's own page. */
  link: 'none' | 'entity';
}

/**
 * A list of a query's rows, each with a title, a subtitle, a detail and a badge drawn from its
 * fields.
 */
export interface ListProps {
  /** The name of one of the page's queries, whose result the block shows. */
  data: string;
  /** The field each row is titled by. */
  title: string;
  /** A second field under the title, or `none`. */
  subtitle: string;
  /** A field shown beside the row, such as a time, or `none`. */
  meta: string;
  /** An enum field drawn as a badge, such as a status, or `none`. */
  badge: string;
  /** Actions on each row. */
  rowActions: readonly RowAction[];
  /** `entity` opens each row's own page. */
  link: 'none' | 'entity';
}

/** One row's fields, in columns, such as the order a page is about. */
export interface DetailProps {
  /** The name of one of the page's queries; its limit must be 1. */
  data: string;
  /** The fields to show, in order. */
  fields: readonly string[];
  /** How many columns the fields sit in, from 1 to 3. */
  columns: number;
}

/**
 * One figure from a summary, such as a count or a sum, compared with the period before when asked.
 */
export interface MetricProps {
  /** The name of one of the page's queries: an ungrouped summary. */
  data: string;
  /** What the figure is, such as "Paid, not shipped". */
  label: string;
  /** `previous` compares with the period before the query's time filter. */
  compare: 'none' | 'previous';
}

/** A chart of a grouped summary: lines, bars, areas or a pie. */
export interface ChartProps {
  /** The name of one of the page's queries: a summary grouped by a field or a time bucket. */
  data: string;
  /** The kind of chart; a pie can't group by time or split. */
  kind: 'line' | 'bar' | 'area' | 'pie';
  /** Whether a split stacks, for bars and areas. */
  stacked: boolean;
}

/** A query's rows in time order, each with a title and a detail. */
export interface TimelineProps {
  /** The name of one of the page's queries, whose result the block shows. */
  data: string;
  /** The time field that orders the rows. */
  time: string;
  /** The field each entry is titled by. */
  title: string;
  /** A field under each title, or `none`. */
  detail: string;
}

/** A query's rows in columns by an enum field, such as orders by status. Read only. */
export interface BoardProps {
  /** The name of one of the page's queries, whose result the block shows. */
  data: string;
  /** The enum field whose values are the columns. */
  column: string;
  /** The field each card is titled by. */
  title: string;
  /** A second field on each card, or `none`. */
  meta: string;
}

/** A form that runs one action, asking for the params it doesn't fill in itself. */
export interface FormProps {
  /** The action to run: one with an effect and params. */
  action: string;
  /** Params filled in, such as the page's row with `$current`; the form asks for the rest. */
  set: readonly { param: string; value: string }[];
}

/** Buttons for actions: a list's visible items, or chosen actions with their params. */
export interface ActionsProps {
  /** A list surface whose visible items become buttons, or `none`. */
  list: string;
  /** Actions to offer, besides the list's, with their params. */
  items: readonly RowAction[];
  /** How large the buttons are. */
  size: 'small' | 'regular' | 'large';
}

/** A short note: a title and up to 500 characters of text. */
export interface NoteProps {
  /** The note's title. */
  title: string;
  /** The note itself. */
  text: string;
}

/** Links to the contract's routes, each with its own label. */
export interface LinksProps {
  /** The links: a label, a route, and the row's key when the route is about one. */
  items: readonly { label: string; route: string; entity: string }[];
}

/** Props of each generic block, by name. */
export interface GenericProps {
  /** A table of rows. */
  table: TableProps;
  /** A list of rows. */
  list: ListProps;
  /** One row's fields. */
  detail: DetailProps;
  /** One figure. */
  metric: MetricProps;
  /** A chart. */
  chart: ChartProps;
  /** Rows in time order. */
  timeline: TimelineProps;
  /** Rows in columns. */
  board: BoardProps;
  /** A form for one action. */
  form: FormProps;
  /** Buttons for actions. */
  actions: ActionsProps;
  /** A note. */
  note: NoteProps;
  /** Links to routes. */
  links: LinksProps;
}

const link = z.enum(['none', 'entity']);

/** Every generic block as a block spec: its label, description and props schema. */
export const genericBlocks: { readonly [K in GenericName]: BlockSpec<GenericProps[K]> } = {
  table: {
    label: 'Table',
    description:
      "A query's rows as a table: columns, figures looked up per row from other queries, and actions on each row",
    props: z.object({
      data: z.string(),
      columns: z.array(z.string()),
      lookups: z.array(z.object({ data: z.string(), label: z.string() })),
      rowActions: z.array(run),
      density: z.enum(['comfortable', 'compact']),
      link,
    }),
  },
  list: {
    label: 'List',
    description: "A query's rows as a compact list: a title, a subtitle, a detail and a badge each",
    props: z.object({
      data: z.string(),
      title: z.string(),
      subtitle: z.string(),
      meta: z.string(),
      badge: z.string(),
      rowActions: z.array(run),
      link,
    }),
  },
  detail: {
    label: 'Detail',
    description: "One row's fields, such as the page's own row",
    props: z.object({ data: z.string(), fields: z.array(z.string()), columns: z.number().int() }),
  },
  metric: {
    label: 'Metric',
    description: 'One number from a summary query, optionally against the previous period',
    props: z.object({ data: z.string(), label: z.string(), compare: z.enum(['none', 'previous']) }),
  },
  chart: {
    label: 'Chart',
    description: 'A summary query grouped by time or category, as a line, bar, area or pie chart',
    props: z.object({
      data: z.string(),
      kind: z.enum(['line', 'bar', 'area', 'pie']),
      stacked: z.boolean(),
    }),
  },
  timeline: {
    label: 'Timeline',
    description: "A query's rows in time order, newest first",
    props: z.object({
      data: z.string(),
      time: z.string(),
      title: z.string(),
      detail: z.string(),
    }),
  },
  board: {
    label: 'Board',
    description: "A query's rows as cards in columns, one column per value of an enum field",
    props: z.object({
      data: z.string(),
      column: z.string(),
      title: z.string(),
      meta: z.string(),
    }),
  },
  form: {
    label: 'Form',
    description: 'A form that runs one action, with some of its params filled in',
    props: z.object({ action: z.string(), set }),
  },
  actions: {
    label: 'Actions',
    description: 'Buttons that run actions, or the visible items of a list surface',
    props: z.object({
      list: z.string(),
      items: z.array(run),
      size: z.enum(['small', 'regular', 'large']),
    }),
  },
  note: {
    label: 'Note',
    description: "A short note, such as a reminder in the user's own words",
    props: z.object({ title: z.string(), text: z.string() }),
  },
  links: {
    label: 'Links',
    description: 'Links to pages of the application',
    props: z.object({
      items: z.array(z.object({ label: z.string(), route: z.string(), entity: z.string() })),
    }),
  },
};

/**
 * The generic blocks a page may use: those it hasn't replaced with its own block of the same
 * name, and that the contract can feed (data blocks need sources, forms need actions with params).
 */
export function genericFor(contract: AnyContract, spec: AnyPageSpec): GenericName[] {
  const wanted =
    spec.generic === false
      ? []
      : spec.generic === true || spec.generic === undefined
        ? GENERIC
        : spec.generic;
  const runnable = contract.actionIds.some((id) => contract.actions[id]?.effect !== undefined);
  const withParams = contract.actionIds.some(
    (id) => contract.actions[id]?.effect !== undefined && contract.params(id).length > 0,
  );
  return wanted.filter((name) => {
    if (name in spec.blocks) return false;
    if (DATA_BLOCKS.includes(name)) return contract.sourceIds.length > 0;
    if (name === 'form') return withParams;
    if (name === 'actions')
      return runnable || contract.surfaceIds.some((id) => contract.surfaces[id]?.kind === 'list');
    if (name === 'links') return contract.routeIds.length > 0;
    return true;
  });
}

/** Why a generic block's props were rejected. */
export class GenericProblem extends Error {
  constructor(
    readonly rule: 'unknown' | 'validator' | 'kind',
    message: string,
  ) {
    super(message);
  }
}

const problem = (rule: 'unknown' | 'validator' | 'kind', message: string): never => {
  throw new GenericProblem(rule, message);
};

/** What checking a generic block needs: the contract, the page and its queries. */
export interface GenericScope {
  /** The contract the page belongs to. */
  contract: AnyContract;
  /** The page's spec. */
  spec: AnyPageSpec;
  /** The page's checked queries, by name. */
  data: ReadonlyMap<string, Query>;
  /** Names of queries a block used, filled in as blocks are checked. */
  used: Set<string>;
  /** A planner placed it, unasked: it may not place destructive actions or fill in writes. */
  planned: boolean;
}

/** Checks a generic block's props against its queries and actions; returns them canonical. */
export function checkGeneric(name: GenericName, props: unknown, scope: GenericScope): unknown {
  const label = genericBlocks[name].label;
  const fail = (message: string): never => problem('validator', `${label}: ${message}`);
  const { contract } = scope;

  const query = (dataName: string): Query => {
    const found = scope.data.get(dataName.trim());
    if (!found) return fail(`no query is called "${dataName}"`);
    scope.used.add(dataName.trim());
    return found;
  };
  const rows = (dataName: string): Query => {
    const found = query(dataName);
    if (found.aggregate.measure !== 'none') fail('needs rows; its query sums them up');
    return found;
  };
  const summary = (dataName: string): Query => {
    const found = query(dataName);
    if (found.aggregate.measure === 'none') fail('needs a summary: give its query a measure');
    return found;
  };
  const field = (source: Query, raw: string, role: string): FieldPath => {
    const path = contract.path(raw);
    if (!path || path.source !== source.source)
      return fail(`${role} "${raw}" is not a field of ${source.source}`);
    if (!source.fields.includes(path.name))
      fail(`add ${path.name} to the query's fields to show it`);
    return path;
  };
  const optional = (source: Query, raw: string, role: string): string =>
    raw.trim() === '' || raw.trim().toLowerCase() === NONE ? NONE : field(source, raw, role).name;
  const text = (value: string, most: number, role: string) => {
    const trimmed = value.trim();
    if (trimmed.length > most) fail(`the ${role} stays under ${most} characters`);
    return trimmed;
  };

  switch (name) {
    case 'table': {
      const value = props as TableProps;
      const source = rows(value.data);
      if (value.columns.length === 0) fail('needs a column');
      const columns = [
        ...new Set(value.columns.map((column) => field(source, column, 'column').name)),
      ];
      const lookups = value.lookups.map((lookup) => {
        const other = summary(lookup.data);
        const by = other.aggregate.by === NONE ? undefined : contract.path(other.aggregate.by);
        if (
          !by ||
          by.field.type !== 'ref' ||
          by.via !== undefined ||
          by.field.source !== source.source
        ) {
          fail(`a lookup groups its query by a ref to ${source.source}`);
        }
        if (other.aggregate.split !== NONE) fail('a lookup has no split');
        return {
          data: lookup.data.trim(),
          label: text(lookup.label, TITLE_LENGTH, 'lookup label'),
        };
      });
      return {
        data: value.data.trim(),
        columns,
        lookups,
        rowActions: value.rowActions.map((entry) => rowAction(entry, source, scope, fail)),
        density: value.density,
        link: entityLink(value.link, source, contract, fail),
      };
    }
    case 'list': {
      const value = props as ListProps;
      const source = rows(value.data);
      return {
        data: value.data.trim(),
        title: field(source, value.title, 'title').name,
        subtitle: optional(source, value.subtitle, 'subtitle'),
        meta: optional(source, value.meta, 'meta'),
        badge: optional(source, value.badge, 'badge'),
        rowActions: value.rowActions.map((entry) => rowAction(entry, source, scope, fail)),
        link: entityLink(value.link, source, contract, fail),
      };
    }
    case 'detail': {
      const value = props as DetailProps;
      const source = rows(value.data);
      if (source.limit !== 1) fail("shows one row: set its query's limit to 1");
      if (value.fields.length === 0) fail('needs a field');
      if (!Number.isInteger(value.columns) || value.columns < 1 || value.columns > 3) {
        fail('lays fields out in 1 to 3 columns');
      }
      return {
        data: value.data.trim(),
        fields: [...new Set(value.fields.map((entry) => field(source, entry, 'field').name))],
        columns: value.columns,
      };
    }
    case 'metric': {
      const value = props as MetricProps;
      const source = summary(value.data);
      if (source.aggregate.by !== NONE) fail('shows one number: leave its query ungrouped');
      if (value.compare === 'previous' && !periodOf(source, contract)) {
        fail('compares periods only when its query starts at a time, such as created gte -30d');
      }
      return {
        data: value.data.trim(),
        label: text(value.label, TITLE_LENGTH, 'label'),
        compare: value.compare,
      };
    }
    case 'chart': {
      const value = props as ChartProps;
      const source = summary(value.data);
      if (source.aggregate.by === NONE)
        fail('needs groups: group its query by a time or a category');
      const by = contract.path(source.aggregate.by);
      if (value.kind === 'pie' && (by?.field.type === 'time' || source.aggregate.split !== NONE)) {
        fail('pies show categories, without a split');
      }
      if (
        value.stacked &&
        (source.aggregate.split === NONE || value.kind === 'pie' || value.kind === 'line')
      ) {
        fail('stacks bars or areas, and needs a split');
      }
      return { data: value.data.trim(), kind: value.kind, stacked: value.stacked };
    }
    case 'timeline': {
      const value = props as TimelineProps;
      const source = rows(value.data);
      const time = field(source, value.time, 'time');
      if (time.field.type !== 'time') fail(`${time.name} is not a time`);
      return {
        data: value.data.trim(),
        time: time.name,
        title: field(source, value.title, 'title').name,
        detail: optional(source, value.detail, 'detail'),
      };
    }
    case 'board': {
      const value = props as BoardProps;
      const source = rows(value.data);
      const column = field(source, value.column, 'column');
      if (column.field.type !== 'enum') fail(`columns come from an enum field, not ${column.name}`);
      return {
        data: value.data.trim(),
        column: column.name,
        title: field(source, value.title, 'title').name,
        meta: optional(source, value.meta, 'meta'),
      };
    }
    case 'form': {
      const value = props as FormProps;
      const action = runnable(value.action, scope, fail);
      if (contract.params(action).length === 0)
        fail(`${contract.actions[action]?.label} takes nothing to fill in`);
      return { action, set: fill(action, value.set, undefined, scope, fail) };
    }
    case 'actions': {
      const value = props as ActionsProps;
      let list = NONE;
      if (value.list.trim() !== '' && value.list.trim().toLowerCase() !== NONE) {
        list = contract.surface(value.list) ?? fail(`no list "${value.list}"`);
        if (contract.surfaces[list]?.kind !== 'list') fail(`${list} is not a list`);
      }
      if (list === NONE && value.items.length === 0) fail('needs a list or an action');
      return {
        list,
        items: value.items.map((entry) => {
          const action = runnable(entry.action, scope, fail, true);
          return { action, set: fill(action, entry.set, undefined, scope, fail) };
        }),
        size: value.size,
      };
    }
    case 'note': {
      const value = props as NoteProps;
      const body = text(value.text, TEXT_LENGTH, 'text');
      if (body.length === 0) fail('needs some text');
      return { title: text(value.title, TITLE_LENGTH, 'title'), text: body };
    }
    case 'links': {
      const value = props as LinksProps;
      if (value.items.length === 0) fail('needs a link');
      return {
        items: value.items.map((item) => {
          const route = contract.route(item.route) ?? fail(`no route "${item.route}"`);
          const entity = item.entity.trim();
          const needs = contract.routes[route]?.entity;
          if (needs !== undefined && entity === '') fail(`${route} needs the ${needs} to open`);
          return { label: text(item.label, TITLE_LENGTH, 'link label'), route, entity };
        }),
      };
    }
  }
}

/** The action named, which must run; destructive ones are the user's to place. */
function runnable(
  raw: string,
  scope: GenericScope,
  fail: (message: string) => never,
  interfaceOnly = false,
): string {
  const { contract } = scope;
  const action = contract.action(raw) ?? fail(`no action "${raw}"`);
  const spec = contract.actions[action] as ActionSpec;
  if (spec.effect === undefined && !interfaceOnly) fail(`${spec.label} doesn't run anything`);
  if (spec.effect === 'destructive' && scope.planned) {
    problem('kind', `Only you can put ${spec.label} on a page`);
  }
  return action;
}

function rowAction(
  entry: RowAction,
  source: Query,
  scope: GenericScope,
  fail: (message: string) => never,
): RowAction {
  const { contract } = scope;
  const action = runnable(entry.action, scope, fail);
  const row = rowParam(contract.params(action));
  if (row?.source !== source.source) {
    fail(`${contract.actions[action]?.label} doesn't act on ${source.source} rows`);
  }
  return { action, set: fill(action, entry.set, source, scope, fail) };
}

/** Checks params filled in for an action; planners never fill in writes. */
function fill(
  action: string,
  entries: readonly { param: string; value: string }[],
  source: Query | undefined,
  scope: GenericScope,
  fail: (message: string) => never,
): { param: string; value: string }[] {
  const { contract } = scope;
  const spec = contract.actions[action] as ActionSpec;
  if (entries.length > 0 && scope.planned && spec.effect !== 'read' && spec.effect !== undefined) {
    problem('kind', `Only you can fill in ${spec.label}`);
  }
  const params = contract.params(action);
  const seen = new Set<string>();
  return entries.map((entry) => {
    // Planner schemas name params as `action:param`, so either spelling is accepted.
    const bare = entry.param.includes(':')
      ? entry.param.slice(entry.param.indexOf(':') + 1)
      : entry.param;
    const param =
      params.find((candidate) => candidate.name.toLowerCase() === bare.trim().toLowerCase()) ??
      fail(`${spec.label} has no param "${entry.param}"`);
    if (seen.has(param.name)) fail(`${param.name} is filled in twice`);
    seen.add(param.name);
    return { param: param.name, value: paramValue(param, entry.value, source, scope, fail) };
  });
}

function paramValue(
  param: Field,
  raw: string,
  source: Query | undefined,
  scope: GenericScope,
  fail: (message: string) => never,
): string {
  const value = raw.trim();
  if (value.startsWith('$row.')) {
    if (!source) fail('$row only works in row actions');
    const fieldName = value.slice(5);
    const row = scope.contract.source(source?.source ?? '');
    const found = row?.fields.find((entry) => entry.name.toLowerCase() === fieldName.toLowerCase());
    if (!found) fail(`${source?.source} rows have no ${fieldName}`);
    return `$row.${found?.name}`;
  }
  if (value === '$current') {
    if (param.type !== 'ref' || param.source !== scope.spec.entity) {
      fail(`$current fills only a ${scope.spec.entity ?? 'row'} param`);
    }
    return value;
  }
  const parsed = parseValue(param, value, { now: 0 });
  if (!parsed) fail(`${param.label} can't be "${raw}"`);
  return param.type === 'enum' && parsed?.kind === 'text' ? parsed.value : value;
}

function entityLink(
  value: 'none' | 'entity',
  source: Query,
  contract: AnyContract,
  fail: (message: string) => never,
): 'none' | 'entity' {
  if (
    value === 'entity' &&
    !contract.routeIds.some((id) => contract.routes[id]?.entity === source.source)
  ) {
    fail(`no page shows one ${source.source} row`);
  }
  return value;
}

/** For comparisons with the previous period: the time filter a query starts at, if any. */
export function periodOf(
  query: Query,
  contract: AnyContract,
): { field: string; from: string; to?: string } | undefined {
  for (const entry of query.filter) {
    const path = contract.path(entry.field);
    if (path?.field.type !== 'time') continue;
    if (entry.op === 'gte' || entry.op === 'gt') {
      const until = query.filter.find(
        (other) => other.field === entry.field && (other.op === 'lt' || other.op === 'lte'),
      );
      return {
        field: entry.field,
        from: entry.values[0] as string,
        ...(until ? { to: until.values[0] as string } : {}),
      };
    }
    if (entry.op === 'between') {
      return { field: entry.field, from: entry.values[0] as string, to: entry.values[1] as string };
    }
  }
  return undefined;
}
