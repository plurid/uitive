import {
  type Bindings,
  type Confirmation,
  type ParamsOf,
  type Perform,
  type PerformOptions,
  type PerformResult,
  type Target,
} from './action.js';
import { createData, type DataClient } from './cache.js';
import type {
  ActionIdOf,
  ActionSpec,
  ActionView,
  AnyContract,
  AnyPageSpec,
  PageSpec,
  PageValue,
  SectionPage,
  CollectionSpec,
  ContextOf,
  AnyPage,
  ListSpec,
  SurfaceIdOf,
  SurfaceValueOf,
} from './contract.js';
import {
  emptyDefinition,
  isApplied,
  layerOf,
  migrateDefinition,
  resolveUserPages,
  USER_PAGES,
  type UserPage,
  type UserPageChange,
  operationKey,
  EVERY,
  resolveChoice,
  resolveCollection,
  resolveList,
  resolvePage,
  type AppliedOperation,
  type Change,
  type Definition,
  type Evidence,
  type ListChange,
  type Operation,
  type Origin,
} from './definition.js';
import { describe, type Explanation } from './explain.js';
import { toPage, ui, userPageSpec, validatePage, type SectionsPage } from './page.js';
import { buildPath, matchRoute } from './route.js';
import { hash, stableStringify } from './hash.js';
import { heuristicPlanner, keywordCommand } from './heuristic.js';
import type {
  Environment,
  CommandStatus,
  PlanMeta,
  Planner,
  PlanRequest,
  PlanResult,
  ProposedOperation,
  StateView,
} from './planner.js';
import { canonical, check, type Rejection } from './policy.js';
import {
  applyOperation,
  DEFAULT_STABILISER,
  revert as revertOperation,
  setStatus,
  settle,
  stage,
  strength,
  type Pending,
  type StabiliserOptions,
} from './stabiliser.js';
import { memoryStore, type Store } from './storage.js';
import {
  rank,
  summarise,
  type SessionRecord,
  type UsageEvent,
  type UsageSummary,
  type Via,
} from './usage.js';

/**
 * How far the system may act on its own. `suggest`: planned changes wait for the person's yes.
 * `mixed`: a planned change applies at a safe moment once a second plan agrees or it clears the
 * margin. `auto`: planned changes apply at the next safe moment, and suggested items join the
 * interface at once. In every mode a redesign stays a suggestion until the person accepts it.
 */
export type Autonomy = 'suggest' | 'mixed' | 'auto';
/** `standard` shows the application as shipped; `yours` applies the user's definition. */
export type View = 'yours' | 'standard';

/** Where the user is, as the application's router reports it. */
export interface Location {
  /** The path, with its query. */
  path: string;
  /** The contract route the path matches. */
  route?: string;
  /** The route's params, by name. */
  params: Readonly<Record<string, string>>;
  /** The row the page is about, on routes that show one: what `$current` names. */
  entity?: { source: string; key: string };
  /** One of the user's own pages, at `/apt/<slug>`. */
  userPage?: string;
}

/** A page as code may write it: flat elements, or sections of blocks. */
export type PageInput<C extends AnyContract, K extends SurfaceIdOf<C>> =
  C['surfaces'][K] extends PageSpec<infer B>
    ? PageValue<B> | SectionPage<B> | AnyPage
    : AnyPage | SectionsPage;

/** One batch of changes, kept for banners, history and the debug panel. */
export interface Adaptation {
  /** Its ID, for `revertAdaptation`. */
  id: string;
  /**
   * What made it: a plan, pending changes applied, a command, the person acting, an import or a
   * reset.
   */
  kind: 'plan' | 'apply' | 'command' | 'user' | 'import' | 'reset';
  /** The session it happened in. */
  session: number;
  /** Operations it applied, or added as suggestions. */
  applied: readonly string[];
  /** What policy refused, with reasons. */
  rejected: readonly Rejection[];
  /** Operations still waiting for a safe moment or a second plan. */
  pending: number;
  /** For commands: what became of the request. */
  status?: CommandStatus;
  /** For ambiguous commands: what the words could mean. */
  candidates?: readonly string[];
  /** For commands: the request, in the person's words. */
  text?: string;
  /** How the plan was made: the planner, how long it took, and any fallback. */
  meta?: PlanMeta;
}

/**
 * Everything a client holds right now, for panels such as "Your interface" and the debug panel: the
 * definition, what is pending, recent adaptations, where the person is and any run waiting for
 * their yes.
 */
export interface Snapshot {
  /** The current session, counted from the first. */
  session: number;
  /** Whether the person sees their own interface or the standard one. */
  view: View;
  /** How far planned changes may go without the person. */
  autonomy: Autonomy;
  /** The person's definition: every applied operation, cooldowns and blocks. */
  definition: Definition;
  /** Changes waiting for the next safe moment. */
  pending: readonly Pending[];
  /** The most recent adaptation, for banners. */
  latest: Adaptation | undefined;
  /** Recent adaptations, oldest first. */
  adaptations: readonly Adaptation[];
  /** Context values active now, by context name. */
  contexts: Readonly<Record<string, string>>;
  /** Increments with every usage event. */
  usage: number;
  /** A suggested redesign shown in place, before the user accepts or dismisses it. */
  preview: string | undefined;
  /** A run waiting for the user's yes. */
  confirmation: Confirmation | undefined;
  /** Where the user is, once the application reports it. */
  location: Location | undefined;
}

/** The portable form of a definition, for export and import. */
export interface DefinitionDocument {
  /** Says what the document is. */
  format: 'aptuitive.definition';
  /** The document format's version. */
  version: 1;
  /** The contract it was exported from; an import checks its changes against the current one. */
  contract: { id: string; hash: string };
  /** The person's definition. */
  definition: Definition;
}

/** How one use of an action came about, for `record`. */
export interface RecordOptions {
  /**
   * How the person reached it: straight from where it shows, from overflow, the palette, a
   * suggestion, a shortcut or a command. @default 'region'
   */
  via?: Via;
  /**
   * The surface it was used from, such as `toolbar`, so learning knows which list it belongs to.
   */
  surface?: string;
  /** The page element it came from. */
  element?: string;
  /** For palette picks: whether the user typed a search first. */
  typed?: boolean;
}

/**
 * What `createAptuitive` takes: the contract, and where state lives, who plans and the
 * application's code behind the contract.
 */
export interface AptuitiveOptions<C extends AnyContract> {
  /** The contract `defineApp` returned. */
  contract: C;
  /** Where state persists. @default memoryStore() */
  store?: Store;
  /**
   * Who plans: the deterministic planner, or `remotePlanner` for a model on the application's
   * server. Simple commands are always answered locally. @default heuristicPlanner()
   */
  planner?: Planner;
  /** The clock, in milliseconds; tests pass one that moves only when told. @default Date.now */
  now?: () => number;
  /** Minutes without activity that end a session. @default 30 */
  idleMinutes?: number;
  /** Used until the user chooses otherwise. @default 'mixed' */
  autonomy?: Autonomy;
  /**
   * Whether the client plans from use by itself, once a session (see `learn`). With a model
   * planner, each plan is one request to the application's server.
   * @default true
   */
  learn?: boolean;
  /**
   * How cautiously planned changes apply: how many per session, after how many sessions, and how
   * long a reverted one waits.
   */
  stabiliser?: Partial<StabiliserOptions>;
  /** The application's code behind the contract: reading sources, running actions, routing. */
  bindings?: Bindings<C>;
  /** Called when storage or a planner fails; the interface keeps working. */
  onError?: (error: unknown) => void;
  /**
   * For pages Aptuitive adapts from outside, such as in a browser extension: what the page
   * offers now, sent with each request. Structure only, never the page's text.
   */
  environment?: () => Environment | undefined;
}

/**
 * A client: one person's adapting interface. It records use, answers requests, applies what policy
 * allows at safe moments, runs actions through the bindings, and keeps the person's definition in
 * its store.
 */
export interface Aptuitive<C extends AnyContract = AnyContract> {
  /** The contract the client adapts. */
  readonly contract: C;
  /** Query results, shared and cached, when the bindings can fetch. */
  readonly data: DataClient | undefined;
  /** Everything the client holds right now; stable between changes, for `useSyncExternalStore`. */
  getSnapshot(): Snapshot;
  /** Calls the listener after every change; returns its removal. */
  subscribe(listener: () => void): () => void;
  /** A surface's current value. Stable between changes, so it is safe to render from. */
  surface<K extends SurfaceIdOf<C>>(id: K, context?: string): SurfaceValueOf<C, K>;
  /** A surface as the application ships it, whatever the user's definition. */
  standard<K extends SurfaceIdOf<C>>(id: K, context?: string): SurfaceValueOf<C, K>;
  /** The most recent usage events, newest last. */
  events(limit?: number): readonly UsageEvent[];
  /** Every action, ranked for a palette by how the user reaches for them. */
  ranked(): readonly ActionView<ActionIdOf<C>>[];
  /**
   * Records one use of an action, never its params or any text: the evidence learning and planners
   * work from.
   */
  record(action: ActionIdOf<C>, options?: RecordOptions): void;
  /**
   * Runs an action through the bindings. Writes from generated interfaces wait for the user's
   * yes, destructive ones for a typed phrase; a confirmed run is recorded without its params.
   */
  perform<A extends ActionIdOf<C>>(
    action: A,
    params?: ParamsOf<C, A>,
    options?: PerformOptions,
  ): Promise<PerformResult>;
  /** Says yes to the waiting run. For destructive actions, `phrase` must match. */
  confirm(id: string, phrase?: string): boolean;
  /** Says no to the waiting run. */
  cancel(id: string): void;
  /** Declares an interface that can ask for confirmation; returns its removal. */
  confirmations(): () => void;
  /**
   * Tells the client where the user is; call it on every route change. Sets the page's row
   * and any context named like a route param, and records the route's action.
   */
  setLocation(path: string): void;
  /** Follows a link or route through the router binding; returns the URL. */
  navigate(target: Target): string | undefined;
  /** Lets a router follow links, ahead of the bindings' `navigate`; returns its removal. */
  attachRouter(navigate: (href: string) => void): () => void;
  /** The pages the user made, in the order they made them. */
  userPages(): readonly UserPage[];
  /** Makes a page of the user's own; it lives at `/apt/<slug>`. */
  createPage(
    title: string,
    value?: AnyPage | SectionsPage,
  ): { slug: string; adaptation: Adaptation };
  /** Renames one of the user's pages. */
  renamePage(slug: string, title: string): Adaptation;
  /** Redesigns one of the user's pages outright. */
  setUserPage(slug: string, value: AnyPage | SectionsPage): Adaptation;
  /** Deletes one of the user's pages. */
  deletePage(slug: string): Adaptation;
  /**
   * Sets a context, such as the service on screen, so surfaces keyed by it show that value's
   * layout.
   */
  setContext(name: ContextOf<C>, value: string | undefined): void;
  /** A safe moment after the page was hidden: starts a session and applies pending changes. */
  resume(): Adaptation | undefined;
  /** Ends the session now and applies pending changes, as if the user came back later. */
  nextSession(): Adaptation | undefined;
  /** Applies pending changes now: an explicit safe moment. */
  apply(): Adaptation | undefined;
  /**
   * Asks the planner for changes from usage and any stated goal. What policy accepts waits for a
   * safe moment, and redesigns stay suggestions.
   */
  plan(): Promise<Adaptation>;
  /**
   * Plans from use once a session; the provider and `startAptuitive` call it whenever one starts.
   * Does nothing when this session was planned already, when the interface is frozen, or when the
   * client was created with `learn: false`.
   */
  learn(): Promise<Adaptation | undefined>;
  /** A request in the user's own words. With `goal`, the words are kept as their stated goal. */
  ask(text: string, options?: { goal?: boolean }): Promise<Adaptation>;
  /** Keeps an action visible in a list, bringing it out of overflow if needed. */
  pin(surface: SurfaceIdOf<C>, action: ActionIdOf<C>, context?: string): Adaptation;
  /** Lets a pinned action move again; after a pin, it reverts the pin. */
  unpin(surface: SurfaceIdOf<C>, action: ActionIdOf<C>, context?: string): Adaptation;
  /** Moves an action out of a list's visible part, into overflow. Required actions refuse. */
  hide(surface: SurfaceIdOf<C>, action: ActionIdOf<C>, context?: string): Adaptation;
  /** Brings a hidden action back; after a hide, it reverts the hide. */
  restore(surface: SurfaceIdOf<C>, action: ActionIdOf<C>, context?: string): Adaptation;
  /** Moves an action to a position among the visible ones, in a reorderable list. */
  move(surface: SurfaceIdOf<C>, action: ActionIdOf<C>, index: number, context?: string): Adaptation;
  /** Sets a choice to one of its values. */
  set(surface: SurfaceIdOf<C>, value: string): Adaptation;
  /** Redesigns a page outright; for a page keyed by context, one value or `*` for every value. */
  setPage<K extends SurfaceIdOf<C>>(
    surface: K,
    value: PageInput<C, K>,
    context?: string,
  ): Adaptation;
  /** Puts a page back to standard. */
  resetPage(surface: SurfaceIdOf<C>, context?: string): Adaptation;
  /** Shows a suggested redesign in place without applying it; nothing to stop previewing. */
  preview(operation: string | undefined): void;
  /** Adds an item to a collection, checked against its schema and validator. */
  addItem(surface: SurfaceIdOf<C>, value: unknown): Adaptation;
  /** Changes an item of a collection. */
  updateItem(surface: SurfaceIdOf<C>, item: string, value: unknown): Adaptation;
  /** Removes an item from a collection. */
  removeItem(surface: SurfaceIdOf<C>, item: string): Adaptation;
  /** Undoes an applied change. A planned change cools down; a second revert blocks it. */
  revert(operation: string): void;
  /** Undoes every change an adaptation applied. */
  revertAdaptation(adaptation: string): void;
  /** Confirms a change; it joins the user's own layer. */
  keep(operation: string): void;
  /** Accepts a pending change or a suggested item. */
  accept(operation: string): boolean;
  /** Declines a pending change or a suggested item; it cools down. */
  dismiss(operation: string): void;
  /** Stops or resumes planned changes; the person's own still apply. */
  freeze(frozen: boolean): void;
  /** Keeps or clears the person's stated goal, such as "I watch costs", which planners read. */
  setGoal(goal: string | undefined): void;
  /** Shows the person's interface, or the application as shipped. */
  setView(view: View): void;
  /** Sets how far the system may act on its own. */
  setAutonomy(autonomy: Autonomy): void;
  /** Back to the standard interface. Usage is kept. */
  reset(): void;
  /** Forgets everything: usage, definition and history. */
  clearData(): void;
  /** The person's definition, portable, for a file or another device. */
  export(): DefinitionDocument;
  /** Takes a definition from `export`, checked against this contract like any change. */
  import(document: unknown): Adaptation;
  /** Why a change was made, in plain words, with its evidence. */
  explain(operation: string | Operation): Explanation | undefined;
  /** Exactly what a planner would receive: all that leaves the device. */
  request(kind: 'plan' | 'command', text?: string): PlanRequest;
  /** Usage summarised per action and surface, as planners see it. */
  summary(): UsageSummary;
  /** Writes pending state to the store now. */
  flush(): void;
}

interface State {
  /** 2 since pages became flat elements. */
  schemaVersion: 2;
  contract: string;
  session: number;
  lastActivityAt: number;
  sessions: SessionRecord[];
  events: UsageEvent[];
  definition: Definition;
  pending: Pending[];
  seen: Record<string, number>;
  adaptations: Adaptation[];
  view: View;
  autonomy: Autonomy;
  counter: number;
  /** The session `learn` last planned. */
  planned?: number;
}

const MAX_EVENTS = 2000;
const MAX_SESSIONS = 30;
const MAX_ADAPTATIONS = 50;
const MAX_COMMAND = 500;
/** Context values per surface a planner hears about, besides the current one. */
const FOCUS = 5;
const NOT_ALLOWED = new Set([
  'required',
  'precedence',
  'frozen',
  'capacity',
  'blocked',
  'cooldown',
  'kind',
]);

/**
 * Creates a client for one person's interface. State loads synchronously from the store, so a
 * stored interface shows on the first paint.
 */
export function createAptuitive<C extends AnyContract>(options: AptuitiveOptions<C>): Aptuitive<C> {
  const { contract } = options;
  const store = options.store ?? memoryStore();
  const planner = options.planner ?? heuristicPlanner();
  const local = heuristicPlanner();
  const now = options.now ?? Date.now;
  const idle = (options.idleMinutes ?? 30) * 60_000;
  const tuning: StabiliserOptions = { ...DEFAULT_STABILISER, ...options.stabiliser };
  const report = (error: unknown) => options.onError?.(error);

  const fresh = (): State => ({
    schemaVersion: 2,
    contract: contract.hash,
    session: 0,
    lastActivityAt: now(),
    sessions: [{ index: 0, startedAt: now(), contexts: {} }],
    events: [],
    definition: emptyDefinition(contract),
    pending: [],
    seen: {},
    adaptations: [],
    view: 'yours',
    autonomy: options.autonomy ?? 'mixed',
    counter: 0,
  });

  let state = load();
  let contexts: Record<string, string> = {};
  let usage = 0;
  let preview: string | undefined;
  let scheduled = false;
  let waiting: { entry: Confirmation; resolve: (yes: boolean) => void } | undefined;
  let location: Location | undefined;
  let router: ((href: string) => void) | undefined;
  let ownPages: { version: number; value: readonly UserPage[] } | undefined;
  let confirmers = 0;
  const bindings = options.bindings;
  const data =
    bindings?.fetch === undefined
      ? undefined
      : createData(contract, bindings.fetch, {
          now,
          ...(bindings.context === undefined ? {} : { context: () => bindings.context?.() ?? {} }),
          onError: report,
        });
  const listeners = new Set<() => void>();
  const surfaces = new Map<string, unknown>();
  let cacheKey = '';
  let ranking: { key: string; value: readonly ActionView[] } | undefined;
  let summaryCache: { key: string; value: UsageSummary } | undefined;
  let snapshot = makeSnapshot();

  function load(): State {
    let raw: unknown;
    try {
      raw = store.load();
    } catch (error) {
      report(error);
    }
    if (!isState(raw)) return fresh();
    // Version 1 kept pages as sections of blocks; they convert to flat elements.
    const stored: State = {
      ...raw,
      schemaVersion: 2,
      definition: migrateDefinition(raw.definition),
    };
    if (stored.contract === contract.hash) return stored;
    // The contract changed: keep what still means something, drop the rest.
    // Pages built from blocks the application no longer has are dropped, not drawn half empty.
    const operations = stored.definition.operations.flatMap((operation) => {
      try {
        const change = canonical(operation.change, contract);
        if (change.kind === 'page' && change.op === 'set') {
          validatePage(
            contract,
            contract.surfaces[change.surface] as AnyPageSpec,
            change.value,
            change.context,
          );
        } else if (change.kind === 'userPage' && change.value !== undefined) {
          validatePage(contract, userPageSpec(), change.value);
        }
        return [{ ...operation, change }];
      } catch {
        return [];
      }
    });
    const events = stored.events.flatMap((event) => {
      const action = contract.action(event.action);
      return action === undefined ? [] : [{ ...event, action }];
    });
    return {
      ...stored,
      contract: contract.hash,
      events,
      pending: [],
      seen: {},
      definition: { ...stored.definition, contract: contract.hash, operations },
    };
  }

  function makeSnapshot(): Snapshot {
    return {
      session: state.session,
      view: state.view,
      autonomy: state.autonomy,
      definition: state.definition,
      pending: state.pending,
      latest: state.adaptations[state.adaptations.length - 1],
      adaptations: state.adaptations,
      contexts: { ...contexts },
      usage,
      preview,
      confirmation: waiting?.entry,
      location,
    };
  }

  function changed() {
    snapshot = makeSnapshot();
    persist();
    for (const listener of [...listeners]) listener();
  }

  function persist() {
    if (scheduled) return;
    scheduled = true;
    void Promise.resolve().then(flush);
  }

  function flush() {
    scheduled = false;
    try {
      store.save(state);
    } catch (error) {
      report(error);
      // Most likely out of quota: keep the newest half of the usage and try once more.
      state = { ...state, events: state.events.slice(-Math.floor(state.events.length / 2)) };
      try {
        store.save(state);
      } catch (again) {
        report(again);
      }
    }
  }

  const nextId = (prefix: string) => {
    state = { ...state, counter: state.counter + 1 };
    return `${prefix}${state.counter.toString(36)}`;
  };

  function noteContexts() {
    const sessions = [...state.sessions];
    const current = sessions[sessions.length - 1];
    if (!current || current.index !== state.session) return;
    const merged: Record<string, string[]> = { ...current.contexts };
    for (const [name, value] of Object.entries(contexts)) {
      const values = merged[name] ?? [];
      if (!values.includes(value)) merged[name] = [...values, value];
    }
    sessions[sessions.length - 1] = { ...current, contexts: merged };
    state = { ...state, sessions };
  }

  function startSession() {
    const session = state.session + 1;
    state = {
      ...state,
      session,
      lastActivityAt: now(),
      sessions: [...state.sessions, { index: session, startedAt: now(), contexts: {} }].slice(
        -MAX_SESSIONS,
      ),
    };
    noteContexts();
  }

  function summary(): UsageSummary {
    const key = `${usage}|${state.definition.version}|${state.session}|${state.events.length}`;
    if (summaryCache?.key !== key) {
      summaryCache = {
        key,
        value: summarise(contract, state.definition, state.events, state.sessions, state.session),
      };
    }
    return summaryCache.value;
  }

  function remember(adaptation: Adaptation): Adaptation {
    state = { ...state, adaptations: [...state.adaptations, adaptation].slice(-MAX_ADAPTATIONS) };
    return adaptation;
  }

  function safeMoment(): Adaptation | undefined {
    if (state.autonomy === 'suggest' || state.pending.length === 0) return undefined;
    const id = nextId('a');
    const settled = settle(
      {
        contract,
        definition: state.definition,
        pending: state.pending,
        summary: summary(),
        session: state.session,
        adaptation: id,
      },
      tuning,
    );
    state = { ...state, definition: settled.definition, pending: settled.pending };
    if (settled.applied.length === 0 && settled.rejected.length === 0) return undefined;
    return remember({
      id,
      kind: 'apply',
      session: state.session,
      applied: settled.applied.map((operation) => operation.id),
      rejected: settled.rejected,
      pending: settled.pending.length,
    });
  }

  function toOperation(proposed: ProposedOperation, origin: Origin, text?: string): Operation {
    const evidence: Evidence[] = proposed.evidence.map((entry) =>
      'intent' in entry ? { intent: text ?? '' } : { ...entry, value: 0 },
    );
    return {
      id: `${hash(proposed.change)}.${nextId('')}`,
      change: proposed.change,
      origin,
      layer: origin === 'user' ? 'user' : 'model',
      evidence: origin === 'user' && text !== undefined ? [{ intent: text }] : evidence,
      ...(proposed.note === undefined ? {} : { note: proposed.note }),
      basedOn: {
        version: state.definition.version,
        summary: summary().hash,
        session: state.session,
      },
    };
  }

  /** Applies operations immediately: a user acting, or a command they gave. */
  function applyNow(
    operations: readonly Operation[],
    kind: Adaptation['kind'],
    extra: Partial<Adaptation> = {},
    intent?: string,
  ): Adaptation {
    const id = nextId('a');
    let definition = state.definition;
    const applied: string[] = [];
    const rejected: Rejection[] = [];
    for (const operation of operations) {
      const result = check([operation], {
        contract,
        definition,
        summary: summary(),
        session: state.session,
        ...(intent === undefined ? {} : { intent }),
      });
      rejected.push(...result.rejected);
      for (const accepted of result.accepted) {
        definition = applyOperation(definition, accepted, {
          contract,
          summary: summary(),
          session: state.session,
          adaptation: id,
          options: tuning,
        });
        // An undo reverts the change it undoes rather than adding one.
        if (definition.operations.some((entry) => entry.id === accepted.id)) {
          applied.push(accepted.id);
        }
      }
    }
    state = { ...state, definition };
    const adaptation = remember({
      id,
      kind,
      session: state.session,
      applied,
      rejected,
      pending: state.pending.length,
      ...extra,
    });
    changed();
    return adaptation;
  }

  function userChange(change: Change): Adaptation {
    return applyNow([toOperation({ change, evidence: [] }, 'user')], 'user');
  }

  function stateView(keep: (surface: string, context: string | undefined) => boolean): StateView {
    const definition = state.definition;
    const rows = summary().rows;
    const lists: StateView['lists'][number][] = [];
    const choices: Record<string, string> = {};
    const collections: Record<string, string[]> = {};
    const pages: StateView['pages'][number][] = [];
    for (const surface of contract.surfaceIds) {
      const spec = contract.surfaces[surface];
      if (spec?.kind === 'list') {
        const values =
          spec.context === undefined
            ? [undefined]
            : [
                ...new Set([
                  ...rows.filter((row) => row.surface === surface).map((row) => row.context),
                  contexts[spec.context],
                ]),
              ]
                .filter((value): value is string => value !== undefined)
                .sort();
        for (const context of values) {
          if (!keep(surface, context)) continue;
          const resolved = resolveList(contract, definition, surface, context);
          lists.push({
            surface,
            ...(context === undefined ? {} : { context }),
            visible: resolved.value.visible.map((view) => view.id),
            pinned: [...resolved.pinned],
          });
        }
      } else if (spec?.kind === 'choice') {
        choices[surface] = resolveChoice(contract, definition, surface);
      } else if (spec?.kind === 'collection') {
        collections[surface] = resolveCollection(contract, definition, surface).items.map(
          (entry) => entry.title,
        );
      } else if (spec?.kind === 'page') {
        const context = spec.context === undefined ? undefined : contexts[spec.context];
        if (spec.context !== undefined && context === undefined) continue;
        pages.push({
          surface,
          ...(context === undefined ? {} : { context }),
          value: resolvePage(contract, definition, surface, context),
        });
      }
    }
    const planned = definition.operations.filter((operation) => operation.origin !== 'user');
    const own = resolveUserPages(definition);
    const inView = own.find((entry) => entry.slug === location?.userPage);
    return {
      lists,
      choices,
      collections,
      pages,
      userPages: own.map((entry) => ({ slug: entry.slug, title: entry.title })),
      ...(inView === undefined ? {} : { userPage: { slug: inView.slug, value: inView.value } }),
      user: definition.operations
        .filter((operation) => isApplied(operation) && layerOf(operation) === 'user')
        .map((operation) => operationKey(operation.change)),
      cooldowns: definition.cooldowns
        .filter((entry) => entry.until > state.session)
        .map((entry) => entry.key),
      blocked: [...definition.blocked],
      frozen: definition.frozen,
      recent: planned
        .filter((operation) => operation.status === 'kept' || operation.status === 'reverted')
        .slice(-20)
        .map((operation) => ({
          key: operationKey(operation.change),
          outcome: operation.status === 'kept' ? ('kept' as const) : ('reverted' as const),
        })),
    };
  }

  /**
   * The context values worth a planner's attention: the current one and the most used few.
   * Requests stay small however many contexts an application has.
   */
  function focus(): (surface: string, context: string | undefined) => boolean {
    const uses = new Map<string, number>();
    for (const row of summary().rows) {
      if (row.context === undefined) continue;
      const key = `${row.surface}|${row.context}`;
      uses.set(key, (uses.get(key) ?? 0) + row.uses);
    }
    const top = new Set(
      [...uses.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, FOCUS)
        .map(([key]) => key),
    );
    return (surface, context) => {
      if (context === undefined) return true;
      const spec = contract.surfaces[surface];
      const name = spec?.kind === 'list' || spec?.kind === 'page' ? spec.context : undefined;
      return (name !== undefined && contexts[name] === context) || top.has(`${surface}|${context}`);
    };
  }

  function request(kind: 'plan' | 'command', text?: string): PlanRequest {
    const goal = state.definition.goal;
    const environment = options.environment?.();
    const keep = focus();
    const full = summary();
    return {
      kind,
      contract: { id: contract.id, hash: contract.hash },
      session: state.session,
      summary: { ...full, rows: full.rows.filter((row) => keep(row.surface, row.context)) },
      state: stateView(keep),
      contexts: { ...contexts },
      ...(location?.route === undefined ? {} : { route: location.route }),
      ...(text === undefined ? {} : { text }),
      ...(goal === undefined ? {} : { goal }),
      ...(environment === undefined ? {} : { environment }),
    };
  }

  async function callPlanner(chosen: Planner, planRequest: PlanRequest): Promise<PlanResult> {
    const started = Date.now();
    try {
      return await chosen.plan(planRequest, contract);
    } catch (error) {
      report(error);
      const result = await local.plan(planRequest, contract);
      const reason = error instanceof Error ? error.message : String(error);
      return { ...result, meta: { ...result.meta, ms: Date.now() - started, fellBack: reason } };
    }
  }

  function status(
    result: PlanResult,
    applied: number,
    rejected: readonly Rejection[],
  ): CommandStatus {
    if (result.status === 'ambiguous') return 'ambiguous';
    if (result.operations.length === 0) return result.status ?? 'unsupported';
    const refusals = rejected.filter((entry) => entry.rule !== 'noop');
    if (applied === 0) return refusals.length === 0 ? 'done' : 'not_allowed';
    return refusals.some((entry) => NOT_ALLOWED.has(entry.rule)) ? 'partial' : 'done';
  }

  /** Resolves a surface for a view, memoised until the definition or session changes. */
  function resolve(id: string, context: string | undefined, view: View): unknown {
    const key = `${state.definition.version}|${state.session}|${preview ?? ''}`;
    if (key !== cacheKey) {
      surfaces.clear();
      cacheKey = key;
    }
    const spec = contract.surfaces[id];
    const value =
      (spec?.kind === 'list' || spec?.kind === 'page') && spec.context !== undefined
        ? (context ?? contexts[spec.context])
        : undefined;
    const entryKey = `${view}|${id}|${value ?? ''}`;
    if (!surfaces.has(entryKey)) {
      const definition = view === 'standard' ? undefined : state.definition;
      let resolved: unknown;
      if (spec?.kind === 'list') {
        resolved = resolveList(contract, definition, id, value, state.session).value;
      } else if (spec?.kind === 'choice') {
        resolved = resolveChoice(contract, definition, id);
      } else if (spec?.kind === 'page') {
        resolved = resolvePage(
          contract,
          definition,
          id,
          value,
          view === 'standard' ? undefined : preview,
        );
      } else {
        resolved = resolveCollection(contract, definition, id);
      }
      surfaces.set(entryKey, resolved);
    }
    return surfaces.get(entryKey);
  }

  // Another tab wrote newer state: adopt it, without writing it back.
  store.watch?.(() => {
    state = load();
    summaryCache = undefined;
    ranking = undefined;
    cacheKey = '';
    usage++;
    snapshot = makeSnapshot();
    for (const listener of [...listeners]) listener();
  });

  // Page start is a safe moment: nothing has been drawn yet.
  if (now() - state.lastActivityAt > idle) startSession();
  safeMoment();
  snapshot = makeSnapshot();

  function performerFor(action: string): Perform | undefined {
    const perform = bindings?.perform;
    if (typeof perform === 'function') return perform;
    return (perform as Record<string, Perform> | undefined)?.[action];
  }

  function follow(target: Target): string | undefined {
    const href = 'href' in target ? target.href : buildPath(contract, target.route, target.params);
    if (href === undefined) {
      report(new Error(`Can't build a link to ${'route' in target ? target.route : 'nowhere'}`));
      return undefined;
    }
    (router ?? bindings?.navigate)?.(href);
    return href;
  }

  function userPageChange(change: Omit<UserPageChange, 'kind' | 'surface'>): Adaptation {
    return userChange({ kind: 'userPage', surface: USER_PAGES, ...change });
  }

  function slugFor(title: string): string {
    const taken = new Set(resolveUserPages(state.definition).map((entry) => entry.slug));
    const base =
      title
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'page';
    let slug = base;
    for (let count = 2; taken.has(slug); count++) slug = `${base}-${count}`;
    return slug;
  }

  /** Asks the user through whichever interface declared it can; resolves with their answer. */
  function ask(entry: Confirmation): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      waiting = { entry, resolve };
      changed();
    });
  }

  const sameWords = (a: string, b: string) =>
    a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

  const client: Aptuitive<C> = {
    contract,
    data,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    surface: (id, context) => resolve(id, context, state.view) as SurfaceValueOf<C, typeof id>,
    standard: (id, context) => resolve(id, context, 'standard') as SurfaceValueOf<C, typeof id>,
    events: (limit = 50) => state.events.slice(-limit),

    ranked() {
      const key = `${usage}|${state.session}`;
      if (ranking?.key !== key) {
        ranking = {
          key,
          value: rank(contract, state.events, state.session).map((id) => {
            const action = contract.actions[id];
            return {
              id,
              label: action?.label ?? id,
              description: action?.description ?? '',
              ...(action?.group === undefined ? {} : { group: action.group }),
              pinned: false,
              moved: false,
            };
          }),
        };
      }
      return ranking.value as readonly ActionView<ActionIdOf<C>>[];
    },

    record(action, recordOptions = {}) {
      const id = contract.action(action);
      if (id === undefined) {
        report(new Error(`Unknown action "${action}"`));
        return;
      }
      // The first interaction after idle starts a session but is never a safe moment.
      if (now() - state.lastActivityAt > idle) startSession();
      const event: UsageEvent = {
        action: id,
        via: recordOptions.via ?? 'region',
        session: state.session,
        ...(recordOptions.surface === undefined ? {} : { surface: recordOptions.surface }),
        ...(recordOptions.element === undefined ? {} : { element: recordOptions.element }),
        ...(Object.keys(contexts).length === 0 ? {} : { contexts: { ...contexts } }),
        ...(recordOptions.typed === undefined ? {} : { typed: recordOptions.typed }),
      };
      state = {
        ...state,
        lastActivityAt: now(),
        events: [...state.events, event].slice(-MAX_EVENTS),
      };
      noteContexts();
      usage++;
      changed();
    },

    async perform(action, params, performOptions = {}) {
      const id = contract.action(action);
      if (id === undefined) return { status: 'refused', message: `No action "${action}"` };
      const spec = contract.actions[id] as ActionSpec;
      let values: Record<string, unknown> = { ...(params as Record<string, unknown> | undefined) };
      if (spec.params !== undefined) {
        const parsed = spec.params.safeParse(values);
        if (!parsed.success) {
          return {
            status: 'refused',
            message: `${spec.label}: ${parsed.error.issues[0]?.message ?? 'invalid params'}`,
          };
        }
        values = parsed.data as Record<string, unknown>;
      }
      const changes = spec.effect === 'write' || spec.effect === 'destructive';
      if (changes && preview !== undefined) {
        return {
          status: 'refused',
          message: 'Changes wait until you accept or dismiss the preview',
        };
      }
      const generated = (performOptions.origin ?? 'generated') === 'generated';
      const needsYes =
        generated &&
        (spec.effect === 'destructive' || (spec.effect === 'write' && !performOptions.confirmed));
      if (needsYes) {
        if (confirmers === 0) {
          return { status: 'refused', message: 'Nothing here can ask you to confirm this' };
        }
        if (waiting)
          return { status: 'refused', message: 'Another change is waiting for your yes' };
        const fields = contract.params(id);
        const yes = await ask({
          id: nextId('c'),
          action: id,
          label: spec.label,
          description: spec.description,
          effect: spec.effect as 'write' | 'destructive',
          params: values,
          fields,
          ...(spec.effect === 'destructive' ? { phrase: spec.confirm ?? spec.label } : {}),
        });
        if (!yes) return { status: 'cancelled' };
      }
      const run = performerFor(id);
      if (run === undefined && spec.effect !== undefined) {
        return { status: 'failed', message: `Nothing runs ${spec.label} here` };
      }
      try {
        const outcome = await run?.(values, {
          ...bindings?.context?.(),
          action: id,
          idempotencyKey: hash({ action: id, params: values, at: now(), run: nextId('r') }),
        });
        client.record(id as ActionIdOf<C>, {
          via: performOptions.via ?? 'region',
          ...(performOptions.surface === undefined ? {} : { surface: performOptions.surface }),
          ...(performOptions.element === undefined ? {} : { element: performOptions.element }),
          ...(performOptions.typed === undefined ? {} : { typed: performOptions.typed }),
        });
        if (spec.invalidates !== undefined && spec.invalidates.length > 0) {
          data?.invalidate(spec.invalidates);
        }
        if (outcome?.navigate) follow(outcome.navigate);
        return {
          status: 'done',
          ...(outcome?.message === undefined ? {} : { message: outcome.message }),
        };
      } catch (error) {
        report(error);
        return {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    confirm(id, phrase) {
      if (!waiting || waiting.entry.id !== id) return false;
      const expected = waiting.entry.phrase;
      if (expected !== undefined && (phrase === undefined || !sameWords(phrase, expected))) {
        return false;
      }
      const { resolve } = waiting;
      waiting = undefined;
      changed();
      resolve(true);
      return true;
    },

    cancel(id) {
      if (!waiting || waiting.entry.id !== id) return;
      const { resolve } = waiting;
      waiting = undefined;
      changed();
      resolve(false);
    },

    confirmations() {
      confirmers++;
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        confirmers--;
        // With no interface left to answer, a waiting run can only be declined.
        if (confirmers === 0 && waiting) client.cancel(waiting.entry.id);
      };
    },

    setLocation(path) {
      const own = /^\/apt\/([^/?#]+)/.exec(path);
      const matched = matchRoute(contract, path);
      const route = matched ? contract.routes[matched.route] : undefined;
      const key = route?.entity === undefined ? undefined : matched?.params[route.key ?? 'id'];
      let userPage: string | undefined;
      try {
        userPage = own?.[1] === undefined ? undefined : decodeURIComponent(own[1]);
      } catch {
        userPage = undefined;
      }
      const next: Location = {
        path,
        params: matched?.params ?? {},
        ...(matched ? { route: matched.route } : {}),
        ...(route?.entity !== undefined && key !== undefined
          ? { entity: { source: route.entity, key } }
          : {}),
        ...(userPage === undefined ? {} : { userPage }),
      };
      const moved =
        location?.route !== next.route ||
        location?.userPage !== next.userPage ||
        stableStringify(location?.params ?? {}) !== stableStringify(next.params);
      location = next;
      // A param named like a context sets it, such as :service on a service's page.
      let contextsChanged = false;
      for (const [name, value] of Object.entries(next.params)) {
        if (contract.contexts[name] === undefined) continue;
        const canonicalValue = contract.contextValue(name, value);
        if (canonicalValue !== undefined && contexts[name] !== canonicalValue) {
          contexts = { ...contexts, [name]: canonicalValue };
          contextsChanged = true;
        }
      }
      if (contextsChanged) noteContexts();
      if (moved && route?.action !== undefined) {
        client.record(route.action as ActionIdOf<C>, { via: 'region' });
      } else {
        changed();
      }
    },

    navigate: (target) => follow(target),

    attachRouter(navigate) {
      router = navigate;
      return () => {
        if (router === navigate) router = undefined;
      };
    },

    userPages() {
      if (ownPages?.version !== state.definition.version) {
        ownPages = { version: state.definition.version, value: resolveUserPages(state.definition) };
      }
      return ownPages.value;
    },

    createPage(title, value) {
      const slug = slugFor(title);
      const adaptation = userPageChange({
        op: 'create',
        slug,
        title,
        value: toPage(value ?? ui.page(ui.section('', 'stack', []))) as AnyPage,
      });
      return { slug, adaptation };
    },
    renamePage: (slug, title) => userPageChange({ op: 'rename', slug, title }),
    setUserPage: (slug, value) =>
      userPageChange({ op: 'set', slug, value: toPage(value) as AnyPage }),
    deletePage: (slug) => userPageChange({ op: 'delete', slug }),

    setContext(name, value) {
      const canonicalValue = value === undefined ? undefined : contract.contextValue(name, value);
      if (value !== undefined && canonicalValue === undefined) {
        report(new Error(`Unknown ${name} "${value}"`));
        return;
      }
      if (contexts[name] === canonicalValue) return;
      const next = { ...contexts };
      if (canonicalValue === undefined) delete next[name];
      else next[name] = canonicalValue;
      contexts = next;
      noteContexts();
      changed();
    },

    resume() {
      if (now() - state.lastActivityAt <= idle) return undefined;
      startSession();
      const adaptation = safeMoment();
      changed();
      return adaptation;
    },

    nextSession() {
      startSession();
      const adaptation = safeMoment();
      changed();
      return adaptation;
    },

    apply() {
      const adaptation = safeMoment();
      changed();
      return adaptation;
    },

    async plan() {
      const planRequest = request('plan');
      const result = await callPlanner(planner, planRequest);
      const operations = result.operations.map((proposed) =>
        toOperation(proposed, result.origin === 'model' ? 'model' : 'heuristic'),
      );
      const current = summary();
      const { accepted, rejected } = check(operations, {
        contract,
        definition: state.definition,
        summary: current,
        session: state.session,
      });
      const id = nextId('a');
      let definition = state.definition;
      const applied: string[] = [];
      const structural: Operation[] = [];
      for (const operation of accepted) {
        const kind = operation.change.kind;
        if (kind !== 'collection' && kind !== 'page') {
          structural.push(operation);
          continue;
        }
        // Suggested items appear at once for the user to accept, or join the interface when they
        // let it act on its own; a planned redesign is only ever a suggestion to preview, whatever
        // the autonomy: radical change waits for the user's yes.
        definition = applyOperation(
          definition,
          operation,
          { contract, summary: current, session: state.session, adaptation: id },
          kind === 'collection' && state.autonomy === 'auto' ? 'active' : 'suggested',
        );
        applied.push(operation.id);
      }
      const strengths = structural.map((operation) =>
        strength(operation, contract, definition, current, tuning),
      );
      const staged = stage(structural, state.seen, strengths, {
        ...tuning,
        hysteresis: state.autonomy !== 'auto',
      });
      state = { ...state, definition, pending: staged.pending, seen: staged.seen };
      const adaptation = remember({
        id,
        kind: 'plan',
        session: state.session,
        applied,
        rejected,
        pending: staged.pending.length,
        meta: result.meta,
      });
      changed();
      return adaptation;
    },

    async learn() {
      if (options.learn === false || state.definition.frozen || state.planned === state.session) {
        return undefined;
      }
      // Marked before planning starts, so a second call meanwhile, such as from React's
      // development double effects, doesn't plan twice: two plans would pass for agreement.
      state = { ...state, planned: state.session };
      return client.plan();
    },

    async ask(text, askOptions = {}) {
      const words = text.trim().slice(0, MAX_COMMAND);
      if (askOptions.goal) {
        state = {
          ...state,
          definition: { ...state.definition, goal: words, version: state.definition.version + 1 },
        };
      }
      const planRequest = request('command', words);
      const started = Date.now();
      const keyword = askOptions.goal ? undefined : keywordCommand(planRequest, contract);
      const result: PlanResult = keyword
        ? {
            origin: 'heuristic',
            ...keyword,
            meta: { planner: 'keywords', ms: Date.now() - started },
          }
        : await callPlanner(planner, planRequest);
      const operations = result.operations.map((proposed) =>
        toOperation(
          proposed,
          proposed.scope === 'explicit'
            ? 'user'
            : result.origin === 'model'
              ? 'model'
              : 'heuristic',
          words,
        ),
      );
      const adaptation = applyNow(
        operations,
        'command',
        {
          text: words,
          meta: result.meta,
          ...(result.candidates === undefined ? {} : { candidates: result.candidates }),
        },
        words,
      );
      const answered = status(result, adaptation.applied.length, adaptation.rejected);
      // The model planner was unreachable and the local one couldn't help: say so plainly.
      const final = {
        ...adaptation,
        status:
          result.meta.fellBack !== undefined && answered === 'unsupported'
            ? 'unavailable'
            : answered,
      } satisfies Adaptation;
      state = { ...state, adaptations: [...state.adaptations.slice(0, -1), final] };
      changed();
      return final;
    },

    pin: (surface, action, context) => userChange(listChange(surface, 'pin', action, context)),
    unpin: (surface, action, context) => userChange(listChange(surface, 'unpin', action, context)),
    hide: (surface, action, context) => userChange(listChange(surface, 'hide', action, context)),
    restore: (surface, action, context) =>
      userChange(listChange(surface, 'restore', action, context)),
    move: (surface, action, index, context) =>
      userChange({ ...listChange(surface, 'move', action, context), index }),
    set: (surface, value) => userChange({ kind: 'choice', surface, op: 'set', value }),

    setPage: (surface, value, context) =>
      userChange({
        kind: 'page',
        surface,
        op: 'set',
        value: toPage(value) as AnyPage,
        ...pageContext(surface, context),
      }),
    resetPage: (surface, context) =>
      userChange({ kind: 'page', surface, op: 'reset', ...pageContext(surface, context) }),

    preview(operation) {
      preview = operation;
      changed();
    },

    addItem(surface, value) {
      const item = hash(value);
      const spec = contract.surfaces[surface] as CollectionSpec | undefined;
      if (spec?.kind === 'collection') {
        const current = resolveCollection(contract, state.definition, surface);
        if (current.items.length >= spec.max) {
          return applyNow([], 'user', {
            rejected: [
              {
                operation: toOperation(
                  { change: { kind: 'collection', surface, op: 'add', item, value }, evidence: [] },
                  'user',
                ),
                rule: 'capacity',
                message: `${spec.label} holds at most ${spec.max}`,
              },
            ],
          });
        }
      }
      return userChange({ kind: 'collection', surface, op: 'add', item, value });
    },
    updateItem: (surface, item, value) =>
      userChange({ kind: 'collection', surface, op: 'update', item, value }),
    removeItem: (surface, item) => userChange({ kind: 'collection', surface, op: 'remove', item }),

    revert(operation) {
      state = {
        ...state,
        definition: revertOperation(state.definition, operation, state.session, tuning),
      };
      changed();
    },

    revertAdaptation(adaptation) {
      let definition = state.definition;
      for (const operation of [...definition.operations].reverse()) {
        if (operation.adaptation === adaptation) {
          definition = revertOperation(definition, operation.id, state.session, tuning);
        }
      }
      state = { ...state, definition };
      changed();
    },

    keep(operation) {
      state = { ...state, definition: setStatus(state.definition, operation, 'kept', ['active']) };
      changed();
    },

    accept(operation) {
      const waiting = state.pending.find((entry) => entry.id === operation);
      if (waiting) {
        state = { ...state, pending: state.pending.filter((entry) => entry.id !== operation) };
        return applyNow([waiting], 'user').applied.length > 0;
      }
      const suggested = state.definition.operations.find(
        (entry) => entry.id === operation && entry.status === 'suggested',
      );
      if (suggested?.change.kind === 'page') {
        if (preview === operation) preview = undefined;
        // Saying yes to a redesign makes it the user's own.
        state = {
          ...state,
          definition: setStatus(state.definition, operation, 'kept', ['suggested']),
        };
        changed();
        return true;
      }
      if (!suggested || suggested.change.kind !== 'collection') return false;
      const spec = contract.surfaces[suggested.change.surface] as CollectionSpec;
      if (
        resolveCollection(contract, state.definition, suggested.change.surface).items.length >=
        spec.max
      ) {
        return false;
      }
      state = {
        ...state,
        definition: setStatus(state.definition, operation, 'active', ['suggested']),
      };
      changed();
      return true;
    },

    dismiss(operation) {
      const waiting = state.pending.find((entry) => entry.id === operation);
      const suggested = state.definition.operations.find(
        (entry) => entry.id === operation && entry.status === 'suggested',
      );
      const change = waiting?.change ?? suggested?.change;
      if (!change) return;
      if (preview === operation) preview = undefined;
      const key = operationKey(change);
      state = {
        ...state,
        pending: state.pending.filter((entry) => entry.id !== operation),
        definition: {
          ...setStatus(state.definition, operation, 'dismissed', ['suggested']),
          cooldowns: [
            ...state.definition.cooldowns.filter((entry) => entry.key !== key),
            { key, until: state.session + tuning.cooldown },
          ],
        },
      };
      changed();
    },

    freeze(frozen) {
      state = {
        ...state,
        definition: { ...state.definition, frozen, version: state.definition.version + 1 },
        pending: frozen ? [] : state.pending,
      };
      changed();
    },

    setGoal(goal) {
      const { goal: _previous, ...rest } = state.definition;
      state = {
        ...state,
        definition: { ...rest, ...(goal === undefined ? {} : { goal }), version: rest.version + 1 },
      };
      changed();
    },

    setView(view) {
      state = { ...state, view };
      changed();
    },

    setAutonomy(autonomy) {
      state = { ...state, autonomy };
      changed();
    },

    reset() {
      state = {
        ...state,
        definition: { ...emptyDefinition(contract), version: state.definition.version + 1 },
        pending: [],
        seen: {},
      };
      remember({
        id: nextId('a'),
        kind: 'reset',
        session: state.session,
        applied: [],
        rejected: [],
        pending: 0,
      });
      changed();
    },

    clearData() {
      store.clear();
      state = fresh();
      usage++;
      changed();
    },

    export: () => ({
      format: 'aptuitive.definition',
      version: 1,
      contract: { id: contract.id, hash: contract.hash },
      definition: state.definition,
    }),

    import(document) {
      const id = nextId('a');
      if (!isDocument(document) || document.contract.id !== contract.id) {
        return applyNow([], 'import', {
          rejected: [],
          status: 'not_allowed',
          text: `Not a definition for ${contract.id}`,
        });
      }
      const rejected: Rejection[] = [];
      const operations: AppliedOperation[] = [];
      const incoming = migrateDefinition(document.definition);
      for (const operation of incoming.operations) {
        try {
          operations.push({
            ...operation,
            change: canonical(operation.change, contract),
            adaptation: id,
          });
        } catch (error) {
          rejected.push({
            operation,
            rule: 'unknown',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      state = {
        ...state,
        pending: [],
        seen: {},
        definition: {
          ...incoming,
          contract: contract.hash,
          version: state.definition.version + 1,
          operations,
        },
      };
      const adaptation = remember({
        id,
        kind: 'import',
        session: state.session,
        applied: operations.filter(isApplied).map((operation) => operation.id),
        rejected,
        pending: 0,
      });
      changed();
      return adaptation;
    },

    explain(operation) {
      const found =
        typeof operation === 'string'
          ? (state.definition.operations.find((entry) => entry.id === operation) ??
            state.pending.find((entry) => entry.id === operation))
          : operation;
      return found ? describe(found, contract) : undefined;
    },

    request,
    summary,
    flush,
  };
  return client;

  function pageContext(surface: string, context?: string): { context?: string } {
    const spec = contract.surfaces[surface];
    if (spec?.kind !== 'page' || spec.context === undefined) return {};
    const value = context ?? contexts[spec.context] ?? EVERY;
    return { context: value };
  }

  function listChange(
    surface: string,
    op: ListChange['op'],
    target: string,
    context?: string,
  ): ListChange {
    const spec = contract.surfaces[surface] as ListSpec | undefined;
    const value = context ?? (spec?.context === undefined ? undefined : contexts[spec.context]);
    return {
      kind: 'list',
      surface,
      op,
      target,
      ...(value === undefined ? {} : { context: value }),
    };
  }
}

function isState(value: unknown): value is Omit<State, 'schemaVersion'> & { schemaVersion: 1 | 2 } {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<Omit<State, 'schemaVersion'> & { schemaVersion: number }>;
  return (
    (candidate.schemaVersion === 1 || candidate.schemaVersion === 2) &&
    typeof candidate.contract === 'string' &&
    typeof candidate.session === 'number' &&
    Array.isArray(candidate.events) &&
    Array.isArray(candidate.sessions) &&
    Array.isArray(candidate.pending) &&
    Array.isArray(candidate.adaptations) &&
    typeof candidate.definition === 'object' &&
    candidate.definition !== null &&
    Array.isArray(candidate.definition.operations)
  );
}

function isDocument(value: unknown): value is DefinitionDocument {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<DefinitionDocument>;
  return (
    candidate.format === 'aptuitive.definition' &&
    candidate.version === 1 &&
    typeof candidate.contract?.id === 'string' &&
    Array.isArray(candidate.definition?.operations)
  );
}
