import { z } from 'zod';
import { EFFECTS, rowParam, type Effect } from './action.js';
import { describeFields, type Field } from './field.js';
import { hash } from './hash.js';
import { assertIds, canonicaliser, SURFACE_PATTERN } from './ids.js';
import {
  BUILT_IN,
  PageProblem,
  validatePage,
  type AnyPage,
  type Layout,
  type PageValue,
  type SectionsPage,
} from './page.js';
import type { GenericName } from './generic.js';
import { checkQuery, type Filter } from './query.js';
import { validateRoutes, type RouteSpec } from './route.js';
import {
  resolvePath,
  resolveSources,
  type AnySourceSpec,
  type FieldPath,
  type ResolvedSource,
} from './source.js';

/** Something a user can do. */
export interface ActionSpec<P extends z.ZodObject = z.ZodObject> {
  /** Shown to people and to the model. */
  label: string;
  /** What the action does, written for people and models alike. */
  description: string;
  /** Groups related actions, for display and for the model. */
  group?: string;
  /** Former IDs of this action, so stored usage survives a rename. @default [] */
  aliases?: readonly string[];
  /** What a run takes: flat fields, like a source's row. A `ref` param makes it a row action. */
  params?: P;
  /** What a run does. Without one, the action belongs to the interface only. */
  effect?: Effect;
  /** For destructive actions: what the user types to confirm. @default the label */
  confirm?: string;
  /** For row actions: the rows it applies to, as filters on the row's source. @default every row */
  when?: readonly Filter[];
  /** Sources a run changes, so results that read them refresh. @default [] */
  invalidates?: readonly string[];
}

interface SurfaceBase {
  /** Shown to people, such as "Toolbar". */
  label: string;
  /** What the surface is for, written for people and models alike. */
  description: string;
}

/** An ordered selection of actions: the first `capacity` show, the rest wait in overflow. */
export interface ListSpec<A extends string = string> extends SurfaceBase {
  /** Says the surface is a list. */
  kind: 'list';
  /** Every action the list can show, in standard order. */
  items: readonly A[];
  /** How many items show before the rest move to overflow. */
  capacity: number;
  /** Items that never move to overflow. @default [] */
  required?: readonly A[];
  /** Whether items may leave the standard order. @default false */
  reorderable?: boolean;
  /** The context that keys this list, such as `tool`; each of its values adapts separately. */
  context?: string;
  /** The items available for one context value. @default every item */
  available?(value: string): readonly A[];
}

/** One value out of a fixed set. */
export interface ChoiceSpec<V extends string = string> extends SurfaceBase {
  /** Says the surface is a choice. */
  kind: 'choice';
  /** Every value, in the order people see them. */
  values: readonly V[];
  /** The value before anyone chooses one. */
  default: V;
}

/** Generated items, such as macros or saved views, that users accept, edit or dismiss. */
export interface CollectionSpec<T = unknown> extends SurfaceBase {
  /** Says the surface is a collection. */
  kind: 'collection';
  /** The schema of one item. Planners can only produce items it accepts. */
  item: z.ZodType<T>;
  /** At most this many accepted items. */
  max: number;
  /** A short title for an item, shown to people. */
  title(item: T): string;
  /** Application rules beyond the schema; returns why an item is invalid. */
  validate?(item: T): string | undefined;
}

/** A part pages are built from: a component the application renders, with typed props. */
export interface BlockSpec<P = unknown> {
  /** Shown to people, such as "Resource table". */
  label: string;
  /** What the block shows and how its props change it, for people and models alike. */
  description: string;
  /** The schema of the block's props. Planners can only produce props it accepts. */
  props: z.ZodType<P>;
  /** Application rules beyond the schema, given the page's context value; returns why props are invalid. */
  validate?(props: P, context: string | undefined): string | undefined;
}

export { LAYOUTS, type AnyPage, type Layout, type PageValue } from './page.js';

/** The props a block takes. */
export type PropsOf<B> = B extends BlockSpec<infer P> ? P : never;

/** One placed block: which block, with which props. */
export type BlockOf<B extends Record<string, BlockSpec>> = {
  [K in Extract<keyof B, string>]: { block: K; props: PropsOf<B[K]> };
}[Extract<keyof B, string>];

/** A section of the first page format, with its blocks typed. */
export interface PageSection<B extends Record<string, BlockSpec> = Record<string, BlockSpec>> {
  /** May be empty. */
  title: string;
  /** How its blocks are laid out: a stack, a grid or columns. */
  layout: Layout;
  /** Its blocks, in order. */
  blocks: readonly BlockOf<B>[];
}

/** A page in the first format, sections of blocks, typed: still accepted for standard pages. */
export interface SectionPage<B extends Record<string, BlockSpec> = Record<string, BlockSpec>> {
  /** The page's sections, in order. */
  sections: readonly PageSection<B>[];
}

/** Part of the application as it already is, which pages can embed, such as the original page. */
export interface RegionSpec {
  /** Shown to people and to the model, such as "Payments table". */
  label: string;
  /** What it shows, for people and models alike. */
  description: string;
  /** The source whose row it is about, so only pages about that source can embed it. */
  entity?: string;
}

/** Any page surface, with its blocks widened. */
export interface AnyPageSpec extends SurfaceBase {
  /** Says the surface is a page. */
  kind: 'page';
  /** The application's own blocks the page may use, besides sections, tabs and regions. */
  blocks: Readonly<Record<string, BlockSpec>>;
  /** The context that keys this page, such as `service`; it can be redesigned per value or for all. */
  context?: string;
  /** The source whose rows this page is about, such as `customers`; `$current` names the row. */
  entity?: string;
  /** Generic blocks the page offers. @default every one the contract can feed */
  generic?: boolean | readonly GenericName[];
  /** The page before anyone changes it, for a context value when the page has a context. */
  standard(context: string | undefined): AnyPage | SectionsPage;
  /** How many elements a page may hold. @default 40 */
  maxElements?: number;
  /** How deeply a page's sections may nest. @default 4 */
  maxDepth?: number;
  /** Queries a page may run. @default 8 */
  maxQueries?: number;
}

/**
 * A page composed from the application's blocks. Users (or a planner, on their behalf) can
 * redesign it completely, but only out of these parts.
 */
export interface PageSpec<
  B extends Record<string, BlockSpec> = Record<string, BlockSpec>,
> extends AnyPageSpec {
  blocks: B;
  /** Typed sections, typed elements, or any page (such as one built with `ui`): all are validated. */
  standard(context: string | undefined): PageValue<B> | SectionPage<B> | AnyPage;
}

/** Any surface a contract declares: a list, a choice, a collection or a page. */
export type SurfaceSpec<A extends string = string> =
  ListSpec<A> | ChoiceSpec | CollectionSpec | AnyPageSpec;

/**
 * What `defineApp` takes: the application's actions and surfaces, and optionally its sources,
 * regions, routes and contexts.
 */
export interface ContractSpec<
  A extends Record<string, ActionSpec>,
  S extends Record<string, SurfaceSpec<Extract<keyof A, string>>>,
  C extends Record<string, readonly string[]>,
  D extends Record<string, AnySourceSpec> = Record<never, never>,
> {
  /** Identifies the application, such as `cloud-console`. */
  id: string;
  /** Bump when behavior that can't be hashed changes, such as a validator. @default '1' */
  version?: string;
  /** What the application is, written for the model. */
  description: string;
  /**
   * What people can do. IDs are lowercase, with dots, colons or dashes, such as `orders.cancel`
   * or `table.add-empty`, since structured outputs don't guarantee the casing of enum values.
   */
  actions: A;
  /**
   * Every value of each context, such as every tool. Names are camelCase; values are lowercase,
   * like action IDs. @default {}
   */
  contexts?: C;
  /** Data pages can show, as typed read models. @default {} */
  sources?: D;
  /** Parts of the application as it already is, which pages can embed. @default {} */
  regions?: Readonly<Record<string, RegionSpec>>;
  /** Places in the application, for links and for knowing which row a page is about. @default {} */
  routes?: Readonly<Record<string, RouteSpec>>;
  /**
   * The parts of the interface people can reshape: lists, choices, collections and pages. Names
   * are identifiers in application code, camelCase, such as `addNew`.
   */
  surfaces: S;
}

/** Any contract, with its IDs widened to strings: what generic code works with. */
export interface AnyContract {
  /** The application's ID. */
  readonly id: string;
  /** The version the application gave, for changes the hash can't see. */
  readonly version: string;
  /** What the application is, for the model. */
  readonly description: string;
  /** Every action, by ID. */
  readonly actions: Readonly<Record<string, ActionSpec>>;
  /** Every context, with its values. */
  readonly contexts: Readonly<Record<string, readonly string[]>>;
  /** Every source, by ID. */
  readonly sources: Readonly<Record<string, AnySourceSpec>>;
  /** Every region, by name. */
  readonly regions: Readonly<Record<string, RegionSpec>>;
  /** Every route, by ID. */
  readonly routes: Readonly<Record<string, RouteSpec>>;
  /** Every surface, by name. */
  readonly surfaces: Readonly<Record<string, SurfaceSpec>>;
  /** Changes whenever anything a planner sees changes. */
  readonly hash: string;
  /** Every action ID, in declaration order. */
  readonly actionIds: readonly string[];
  /** Every source ID, in declaration order. */
  readonly sourceIds: readonly string[];
  /** Every route ID, in declaration order. */
  readonly routeIds: readonly string[];
  /** Every surface name, in declaration order. */
  readonly surfaceIds: readonly string[];
  /** The action an ID or former ID names, compared case-insensitively. */
  action(id: string): string | undefined;
  /** The surface a name refers to, compared case-insensitively. */
  surface(name: string): string | undefined;
  /** The canonical value of a context, compared case-insensitively. */
  contextValue(context: string, value: string): string | undefined;
  /** The items a list offers, for one context value when the list is keyed by context. */
  items(surface: string, context?: string): readonly string[];
  /** A source with its fields described, by ID compared case-insensitively. */
  source(id: string): ResolvedSource | undefined;
  /** A qualified field name such as `payments.customer.email`, compared case-insensitively. */
  path(name: string): FieldPath | undefined;
  /** An action's params, described as fields. Empty when it takes none. */
  params(action: string): readonly Field[];
  /** The route a name refers to, compared case-insensitively. */
  route(name: string): string | undefined;
}

/**
 * A contract as `defineApp` returns it: the spec checked and frozen, with its IDs listed and the
 * hash that identifies it.
 */
export interface Contract<
  A extends Record<string, ActionSpec> = Record<string, ActionSpec>,
  S extends Record<string, SurfaceSpec> = Record<string, SurfaceSpec>,
  C extends Record<string, readonly string[]> = Record<string, readonly string[]>,
  D extends Record<string, AnySourceSpec> = Record<string, AnySourceSpec>,
> extends AnyContract {
  /** Every action, by ID. */
  readonly actions: A;
  /** Every context, with its values. */
  readonly contexts: C;
  /** Every source, by ID. */
  readonly sources: D;
  /** Every surface, by name. */
  readonly surfaces: S;
  /** Every action ID, in declaration order. */
  readonly actionIds: readonly Extract<keyof A, string>[];
  /** Every source ID, in declaration order. */
  readonly sourceIds: readonly Extract<keyof D, string>[];
  /** Every surface name, in declaration order. */
  readonly surfaceIds: readonly Extract<keyof S, string>[];
  action(id: string): Extract<keyof A, string> | undefined;
  surface(name: string): Extract<keyof S, string> | undefined;
}

/** A contract's action IDs, as a union, such as `ActionIdOf<typeof shop>`. */
export type ActionIdOf<T extends AnyContract> = Extract<keyof T['actions'], string>;
/** A contract's surface names, as a union. */
export type SurfaceIdOf<T extends AnyContract> = Extract<keyof T['surfaces'], string>;
/** A contract's context names, as a union. */
export type ContextOf<T extends AnyContract> = Extract<keyof T['contexts'], string>;
/** A contract's source IDs, as a union. */
export type SourceIdOf<T extends AnyContract> = Extract<keyof T['sources'], string>;
/** One row of a source, as its binding returns it. */
export type RowOf<T extends AnyContract, K extends SourceIdOf<T>> = z.infer<T['sources'][K]['row']>;

/** An action as a surface shows it. */
export interface ActionView<A extends string = string> {
  /** The action's ID. */
  id: A;
  /** The action's label. */
  label: string;
  /** What the action does. */
  description: string;
  /** The action's group, when it has one. */
  group?: string;
  /** The user pinned it here. */
  pinned: boolean;
  /** It moved here through an applied operation, for "moved" markers. */
  moved: boolean;
}

/** A list as a person's interface has it: the actions that show, then those waiting in overflow. */
export interface ListValue<A extends string = string> {
  /** The actions that show, in order. */
  visible: readonly ActionView<A>[];
  /** The rest, for a More menu or the palette. */
  overflow: readonly ActionView<A>[];
}

/** One item of a collection, with the operation that added it. */
export interface CollectionEntry<T = unknown> {
  /** The item's ID. */
  id: string;
  /** Its title, from the collection's `title`. */
  title: string;
  /** The item itself. */
  value: T;
  /** The operation that added it, for Revert, Keep and explanations. */
  operation: string;
}

/**
 * A collection as a person's interface has it: the items they accepted, and suggestions waiting for
 * an answer.
 */
export interface CollectionValue<T = unknown> {
  /** Items the person accepted or added. */
  items: readonly CollectionEntry<T>[];
  /** Proposed items waiting for the user to accept or dismiss them. */
  suggestions: readonly CollectionEntry<T>[];
}

/**
 * What a surface holds, by its kind: a list's visible and overflow actions, a choice's value, a
 * collection's items or a page.
 */
export type SurfaceValue<Spec> =
  Spec extends ListSpec<infer A>
    ? ListValue<A>
    : Spec extends ChoiceSpec<infer V>
      ? V
      : Spec extends CollectionSpec<infer T>
        ? CollectionValue<T>
        : Spec extends PageSpec<infer B>
          ? PageValue<B>
          : Spec extends AnyPageSpec
            ? AnyPage
            : never;

/** What one surface of a contract holds, such as `SurfaceValueOf<typeof shop, 'orders'>`. */
export type SurfaceValueOf<T extends AnyContract, K extends SurfaceIdOf<T>> = SurfaceValue<
  T['surfaces'][K]
>;

/**
 * Declares something people can do, such as `orders.cancel`. Without an `effect` it belongs to
 * the interface only; with one it runs through the bindings' `perform`, and writes wait for the
 * person's yes.
 */
// The default must be an empty shape, so actions without params take nothing.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function action<const P extends z.ZodObject = z.ZodObject<{}>>(
  spec: ActionSpec<P>,
): ActionSpec<P> {
  return spec;
}

/**
 * Declares an ordered selection of actions, such as a toolbar or a menu: the first `capacity` show
 * and the rest wait in overflow.
 */
export function list<const A extends string>(
  spec: Omit<ListSpec<A>, 'kind' | 'required' | 'available'> & {
    required?: readonly NoInfer<A>[];
    available?(value: string): readonly NoInfer<A>[];
  },
): ListSpec<A> {
  return { kind: 'list', ...spec };
}

/** Declares one value out of a fixed set, such as a theme or a density. */
export function choice<const V extends string>(
  spec: Omit<ChoiceSpec<V>, 'kind' | 'default'> & { default: NoInfer<V> },
): ChoiceSpec<V> {
  return { kind: 'choice', ...spec };
}

/** Declares generated items, such as saved views or macros, that people accept, edit or dismiss. */
export function collection<T>(spec: Omit<CollectionSpec<T>, 'kind'>): CollectionSpec<T> {
  return { kind: 'collection', ...spec };
}

/**
 * Declares a part pages are built from: one of the application's own components, with typed props.
 */
export function block<P>(spec: BlockSpec<P>): BlockSpec<P> {
  return spec;
}

/**
 * A page made of these blocks: `page({ table, chart })({ label, description, standard })`.
 * Taking the blocks first fixes their types, so the standard page is checked against them.
 */
export function page<const B extends Record<string, BlockSpec>>(blocks: B) {
  return (spec: Omit<PageSpec<B>, 'kind' | 'blocks'>): PageSpec<B> => ({
    kind: 'page',
    blocks,
    ...spec,
  });
}

/**
 * Declares what may adapt in an application. Validates every ID and reference, and freezes
 * the result: the contract is the boundary planners work within.
 */
export function defineApp<
  const A extends Record<string, ActionSpec>,
  const S extends Record<string, SurfaceSpec<Extract<keyof A, string>>>,
  const C extends Record<string, readonly string[]> = Record<never, never>,
  const D extends Record<string, AnySourceSpec> = Record<never, never>,
>(spec: ContractSpec<A, S, C, D>): Contract<A, S, C, D> {
  type ActionId = Extract<keyof A, string>;
  type SurfaceId = Extract<keyof S, string>;
  const actionIds = Object.keys(spec.actions) as ActionId[];
  const surfaceIds = Object.keys(spec.surfaces) as SurfaceId[];
  const contexts = (spec.contexts ?? {}) as C;
  const sources = (spec.sources ?? {}) as D;
  const regions = spec.regions ?? {};
  const routes = spec.routes ?? {};
  const routeIds = Object.keys(routes);
  assertIds('routes', routeIds);
  const toRoute = canonicaliser(routeIds);
  const sourceIds = Object.keys(sources) as Extract<keyof D, string>[];
  const resolvedSources = resolveSources(sources);

  const aliases = new Map<string, ActionId>();
  for (const id of actionIds) {
    for (const alias of spec.actions[id]?.aliases ?? []) aliases.set(alias, id);
  }
  assertIds('actions', [...actionIds, ...aliases.keys()]);
  assertIds('surfaces', surfaceIds, SURFACE_PATTERN);
  if (surfaceIds.some((id) => id.toLowerCase() === 'userpages')) {
    throw new Error('surfaces: "userPages" is reserved for the pages people make themselves');
  }
  assertIds('contexts', Object.keys(contexts), SURFACE_PATTERN);
  for (const [name, values] of Object.entries(contexts)) assertIds(`context ${name}`, values);

  const params = new Map<string, Field[]>();
  for (const id of actionIds) {
    const schema = (spec.actions[id] as ActionSpec | undefined)?.params;
    if (schema !== undefined) params.set(id, describeFields(schema, `action ${id} params`));
  }

  const known = new Set<string>(actionIds);
  for (const id of surfaceIds)
    validateSurface(id, spec.surfaces[id] as SurfaceSpec, known, contexts);

  const toAction = canonicaliser([...actionIds, ...aliases.keys()]);
  const toSurface = canonicaliser(surfaceIds);
  const toContext = new Map(
    Object.entries(contexts).map(([name, values]) => [name, canonicaliser(values)]),
  );

  const items = (surface: string, context?: string): readonly string[] => {
    const entry = spec.surfaces[surface] as SurfaceSpec | undefined;
    if (entry?.kind !== 'list') return [];
    if (context === undefined || !entry.available) return entry.items;
    return entry.available(context);
  };

  const contract: Contract<A, S, C, D> = {
    id: spec.id,
    version: spec.version ?? '1',
    description: spec.description,
    actions: spec.actions,
    contexts,
    sources,
    regions,
    routes,
    surfaces: spec.surfaces,
    hash: hash(serialize(spec, contexts, resolvedSources, params)),
    actionIds,
    sourceIds,
    routeIds,
    surfaceIds,
    action(id) {
      const found = toAction(id);
      if (found === undefined) return undefined;
      return aliases.get(found) ?? (found as ActionId);
    },
    surface: (name) => toSurface(name) as SurfaceId | undefined,
    contextValue: (context, value) => toContext.get(context)?.(value),
    items,
    source: (id) => resolvedSources[id.trim().toLowerCase()],
    path: (name) => resolvePath(resolvedSources, name),
    params: (id) => params.get(id) ?? [],
    route: (name) => toRoute(name),
  };
  for (const id of actionIds) validateAction(contract, id, params.get(id) ?? []);
  assertIds('regions', Object.keys(regions));
  for (const [name, region] of Object.entries(regions)) {
    if (region.entity !== undefined && !contract.source(region.entity)) {
      throw new Error(`region ${name}: unknown source "${region.entity}"`);
    }
  }
  validateRoutes(contract);
  for (const id of surfaceIds) {
    const surface = spec.surfaces[id] as SurfaceSpec;
    if (surface.kind === 'page') validateStandard(contract, id, surface);
  }
  return Object.freeze(contract);
}

/** Every standard page must pass the rules redesigns pass, for every context value. */
function validateStandard(contract: AnyContract, id: string, spec: AnyPageSpec): void {
  if (spec.entity !== undefined && !contract.source(spec.entity)) {
    throw new Error(`surface ${id}: unknown source "${spec.entity}"`);
  }
  const values = spec.context === undefined ? [undefined] : (contract.contexts[spec.context] ?? []);
  for (const value of values) {
    try {
      validatePage(contract, spec, spec.standard(value), value);
    } catch (error) {
      if (!(error instanceof PageProblem)) throw error;
      throw new Error(
        `surface ${id}: the standard page${value === undefined ? '' : ` for ${value}`}: ${error.message}`,
        { cause: error },
      );
    }
  }
}

/** Checks what an action runs with and changes, once sources are known. */
function validateAction(contract: AnyContract, id: string, fields: readonly Field[]): void {
  const spec = contract.actions[id] as ActionSpec;
  const fail = (message: string): never => {
    throw new Error(`action ${id}: ${message}`);
  };
  for (const entry of fields) {
    if (entry.type === 'ref' && !contract.source(entry.source ?? '')) {
      fail(`param ${entry.name} refers to unknown source "${entry.source}"`);
    }
  }
  if (spec.effect !== undefined && !EFFECTS.includes(spec.effect)) {
    fail(`effect must be one of ${EFFECTS.join(', ')}`);
  }
  if (spec.confirm !== undefined && (spec.confirm.trim() === '' || spec.confirm.length > 80)) {
    fail('confirm needs 1 to 80 characters');
  }
  for (const name of spec.invalidates ?? []) {
    if (!contract.source(name)) fail(`invalidates unknown source "${name}"`);
  }
  if (spec.when !== undefined && spec.when.length > 0) {
    const row = rowParam(fields);
    const target = row && contract.source(row.source ?? '');
    if (!target) return fail('when needs a param that refers to a row');
    const checked = checkQuery(contract, {
      source: target.id,
      fields: [`${target.id}.${target.key}`],
      filter: spec.when,
      limit: 1,
    });
    if (!checked.ok) fail(`when: ${checked.problem}`);
  }
}

function validateSurface(
  id: string,
  surface: SurfaceSpec,
  known: Set<string>,
  contexts: Record<string, readonly string[]>,
): void {
  const fail = (message: string) => {
    throw new Error(`surface ${id}: ${message}`);
  };
  if (surface.kind === 'list') {
    if (surface.items.length === 0) fail('has no items');
    if (new Set(surface.items).size !== surface.items.length) fail('repeats an item');
    for (const item of surface.items) if (!known.has(item)) fail(`unknown action "${item}"`);
    if (!Number.isInteger(surface.capacity) || surface.capacity < 1) fail('capacity must be ≥ 1');
    const required = surface.required ?? [];
    for (const item of required)
      if (!surface.items.includes(item)) fail(`"${item}" is not an item`);
    if (required.length > surface.capacity) fail('more required items than capacity');
    if (surface.context !== undefined) {
      const values = contexts[surface.context];
      if (!values) fail(`unknown context "${surface.context}"`);
      for (const value of values ?? []) {
        for (const item of surface.available?.(value) ?? []) {
          if (!surface.items.includes(item)) fail(`"${item}" for ${value} is not an item`);
        }
      }
    }
  } else if (surface.kind === 'choice') {
    assertIds(`surface ${id} values`, surface.values);
    if (!surface.values.includes(surface.default)) fail('default is not a value');
  } else if (surface.kind === 'page') {
    const names = Object.keys(surface.blocks);
    assertIds(`surface ${id} blocks`, names, SURFACE_PATTERN);
    for (const name of names) {
      if ((BUILT_IN as readonly string[]).includes(name)) fail(`"${name}" is a built-in block`);
    }
    if (surface.context !== undefined && !contexts[surface.context]) {
      fail(`unknown context "${surface.context}"`);
    }
    for (const [key, least] of [
      ['maxElements', 1],
      ['maxDepth', 2],
      ['maxQueries', 0],
    ] as const) {
      const value = surface[key];
      if (value !== undefined && (!Number.isInteger(value) || value < least)) {
        fail(`${key} must be an integer ≥ ${least}`);
      }
    }
  } else if (!Number.isInteger(surface.max) || surface.max < 1) {
    fail('max must be ≥ 1');
  }
}

/** Everything a planner sees, as plain data: functions are evaluated or left out. */
function serialize(
  spec: ContractSpec<
    Record<string, ActionSpec>,
    Record<string, SurfaceSpec>,
    Record<string, readonly string[]>,
    Record<string, AnySourceSpec>
  >,
  contexts: Record<string, readonly string[]>,
  sources: Record<string, ResolvedSource>,
  params: ReadonlyMap<string, readonly Field[]>,
): unknown {
  const surfaces: Record<string, unknown> = {};
  for (const [id, surface] of Object.entries(spec.surfaces)) {
    if (surface.kind === 'list') {
      const values = surface.context !== undefined ? (contexts[surface.context] ?? []) : [];
      surfaces[id] = {
        ...surface,
        available: surface.available
          ? Object.fromEntries(values.map((value) => [value, surface.available?.(value)]))
          : undefined,
      };
    } else if (surface.kind === 'collection') {
      surfaces[id] = { ...surface, item: itemSchema(surface.item) };
    } else if (surface.kind === 'page') {
      surfaces[id] = {
        ...surface,
        blocks: Object.fromEntries(
          Object.entries(surface.blocks).map(([name, entry]) => [
            name,
            { ...entry, props: itemSchema(entry.props) },
          ]),
        ),
      };
    } else {
      surfaces[id] = surface;
    }
  }
  // Params are hashed as described fields, which survive conversion to JSON and back exactly.
  const actions = Object.fromEntries(
    Object.entries(spec.actions).map(([id, entry]) => [
      id,
      entry.params === undefined ? entry : { ...entry, params: params.get(id) },
    ]),
  );
  // Empty collections count as absent, so a contract spelled with `{}` hashes the same.
  const present = <T extends object>(value: T | undefined) =>
    value === undefined || Object.keys(value).length === 0 ? undefined : value;
  return {
    ...spec,
    actions,
    contexts,
    sources: present(sources),
    regions: present(spec.regions),
    routes: present(spec.routes),
    surfaces,
    version: spec.version ?? '1',
  };
}

/** The JSON Schema of a collection item, or a marker when zod can't represent it. */
export function itemSchema(schema: z.ZodType): unknown {
  try {
    return z.toJSONSchema(schema);
  } catch {
    return 'unrepresentable';
  }
}
