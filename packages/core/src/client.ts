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
  compact,
  emptyDefinition,
  isApplied,
  layerOf,
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
  type Change,
  type Definition,
  type Evidence,
  type ListChange,
  type Operation,
  type Origin,
} from './definition.js';
import { describe, type Explanation } from './explain.js';
import { toPage, ui, type SectionsPage } from './page.js';
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
import { canonicalKey, check, checkStored, type Rejection } from './policy.js';
import {
  cleanGoal,
  isCount,
  isRecord,
  isText,
  reviveDefinition,
  reviveEvents,
  reviveOperation,
  reviveSessions,
} from './revive.js';
import {
  applyOperation,
  DEFAULT_STABILIZER,
  revert as revertOperation,
  setStatus,
  settle,
  stage,
  strength,
  type Agreement,
  type Pending,
  type StabilizerOptions,
} from './stabilizer.js';
import { memoryStore, type Store } from './storage.js';
import {
  rank,
  summarize,
  type SessionRecord,
  type UsageEvent,
  type UsageSummary,
  type Via,
} from './usage.js';

/**
 * How far the system may act on its own. `suggest`: planned changes wait for the person's yes.
 * `mixed`: planned changes apply at a safe moment, a model's once a plan in a later session agrees
 * or it clears the margin. `auto`: planned changes apply at the next safe moment, and suggested
 * items join the interface at once. In every mode a redesign stays a suggestion until the person
 * accepts it.
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
  /** One of the user's own pages, at `/uitive/<slug>`. */
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
  format: 'uitive.definition';
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
   * The surface it was used from, such as `toolbar`, so learning knows which list it belongs to:
   * the use then counts toward that surface alone. Without one, it counts toward every list
   * holding the action.
   */
  surface?: string;
  /** The page element it came from. */
  element?: string;
  /** For palette picks: whether the user typed a search first. */
  typed?: boolean;
}

/**
 * What `createUitive` takes: the contract, and where state lives, who plans and the
 * application's code behind the contract.
 */
export interface UitiveOptions<C extends AnyContract> {
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
  stabilizer?: Partial<StabilizerOptions>;
  /** The application's code behind the contract: reading sources, running actions, routing. */
  bindings?: Bindings<C>;
  /**
   * Called when storage or a planner fails, including a remote planner whose fallback answered
   * instead, and when another tab runs a different version of the application; the interface
   * keeps working.
   */
  onError?: (error: unknown) => void;
  /**
   * For pages Uitive adapts from outside, such as in a browser extension: what the page
   * offers now, sent with each request. Structure only, never the page's text.
   */
  environment?: () => Environment | undefined;
}

/**
 * A client: one person's adapting interface. It records use, answers requests, applies what policy
 * allows at safe moments, runs actions through the bindings, and keeps the person's definition in
 * its store.
 */
export interface Uitive<C extends AnyContract = AnyContract> {
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
  /** Makes a page of the user's own; it lives at `/uitive/<slug>`. */
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
   * safe moment, and redesigns stay suggestions. Calls while a plan is on its way share it.
   */
  plan(): Promise<Adaptation>;
  /**
   * Plans from use once a session; the provider and `startUitive` call it whenever one starts.
   * Does nothing when this session was planned already, when the interface is frozen, or when the
   * client was created with `learn: false`.
   */
  learn(): Promise<Adaptation | undefined>;
  /**
   * A request in the user's own words, answered at once. With `goal`, the words are kept as their
   * stated goal; blank words clear it.
   */
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
  /**
   * Shows a suggested redesign in place without applying it; nothing to stop previewing. Only a
   * redesign still suggested can be previewed, and the preview ends when it no longer is.
   */
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
  /** Accepts a pending change or a suggested item; either joins the user's own layer. */
  accept(operation: string): boolean;
  /** Declines a pending change or a suggested item; it cools down. */
  dismiss(operation: string): void;
  /** Stops or resumes planned changes; the person's own still apply. */
  freeze(frozen: boolean): void;
  /**
   * Keeps or clears the person's stated goal, such as "I watch costs", which planners read. It is
   * trimmed and kept to 500 characters; a blank one clears it.
   */
  setGoal(goal: string | undefined): void;
  /** Shows the person's interface, or the application as shipped. */
  setView(view: View): void;
  /** Sets how far the system may act on its own. */
  setAutonomy(autonomy: Autonomy): void;
  /**
   * Puts the layout back to standard. Usage is kept, and so are freeze, blocked changes,
   * cooldowns and the stated goal.
   */
  reset(): void;
  /** Forgets everything: usage, definition and history. */
  clearData(): void;
  /** The person's definition, portable, for a file or another device. */
  export(): DefinitionDocument;
  /**
   * Takes a definition from `export`, checked against this contract like any change: what breaks
   * the contract's rules is skipped with its reason, and a file that isn't a definition is refused.
   */
  import(document: unknown): Adaptation;
  /** Why a change was made, in plain words, with its evidence. */
  explain(operation: string | Operation): Explanation | undefined;
  /** Exactly what a planner would receive: all that leaves the device. */
  request(kind: 'plan' | 'command', text?: string): PlanRequest;
  /** Usage summarized per action and surface, as planners see it. */
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
  /** The first session whose events are all kept: older ones made room for newer. */
  eventsFrom: number;
  definition: Definition;
  pending: Pending[];
  seen: Record<string, Agreement>;
  adaptations: Adaptation[];
  view: View;
  autonomy: Autonomy;
  counter: number;
  /** The session `learn` last planned. */
  planned?: number;
  /** Changes when the person resets, imports or forgets everything: plans made before don't fit. */
  epoch: number;
}

const MAX_EVENTS = 2000;
const MAX_SESSIONS = 30;
const MAX_ADAPTATIONS = 50;
const MAX_COMMAND = 500;
/** Operations an imported file may hold. */
const MAX_IMPORTED = 5000;
const AUTONOMIES: readonly Autonomy[] = ['suggest', 'mixed', 'auto'];
const KINDS: readonly Adaptation['kind'][] = [
  'plan',
  'apply',
  'command',
  'user',
  'import',
  'reset',
];
const STATUSES: readonly CommandStatus[] = [
  'done',
  'partial',
  'not_allowed',
  'ambiguous',
  'unsupported',
  'unavailable',
];
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
export function createUitive<C extends AnyContract>(options: UitiveOptions<C>): Uitive<C> {
  const { contract } = options;
  const store = options.store ?? memoryStore();
  const planner = options.planner ?? heuristicPlanner();
  const local = heuristicPlanner();
  const now = options.now ?? Date.now;
  const idle = (options.idleMinutes ?? 30) * 60_000;
  const tuning: StabilizerOptions = { ...DEFAULT_STABILIZER, ...options.stabilizer };
  const report = (error: unknown) => options.onError?.(error);

  const fresh = (): State => ({
    schemaVersion: 2,
    contract: contract.hash,
    session: 0,
    lastActivityAt: now(),
    sessions: [{ index: 0, startedAt: now(), contexts: {} }],
    events: [],
    eventsFrom: 0,
    definition: emptyDefinition(contract),
    pending: [],
    seen: {},
    adaptations: [],
    view: 'yours',
    autonomy: options.autonomy ?? 'mixed',
    counter: 0,
    epoch: 0,
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
  // Another tab runs a different version of the application: its state is neither adopted nor
  // overwritten, so the newer version's survives.
  let stale = false;
  let inFlight: { epoch: number; session: number; promise: Promise<Adaptation> } | undefined;
  let compacted: { definition: Definition; session: number } | undefined;
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
  let summaryCache: { inputs: readonly unknown[]; value: UsageSummary } | undefined;
  let snapshot = makeSnapshot();

  function load(): State {
    let raw: unknown;
    try {
      raw = store.load();
    } catch (error) {
      report(error);
    }
    return adopt(raw) ?? fresh();
  }

  /** Stored state, well formed and brought to this contract; nothing when there is none. */
  function adopt(raw: unknown): State | undefined {
    let stored: State | undefined;
    try {
      stored = reviveState(raw, {
        now: now(),
        autonomy: options.autonomy ?? 'mixed',
        cooldown: tuning.cooldown,
      });
    } catch (error) {
      report(error);
      return undefined;
    }
    if (stored === undefined || stored.contract === contract.hash) return stored;
    // The contract changed: keep what still means something, drop the rest. Items that no
    // longer fit their schema, and pages built from blocks the application no longer has, are
    // dropped, not drawn half broken.
    const { accepted } = checkStored(stored.definition.operations, contract);
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
      definition: {
        ...stored.definition,
        contract: contract.hash,
        operations: accepted,
        ...rekeyed(stored.definition),
      },
    };
  }

  /** Cooldowns and blocks in this contract's spelling; keys that name nothing here are dropped. */
  function rekeyed(definition: Definition): Pick<Definition, 'cooldowns' | 'blocked'> {
    const until = new Map<string, number>();
    for (const entry of definition.cooldowns) {
      const key = canonicalKey(entry.key, contract);
      if (key !== undefined) until.set(key, Math.max(until.get(key) ?? 0, entry.until));
    }
    const blocked = definition.blocked.flatMap((key) => canonicalKey(key, contract) ?? []);
    return {
      cooldowns: [...until].map(([key, session]) => ({ key, until: session })),
      blocked: [...new Set(blocked)],
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

  /** Whether an operation is a redesign still waiting for the person's yes, as previews show. */
  function previewable(operation: string): boolean {
    return state.definition.operations.some(
      (entry) =>
        entry.id === operation && entry.status === 'suggested' && entry.change.kind === 'page',
    );
  }

  /** Keeps derived state true to the definition before anyone reads it. */
  function tidy() {
    // A preview outlives nothing: once its suggestion is gone, writes must not stay refused.
    if (preview !== undefined && !previewable(preview)) preview = undefined;
    if (compacted?.definition !== state.definition || compacted.session !== state.session) {
      const definition = compact(state.definition, state.session);
      if (definition !== state.definition) state = { ...state, definition };
      compacted = { definition, session: state.session };
    }
    snapshot = makeSnapshot();
  }

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  function changed() {
    tidy();
    persist();
    notify();
  }

  function persist() {
    if (scheduled) return;
    scheduled = true;
    void Promise.resolve().then(flush);
  }

  function flush() {
    scheduled = false;
    if (stale) return;
    try {
      store.save(state);
    } catch (error) {
      report(error);
      if (!shrink()) return;
      try {
        store.save(state);
      } catch (again) {
        report(again);
      }
    }
  }

  /**
   * Most likely out of quota: keeps the newest half of the usage, but only when usage is most of
   * what is stored, or halving would drain it without making room. Says whether it did.
   */
  function shrink(): boolean {
    const size = (value: unknown) => JSON.stringify(value).length;
    if (state.events.length < 2 || size(state.events) * 2 < size(state)) return false;
    keepEvents(state.events, Math.floor(state.events.length / 2));
    return true;
  }

  /** Keeps the newest `limit` events, noting from which session on the kept ones are complete. */
  function keepEvents(events: readonly UsageEvent[], limit: number) {
    const dropped = events.length - limit;
    if (dropped <= 0) {
      state = { ...state, events: [...events] };
      return;
    }
    const last = events[dropped - 1] as UsageEvent;
    state = {
      ...state,
      events: events.slice(dropped),
      eventsFrom: Math.max(state.eventsFrom, last.session + 1),
    };
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
    let added = false;
    for (const [name, value] of Object.entries(contexts)) {
      const values = merged[name] ?? [];
      if (values.includes(value)) continue;
      merged[name] = [...values, value];
      added = true;
    }
    if (!added) return;
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
    // Every input by identity: state changes by replacement, so a new context counts at once.
    const inputs = [
      state.events,
      state.sessions,
      state.definition,
      state.session,
      state.eventsFrom,
    ];
    if (summaryCache?.inputs.every((input, index) => input === inputs[index]) !== true) {
      summaryCache = {
        inputs,
        value: summarize(
          contract,
          state.definition,
          state.events,
          state.sessions,
          state.session,
          state.eventsFrom,
        ),
      };
    }
    return summaryCache.value;
  }

  /** An adaptation for a planner's answer that came too late to apply, kept out of history. */
  function discarded(
    kind: 'plan' | 'command',
    meta: PlanMeta,
    extra: Partial<Adaptation> = {},
  ): Adaptation {
    return {
      id: nextId('a'),
      kind,
      session: state.session,
      applied: [],
      rejected: [],
      pending: state.pending.length,
      meta,
      ...extra,
    };
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

  /**
   * Applies operations immediately: a user acting, or a command they gave. `interpreted` says a
   * model read the command's words.
   */
  function applyNow(
    operations: readonly Operation[],
    kind: Adaptation['kind'],
    extra: Partial<Adaptation> = {},
    intent?: string,
    interpreted = false,
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
        interpreted,
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
      const result = await chosen.plan(planRequest, contract);
      // A remote planner's fallback answered: the failure would otherwise stay in `meta` alone.
      if (result.meta.fellBack !== undefined) report(new Error(result.meta.fellBack));
      return result;
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

  async function planNow(): Promise<Adaptation> {
    const epoch = state.epoch;
    const planRequest = request('plan');
    const result = await callPlanner(planner, planRequest);
    // The person reset, imported or forgot everything while the plan came: it fits what is gone.
    if (state.epoch !== epoch) return discarded('plan', result.meta);
    const operations = result.operations.map((proposed) =>
      toOperation(proposed, result.origin === 'model' ? 'model' : 'heuristic'),
    );
    const current = summary();
    const id = nextId('a');
    let definition = state.definition;
    const applied: string[] = [];
    const rejected: Rejection[] = [];
    const structural: Operation[] = [];
    for (const operation of operations) {
      // Each against the definition the ones before it left, so a collection's cap holds.
      const checked = check([operation], {
        contract,
        definition,
        summary: current,
        session: state.session,
      });
      rejected.push(...checked.rejected);
      const accepted = checked.accepted[0];
      if (accepted === undefined) continue;
      const kind = accepted.change.kind;
      if (kind !== 'collection' && kind !== 'page') {
        structural.push(accepted);
        continue;
      }
      // Suggested items appear at once for the user to accept, or join the interface when they
      // let it act on its own; a planned redesign is only ever a suggestion to preview, whatever
      // the autonomy: radical change waits for the user's yes.
      definition = applyOperation(
        definition,
        accepted,
        { contract, summary: current, session: state.session, adaptation: id },
        kind === 'collection' && state.autonomy === 'auto' ? 'active' : 'suggested',
      );
      applied.push(accepted.id);
    }
    const strengths = structural.map((operation) =>
      strength(operation, contract, definition, current, tuning),
    );
    const staged = stage(structural, state.seen, strengths, {
      ...tuning,
      hysteresis: state.autonomy !== 'auto',
      session: state.session,
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
  }

  /** Resolves a surface for a view, memoized until the definition or session changes. */
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
    let raw: unknown;
    try {
      raw = store.load();
    } catch (error) {
      report(error);
      return;
    }
    // Another version of the application wrote it, as across a deploy: converting it to this
    // contract and writing it back would lose what the other version keeps.
    if (isRecord(raw) && typeof raw.contract === 'string' && raw.contract !== contract.hash) {
      if (!stale) {
        report(
          new Error(`Another tab runs a different version of ${contract.id}; reload this one`),
        );
      }
      stale = true;
      return;
    }
    stale = false;
    state = adopt(raw) ?? fresh();
    summaryCache = undefined;
    ranking = undefined;
    cacheKey = '';
    usage++;
    tidy();
    notify();
  });

  // Page start is a safe moment only when a new session starts, before anything is drawn. A page
  // opened mid-session, such as a second tab, would move the interface under the tab in use,
  // which adopts what it saves.
  if (now() - state.lastActivityAt > idle) {
    startSession();
    safeMoment();
  }
  tidy();

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

  const client: Uitive<C> = {
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
      // A surface the contract doesn't declare, or none, says nothing about where use belongs.
      const surface =
        recordOptions.surface === undefined ? undefined : contract.surface(recordOptions.surface);
      const event: UsageEvent = {
        action: id,
        via: recordOptions.via ?? 'region',
        session: state.session,
        ...(surface === undefined ? {} : { surface }),
        ...(recordOptions.element === undefined ? {} : { element: recordOptions.element }),
        ...(Object.keys(contexts).length === 0 ? {} : { contexts: { ...contexts } }),
        ...(recordOptions.typed === undefined ? {} : { typed: recordOptions.typed }),
      };
      state = { ...state, lastActivityAt: now() };
      keepEvents([...state.events, event], MAX_EVENTS);
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
      const previewing = () => changes && preview !== undefined && previewable(preview);
      const held: PerformResult = {
        status: 'refused',
        message: 'Changes wait until you accept or dismiss the preview',
      };
      if (previewing()) return held;
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
        if (!yes) return { status: 'canceled' };
        // A preview started while the run waited holds it back as well.
        if (previewing()) return held;
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
      const own = /^\/uitive\/([^/?#]+)/.exec(path);
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

    plan() {
      // Calls meanwhile in the same session share the plan on its way: two answers to one
      // request are no agreement.
      if (inFlight?.epoch === state.epoch && inFlight.session === state.session) {
        return inFlight.promise;
      }
      const entry = { epoch: state.epoch, session: state.session, promise: planNow() };
      inFlight = entry;
      const done = () => {
        if (inFlight === entry) inFlight = undefined;
      };
      entry.promise.then(done, done);
      return entry.promise;
    },

    async learn() {
      if (options.learn === false || state.definition.frozen || state.planned === state.session) {
        return undefined;
      }
      // Marked before planning starts, so a second call meanwhile, such as from React's
      // development double effects, doesn't plan twice.
      state = { ...state, planned: state.session };
      return client.plan();
    },

    async ask(text, askOptions = {}) {
      const words = text.trim().slice(0, MAX_COMMAND);
      if (askOptions.goal) state = { ...state, definition: withGoal(state.definition, words) };
      if (words === '') {
        // Nothing to answer, and nothing for a planner: a blank goal only clears the one kept.
        return applyNow([], 'command', {
          text: '',
          status: askOptions.goal ? 'done' : 'unsupported',
        });
      }
      const epoch = state.epoch;
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
      // What a model says the person named outright joins their own layer, within what policy
      // holds for everyone; what it adds for their goal joins the model's. Both apply at once.
      const interpreted = result.origin === 'model';
      const operations = result.operations.map((proposed) =>
        toOperation(
          proposed,
          proposed.scope === 'explicit' ? 'user' : interpreted ? 'model' : 'heuristic',
          words,
        ),
      );
      // The person reset, imported or forgot everything while the answer came: it fits what is
      // gone.
      if (state.epoch !== epoch) {
        return discarded('command', result.meta, {
          text: words,
          status: 'not_allowed',
          rejected: operations.map((operation) => ({
            operation,
            rule: 'precedence' as const,
            message: 'Your interface changed while this was answered; ask again',
          })),
        });
      }
      const adaptation = applyNow(
        operations,
        'command',
        {
          text: words,
          meta: result.meta,
          ...(result.candidates === undefined ? {} : { candidates: result.candidates }),
        },
        words,
        interpreted,
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
      preview = operation !== undefined && previewable(operation) ? operation : undefined;
      changed();
    },

    addItem: (surface, value) =>
      userChange({ kind: 'collection', surface, op: 'add', item: hash(value), value }),
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
        if (applyNow([waiting], 'user').applied.length === 0) return false;
        // Saying yes makes a change the user's own, as with a redesign or an item.
        state = {
          ...state,
          definition: setStatus(state.definition, operation, 'kept', ['active']),
        };
        changed();
        return true;
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
        definition: setStatus(state.definition, operation, 'kept', ['suggested']),
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
      state = { ...state, definition: withGoal(state.definition, goal) };
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
      // The layout goes back to standard; what the person decided about planners stays theirs.
      const { frozen, blocked, cooldowns, goal, version } = state.definition;
      state = {
        ...state,
        epoch: state.epoch + 1,
        definition: {
          ...emptyDefinition(contract),
          version: version + 1,
          frozen,
          blocked,
          cooldowns,
          ...(goal === undefined ? {} : { goal }),
        },
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
      stale = false;
      state = { ...fresh(), epoch: state.epoch + 1 };
      usage++;
      changed();
    },

    export: () => ({
      format: 'uitive.definition',
      version: 1,
      contract: { id: contract.id, hash: contract.hash },
      definition: state.definition,
    }),

    import(document) {
      const refuse = () =>
        applyNow([], 'import', {
          rejected: [],
          status: 'not_allowed',
          text: `Not a definition for ${contract.id}`,
        });
      if (!isDocument(document) || document.contract.id !== contract.id) return refuse();
      if (document.definition.operations.length > MAX_IMPORTED) return refuse();
      let revived: ReturnType<typeof reviveDefinition>;
      try {
        revived = reviveDefinition(document.definition, {
          session: state.session,
          cooldown: tuning.cooldown,
        });
      } catch (error) {
        report(error);
        return refuse();
      }
      // A file with entries that aren't changes at all was never an export.
      if (revived === undefined || revived.malformed > 0) return refuse();
      const incoming = revived.definition;
      const id = nextId('a');
      // Imported changes apply now, in this session's count: another device counts its own.
      const { accepted, rejected } = checkStored(
        incoming.operations.map((operation) => ({
          ...operation,
          session: state.session,
          adaptation: id,
          basedOn: {
            ...operation.basedOn,
            session: Math.min(operation.basedOn.session, state.session),
          },
        })),
        contract,
      );
      state = {
        ...state,
        epoch: state.epoch + 1,
        // IDs made from here on never repeat an imported one.
        counter: Math.max(state.counter, highestCounter(accepted.map((operation) => operation.id))),
        pending: [],
        seen: {},
        definition: {
          schemaVersion: 2,
          contract: contract.hash,
          version: state.definition.version + 1,
          operations: accepted,
          ...rekeyed(incoming),
          frozen: incoming.frozen,
          ...(incoming.goal === undefined ? {} : { goal: incoming.goal }),
        },
      };
      const adaptation = remember({
        id,
        kind: 'import',
        session: state.session,
        applied: accepted.filter(isApplied).map((operation) => operation.id),
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

/** Stored state, each field well formed; nothing when it isn't state at all. */
function reviveState(
  raw: unknown,
  defaults: { now: number; autonomy: Autonomy; cooldown: number },
): State | undefined {
  if (!isRecord(raw) || (raw.schemaVersion !== 1 && raw.schemaVersion !== 2)) return undefined;
  if (!isText(raw.contract, 200) || !isCount(raw.session)) return undefined;
  const session = raw.session;
  const revived = reviveDefinition(raw.definition, { session, cooldown: defaults.cooldown });
  if (revived === undefined) return undefined;
  const sessions = reviveSessions(raw.sessions);
  if (sessions[sessions.length - 1]?.index !== session) {
    sessions.push({ index: session, startedAt: defaults.now, contexts: {} });
  }
  const pending = (Array.isArray(raw.pending) ? raw.pending : []).flatMap((entry: unknown) => {
    const operation = reviveOperation(entry);
    if (operation === undefined || !isRecord(entry)) return [];
    const power = typeof entry.strength === 'number' && Number.isFinite(entry.strength);
    return [
      {
        ...operation,
        key: operationKey(operation.change),
        strength: power ? (entry.strength as number) : 0,
        held: entry.held === true,
      },
    ];
  });
  const adaptations = (Array.isArray(raw.adaptations) ? raw.adaptations : []).flatMap(
    (entry: unknown) => {
      const adaptation = reviveAdaptation(entry);
      return adaptation === undefined ? [] : [adaptation];
    },
  );
  const definition = revived.definition;
  const autonomy = AUTONOMIES.find((entry) => entry === raw.autonomy) ?? defaults.autonomy;
  return {
    schemaVersion: 2,
    contract: raw.contract,
    session,
    lastActivityAt:
      typeof raw.lastActivityAt === 'number' && Number.isFinite(raw.lastActivityAt)
        ? raw.lastActivityAt
        : defaults.now,
    sessions: sessions.slice(-MAX_SESSIONS),
    events: reviveEvents(raw.events).slice(-MAX_EVENTS),
    eventsFrom: isCount(raw.eventsFrom) ? raw.eventsFrom : 0,
    definition,
    pending,
    seen: reviveSeen(raw.seen),
    adaptations: adaptations.slice(-MAX_ADAPTATIONS),
    view: raw.view === 'standard' ? 'standard' : 'yours',
    autonomy,
    counter: isCount(raw.counter)
      ? raw.counter
      : highestCounter([
          ...definition.operations.map((operation) => operation.id),
          ...pending.map((operation) => operation.id),
          ...adaptations.map((adaptation) => adaptation.id),
        ]),
    ...(isCount(raw.planned) ? { planned: raw.planned } : {}),
    epoch: isCount(raw.epoch) ? raw.epoch : 0,
  };
}

/** Agreement between plans, as stored; a bare count, kept before sessions were, is an earlier one. */
function reviveSeen(raw: unknown): Record<string, Agreement> {
  const seen: Record<string, Agreement> = {};
  if (!isRecord(raw)) return seen;
  for (const [key, value] of Object.entries(raw)) {
    if (isCount(value)) seen[key] = { count: value, session: -1 };
    else if (isRecord(value) && isCount(value.count) && Number.isInteger(value.session)) {
      seen[key] = { count: value.count, session: value.session as number };
    }
  }
  return seen;
}

/** An adaptation, as stored for banners and history; nothing when it isn't one. */
function reviveAdaptation(raw: unknown): Adaptation | undefined {
  if (!isRecord(raw) || !isText(raw.id, 200) || !isCount(raw.session)) return undefined;
  const kind = KINDS.find((entry) => entry === raw.kind);
  if (kind === undefined || !Array.isArray(raw.applied) || !Array.isArray(raw.rejected)) {
    return undefined;
  }
  const rejected = raw.rejected.flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.rule !== 'string' || typeof entry.message !== 'string') {
      return [];
    }
    const operation = reviveOperation(entry.operation);
    return operation === undefined
      ? []
      : [{ operation, rule: entry.rule as Rejection['rule'], message: entry.message }];
  });
  const status = STATUSES.find((entry) => entry === raw.status);
  const meta =
    isRecord(raw.meta) && typeof raw.meta.planner === 'string' && typeof raw.meta.ms === 'number'
      ? (raw.meta as unknown as PlanMeta)
      : undefined;
  return {
    id: raw.id,
    kind,
    session: raw.session,
    applied: raw.applied.filter((id): id is string => typeof id === 'string'),
    rejected,
    pending: isCount(raw.pending) ? raw.pending : 0,
    ...(status === undefined ? {} : { status }),
    ...(Array.isArray(raw.candidates)
      ? {
          candidates: raw.candidates.filter(
            (candidate): candidate is string => typeof candidate === 'string',
          ),
        }
      : {}),
    ...(typeof raw.text === 'string' ? { text: raw.text } : {}),
    ...(meta === undefined ? {} : { meta }),
  };
}

/** The highest counter IDs were made with, such as `a1f` or `3kq9x.1f`. */
function highestCounter(ids: readonly string[]): number {
  let highest = 0;
  for (const id of ids) {
    const suffix = id.includes('.') ? id.slice(id.lastIndexOf('.') + 1) : id.slice(1);
    const value = Number.parseInt(suffix, 36);
    if (Number.isFinite(value)) highest = Math.max(highest, value);
  }
  return highest;
}

/** A definition with the goal kept as the person may state one, or with none. */
function withGoal(definition: Definition, goal: string | undefined): Definition {
  const { goal: _previous, ...rest } = definition;
  const kept = cleanGoal(goal);
  return { ...rest, ...(kept === undefined ? {} : { goal: kept }), version: rest.version + 1 };
}

function isDocument(
  value: unknown,
): value is DefinitionDocument & { definition: { operations: unknown[] } } {
  if (!isRecord(value) || !isRecord(value.contract) || !isRecord(value.definition)) return false;
  return (
    value.format === 'uitive.definition' &&
    value.version === 1 &&
    typeof value.contract.id === 'string' &&
    Array.isArray(value.definition.operations)
  );
}
