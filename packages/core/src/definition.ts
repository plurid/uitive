import type {
  ActionView,
  AnyContract,
  CollectionEntry,
  CollectionSpec,
  CollectionValue,
  ListSpec,
  ListValue,
  AnyPage,
  AnyPageSpec,
} from './contract.js';
import { toPage } from './page.js';

/** Who proposed an operation: the deterministic planner, a model, or the person. */
export type Origin = 'heuristic' | 'model' | 'user';

/** Usage statistics an operation may cite. */
export type Metric = 'uses' | 'activeSessions' | 'viaOverflow' | 'viaPalette' | 'idleSessions';

/** Every usage statistic an operation may cite as evidence. */
export const METRICS: readonly Metric[] = [
  'uses',
  'activeSessions',
  'viaOverflow',
  'viaPalette',
  'idleSessions',
];

/** Why an operation is justified: a usage statistic taken from the summary, or the user's words. */
export type Evidence =
  { action: string; metric: Metric; value: number; window?: number } | { intent: string };

/**
 * A change to a list: an action promoted or demoted by learning, or moved, pinned, unpinned, hidden
 * or restored by the person.
 */
export interface ListChange {
  /** Says the change is to a list. */
  kind: 'list';
  /** The list. */
  surface: string;
  /** The context value it applies to, for lists keyed by context. */
  context?: string;
  /**
   * What happens to the item: learning promotes and demotes; the person moves, pins, unpins, hides
   * and restores.
   */
  op: 'promote' | 'demote' | 'move' | 'pin' | 'unpin' | 'hide' | 'restore';
  /** The action. */
  target: string;
  /** For `move`: the position among visible items. */
  index?: number;
  /** For operations that add a visible item: the item that made room, fixed when applied. */
  evict?: string;
}

/** A choice set to one of its values. */
export interface ChoiceChange {
  /** Says the change is to a choice. */
  kind: 'choice';
  /** The choice. */
  surface: string;
  /** Choices are only ever set. */
  op: 'set';
  /** The value chosen. */
  value: string;
}

/** An item added to, changed in or removed from a collection. */
export interface CollectionChange {
  /** Says the change is to a collection. */
  kind: 'collection';
  /** The collection. */
  surface: string;
  /** Whether the item is added, changed or removed. */
  op: 'add' | 'update' | 'remove';
  /** The item's ID. */
  item: string;
  /** For `add` and `update`: the item itself. */
  value?: unknown;
}

/** Pages keyed by context can be redesigned for one value, or for every value at once. */
export const EVERY = '*';

/** A page redesigned outright, or put back to standard. */
export interface PageChange {
  /** Says the change is to a page. */
  kind: 'page';
  /** The page. */
  surface: string;
  /** A context value, or `*` for every value. */
  context?: string;
  /** Redesigned outright, or put back to standard. */
  op: 'set' | 'reset';
  /** For `set`: the whole new page. */
  value?: AnyPage;
}

/** User pages share this reserved surface name: they belong to no surface the application declares. */
export const USER_PAGES = 'userPages';

/** A page the user made themselves, served at `/apt/<slug>`. */
export interface UserPageChange {
  /** Says the change is to one of the person's own pages. */
  kind: 'userPage';
  /** Always `userPages`. */
  surface: typeof USER_PAGES;
  /** Whether the page is made, renamed, redesigned or deleted. */
  op: 'create' | 'rename' | 'set' | 'delete';
  /** The page's slug, in its address. */
  slug: string;
  /** For `create` and `rename`. */
  title?: string;
  /** For `create` and `set`: the whole page. */
  value?: AnyPage;
}

/** One change to one surface, by its kind. */
export type Change = ListChange | ChoiceChange | CollectionChange | PageChange | UserPageChange;

/**
 * A change with its provenance: who proposed it, on what evidence, against which version, and on
 * which layer.
 */
export interface Operation {
  /** Its ID, for revert, keep and explanations. */
  id: string;
  /** What it changes. */
  change: Change;
  /** Who proposed it: learning, the model, or the person. */
  origin: Origin;
  /** User-layer operations outrank model-layer ones. */
  layer: 'model' | 'user';
  /** What it rests on: usage figures, or the person's words. */
  evidence: readonly Evidence[];
  /** A short plain-text note from the model, shown beneath the deterministic reason. */
  note?: string;
  /** What the operation was planned against, for rebasing and expiry. */
  basedOn: { version: number; summary: string; session: number };
}

/**
 * `suggested` operations add collection items for the user to accept; `kept` ones were
 * confirmed by the user and join the user layer.
 */
export type Status = 'active' | 'kept' | 'reverted' | 'suggested' | 'dismissed';

/**
 * An operation in a person's definition, with its status: active, kept, reverted, suggested or
 * dismissed.
 */
export interface AppliedOperation extends Operation {
  /** Whether it is active, kept, reverted, suggested or dismissed. */
  status: Status;
  /** The session it was applied in. */
  session: number;
  /** The adaptation that applied it. */
  adaptation: string;
}

/** One user's interface: the standard layout plus every operation applied to it. */
export interface Definition {
  /** 2 since pages became flat elements; version 1 definitions are migrated on load. */
  schemaVersion: 2;
  /** The hash of the contract it was made against. */
  contract: string;
  /** Increments on every change. */
  version: number;
  /** Every operation applied, in order. */
  operations: readonly AppliedOperation[];
  /** Operation keys a planner may not propose until a session. */
  cooldowns: readonly { key: string; until: number }[];
  /** Operation keys reverted twice: never proposed again. */
  blocked: readonly string[];
  /** When frozen, planners change nothing. */
  frozen: boolean;
  /** The goal the user stated in their own words. */
  goal?: string;
}

/** A definition with no changes yet: the application as shipped. */
export function emptyDefinition(contract: AnyContract): Definition {
  return {
    schemaVersion: 2,
    contract: contract.hash,
    version: 0,
    operations: [],
    cooldowns: [],
    blocked: [],
    frozen: false,
  };
}

/**
 * Brings a stored definition up to date: version 1 kept pages as sections of blocks, which
 * convert mechanically to flat elements.
 */
export function migrateDefinition(
  definition: Omit<Definition, 'schemaVersion'> & { schemaVersion: number },
): Definition {
  if (definition.schemaVersion === 2) return definition as Definition;
  return {
    ...definition,
    schemaVersion: 2,
    operations: definition.operations.map((operation) =>
      operation.change.kind === 'page' && operation.change.value !== undefined
        ? {
            ...operation,
            change: { ...operation.change, value: toPage(operation.change.value) as AnyPage },
          }
        : operation,
    ),
  };
}

/** Identifies what an operation does, regardless of when or by whom: for cooldowns and repeats. */
export function operationKey(change: Change): string {
  if (change.kind === 'list') {
    return `${change.surface}|${change.context ?? ''}|${change.op}|${change.target}`;
  }
  if (change.kind === 'choice') return `${change.surface}||set|${change.value}`;
  if (change.kind === 'page') return `${change.surface}|${change.context ?? ''}|${change.op}`;
  if (change.kind === 'userPage') return `${USER_PAGES}|${change.slug}|${change.op}`;
  return `${change.surface}||${change.op}|${change.item}`;
}

/** Whether an operation counts towards the interface: active, or kept by the person. */
export const isApplied = (operation: AppliedOperation) =>
  operation.status === 'active' || operation.status === 'kept';

export const layerOf = (operation: AppliedOperation) =>
  operation.status === 'kept' ? 'user' : operation.layer;

/** Applied operations on one surface, model layer first, each layer in order applied. */
function layered(definition: Definition | undefined, surface: string, context?: string) {
  const own = (definition?.operations ?? []).filter(
    (operation) =>
      isApplied(operation) &&
      operation.change.surface === surface &&
      ((operation.change.kind !== 'list' && operation.change.kind !== 'page') ||
        operation.change.context === context),
  );
  return [
    ...own.filter((operation) => layerOf(operation) === 'model'),
    ...own.filter((operation) => layerOf(operation) === 'user'),
  ];
}

/** Whether the user layer already decides something about a target on a surface. */
export function userDecides(
  definition: Definition,
  surface: string,
  context: string | undefined,
  target: string | undefined,
): boolean {
  return definition.operations.some((operation) => {
    if (!isApplied(operation) || layerOf(operation) !== 'user') return false;
    const change = operation.change;
    if (change.surface !== surface) return false;
    if (change.kind === 'list') return change.context === context && change.target === target;
    if (change.kind === 'choice') return true;
    if (change.kind === 'page') return change.context === context;
    if (change.kind === 'userPage') return change.slug === target;
    return change.item === target;
  });
}

/**
 * A list after folding a definition over it: its value, and what is visible, pinned, hidden and
 * standard.
 */
export interface ListState {
  /** The list as the person has it. */
  value: ListValue;
  /** The items that show. */
  visible: Set<string>;
  /** The items the person pinned. */
  pinned: Set<string>;
  /** Items the user hid, until they restore or pin them. */
  hidden: Set<string>;
  /** The items that show in the standard layout. */
  standard: Set<string>;
}

/** The items a list shows before any operation: required items first, then standard order. */
export function standardVisible(spec: ListSpec, items: readonly string[]): Set<string> {
  const visible = new Set((spec.required ?? []).filter((item) => items.includes(item)));
  for (const item of items) {
    if (visible.size >= spec.capacity) break;
    visible.add(item);
  }
  return visible;
}

/**
 * Folds a definition over a list. `since` marks items moved by operations applied in or after
 * that session, for "moved" markers.
 */
export function resolveList(
  contract: AnyContract,
  definition: Definition | undefined,
  surface: string,
  context?: string,
  since = Number.POSITIVE_INFINITY,
): ListState {
  const spec = contract.surfaces[surface] as ListSpec;
  const items = contract.items(surface, context);
  const required = new Set((spec.required ?? []).filter((item) => items.includes(item)));
  const standard = standardVisible(spec, items);
  const visible = new Set(standard);
  const pinned = new Set<string>();
  const hidden = new Set<string>();
  const moved = new Set<string>();
  let order = [...items];
  const operations = layered(definition, surface, context);

  // The user's final pins protect items from model-layer evictions, whenever they were made.
  const kept = new Set<string>();
  for (const operation of operations) {
    const change = operation.change;
    if (layerOf(operation) !== 'user' || change.kind !== 'list') continue;
    if (change.op === 'pin') kept.add(change.target);
    if (change.op === 'unpin' || change.op === 'hide') kept.delete(change.target);
  }

  const evictable = (item: string, target: string) =>
    item !== target &&
    visible.has(item) &&
    !pinned.has(item) &&
    !kept.has(item) &&
    !required.has(item);
  const show = (target: string, preferred: string | undefined, recent: boolean) => {
    if (visible.has(target)) return;
    visible.add(target);
    if (visible.size > spec.capacity) {
      let out = preferred !== undefined && evictable(preferred, target) ? preferred : undefined;
      for (let index = order.length - 1; out === undefined && index >= 0; index--) {
        const candidate = order[index] as string;
        if (evictable(candidate, target)) out = candidate;
      }
      if (out === undefined) {
        visible.delete(target);
        return;
      }
      visible.delete(out);
      moved.delete(out);
    }
    if (recent) moved.add(target);
  };

  for (const operation of operations) {
    const change = operation.change;
    if (change.kind !== 'list' || !items.includes(change.target)) continue;
    const target = change.target;
    const recent = operation.session >= since;
    switch (change.op) {
      case 'promote':
        show(target, change.evict, recent);
        break;
      case 'demote':
        if (!required.has(target) && !pinned.has(target)) visible.delete(target);
        break;
      case 'pin':
        pinned.add(target);
        hidden.delete(target);
        show(target, change.evict, recent);
        break;
      case 'unpin':
        pinned.delete(target);
        break;
      case 'hide':
        if (required.has(target)) break;
        pinned.delete(target);
        hidden.add(target);
        visible.delete(target);
        moved.delete(target);
        break;
      case 'restore':
        hidden.delete(target);
        if (standard.has(target)) show(target, change.evict, recent);
        break;
      case 'move': {
        if (!spec.reorderable || !visible.has(target)) break;
        order = order.filter((item) => item !== target);
        const shown = order.filter((item) => visible.has(item));
        const before = shown[Math.max(0, Math.min(change.index ?? 0, shown.length))];
        order.splice(before === undefined ? order.length : order.indexOf(before), 0, target);
        if (recent) moved.add(target);
        break;
      }
    }
  }

  const view = (id: string): ActionView => {
    const action = contract.actions[id];
    return {
      id,
      label: action?.label ?? id,
      description: action?.description ?? '',
      ...(action?.group === undefined ? {} : { group: action.group }),
      pinned: pinned.has(id),
      moved: moved.has(id),
    };
  };
  return {
    value: {
      visible: order.filter((item) => visible.has(item)).map(view),
      overflow: order.filter((item) => !visible.has(item)).map(view),
    },
    visible,
    pinned,
    hidden,
    standard,
  };
}

/** A choice's value after a definition: the last applied choice, or its default. */
export function resolveChoice(
  contract: AnyContract,
  definition: Definition | undefined,
  surface: string,
): string {
  const spec = contract.surfaces[surface];
  let value = spec?.kind === 'choice' ? spec.default : '';
  for (const operation of layered(definition, surface)) {
    if (operation.change.kind === 'choice') value = operation.change.value;
  }
  return value;
}

/** A collection after a definition: accepted items and waiting suggestions. */
export function resolveCollection(
  contract: AnyContract,
  definition: Definition | undefined,
  surface: string,
): CollectionValue {
  const spec = contract.surfaces[surface] as CollectionSpec;
  const items = new Map<string, CollectionEntry>();
  const suggestions = new Map<string, CollectionEntry>();
  for (const operation of definition?.operations ?? []) {
    const change = operation.change;
    if (change.kind !== 'collection' || change.surface !== surface) continue;
    const entry = (value: unknown): CollectionEntry => ({
      id: change.item,
      title: spec.title(value),
      value,
      operation: operation.id,
    });
    if (operation.status === 'suggested' && change.op === 'add') {
      suggestions.set(change.item, entry(change.value));
    } else if (isApplied(operation)) {
      suggestions.delete(change.item);
      if (change.op === 'remove') items.delete(change.item);
      else items.set(change.item, entry(change.value));
    }
  }
  return { items: [...items.values()], suggestions: [...suggestions.values()] };
}

/**
 * The page a definition yields: a redesign for this context value, else one for every value,
 * else the standard page. A suggested redesign can be previewed without applying it.
 */
export function resolvePage(
  contract: AnyContract,
  definition: Definition | undefined,
  surface: string,
  context?: string,
  preview?: string,
): AnyPage {
  const spec = contract.surfaces[surface] as AnyPageSpec;
  const pick = (key: string | undefined): AnyPage | undefined => {
    const operations = layered(definition, surface, key);
    const previewed = definition?.operations.find(
      (operation) =>
        operation.id === preview &&
        operation.status === 'suggested' &&
        operation.change.kind === 'page' &&
        operation.change.surface === surface &&
        operation.change.context === key,
    );
    let value: AnyPage | undefined;
    for (const operation of previewed ? [...operations, previewed] : operations) {
      if (operation.change.kind !== 'page') continue;
      value = operation.change.op === 'set' ? operation.change.value : undefined;
    }
    return value === undefined ? undefined : (toPage(value) as AnyPage);
  };
  const standard = () =>
    toPage(spec.standard(spec.context === undefined ? undefined : context)) as AnyPage;
  if (spec.context === undefined) return pick(undefined) ?? standard();
  return (context === undefined ? undefined : pick(context)) ?? pick(EVERY) ?? standard();
}

/** Whether a page has a redesign of its own, for this context value or for every value. */
export function redesigned(
  definition: Definition,
  surface: string,
  context: string | undefined,
): boolean {
  let active = false;
  for (const operation of layered(definition, surface, context)) {
    if (operation.change.kind === 'page') active = operation.change.op === 'set';
  }
  return active;
}

/** A page the user made. */
export interface UserPage {
  /** Its slug: the page lives at `/apt/<slug>`. */
  slug: string;
  /** Its title, as the person named it. */
  title: string;
  /** The page. */
  value: AnyPage;
  /** The operation that created it. */
  operation: string;
}

/** Most pages one person can make. */
export const MAX_USER_PAGES = 20;
/** User page slugs: short, lowercase, URL-safe. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The user's own pages, in the order they made them. */
export function resolveUserPages(definition: Definition | undefined): UserPage[] {
  const pages = new Map<string, UserPage>();
  for (const operation of definition?.operations ?? []) {
    const change = operation.change;
    if (change.kind !== 'userPage' || !isApplied(operation)) continue;
    const existing = pages.get(change.slug);
    if (change.op === 'create' && change.value !== undefined) {
      pages.set(change.slug, {
        slug: change.slug,
        title: change.title ?? change.slug,
        value: toPage(change.value) as AnyPage,
        operation: operation.id,
      });
    } else if (change.op === 'delete') {
      pages.delete(change.slug);
    } else if (existing && change.op === 'rename' && change.title !== undefined) {
      pages.set(change.slug, { ...existing, title: change.title });
    } else if (existing && change.op === 'set' && change.value !== undefined) {
      pages.set(change.slug, { ...existing, value: toPage(change.value) as AnyPage });
    }
  }
  return [...pages.values()];
}
