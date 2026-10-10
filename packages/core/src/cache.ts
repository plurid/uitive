import type { AnyContract } from './contract.js';
import {
  rowMatches,
  runQuery,
  type BindingContext,
  type Fetchers,
  type QueryResult,
  type Row,
} from './data.js';
import { hash } from './hash.js';
import { NONE, type Filter, type Query } from './query.js';

/** A query's result as far as it is known. Stable between changes, so it is safe to render. */
export interface DataEntry {
  /** Whether the result is loading, ready, or failed. */
  status: 'loading' | 'ready' | 'error';
  /** The result, once there is one; kept while a fresh one loads. */
  result?: QueryResult;
  /** Why it failed, in words people read. */
  error?: string;
  /** The result is older than its sources allow, or a write changed them; a fresh one is coming. */
  stale: boolean;
}

/** What a page's queries need to know about the page: the row it is about. */
export interface DataScope {
  /** The key of the row a page is about, for `$current`. */
  current?: string;
}

/** How a data client fetches and caches. */
export interface DataOptions {
  /** The clock, in milliseconds, for freshness and relative times. @default Date.now */
  now?: () => number;
  /** Who and where the user is: `me`, time zone and locale. */
  context?: () => BindingContext;
  /** Fetches running at once. @default 4 */
  concurrency?: number;
  /** Results kept. @default 200 */
  capacity?: number;
  /** Told when a fetch fails; the result says so too, and the last good one stays shown. */
  onError?: (error: unknown) => void;
}

/**
 * Query results shared across an interface: fetched once, cached, refreshed when stale or after a
 * write to their source.
 */
export interface DataClient {
  /** The entry for a query, fetching when there is none, or when it is stale. */
  read(query: Query, scope?: DataScope): DataEntry;
  /** The entry for a query as it stands, without fetching: safe inside a render. */
  peek(query: Query, scope?: DataScope): DataEntry | undefined;
  /** The result of a query, fresh or cached. */
  load(query: Query, scope?: DataScope): Promise<QueryResult>;
  /** Calls the listener whenever an entry changes; returns its removal. */
  subscribe(listener: () => void): () => void;
  /** Marks results that read these sources stale, so they fetch again when next read. */
  invalidate(sources: readonly string[]): void;
  /**
   * Whether a result row passes filters as queries apply them, on this client's clock, time zone
   * and user: for the rows an action's `when` allows.
   */
  matches(filters: readonly Filter[], row: Row, scope?: DataScope): boolean;
}

const RETRY_MS = 5_000;
// However short a source's ttl, a result stays fresh this long, so reading it can't loop.
const FRESH_MS = 1_000;
const TIME_LITERAL = /^\d{4}-\d{2}-\d{2}/;

interface Slot {
  entry: DataEntry;
  query: Query;
  scope: DataScope;
  invalid: boolean;
  /** Counts invalidations, so one that lands while a fetch is in flight isn't lost. */
  generation: number;
  /** The clock relative times last resolved against. */
  ranAt?: number;
  failedAt?: number;
  flight?: Promise<QueryResult>;
}

/** Runs queries through the bindings, sharing results between everything that asks. */
export function createData(
  contract: AnyContract,
  fetchers: Fetchers,
  options: DataOptions = {},
): DataClient {
  const now = options.now ?? Date.now;
  const concurrency = options.concurrency ?? 4;
  const capacity = options.capacity ?? 200;
  const slots = new Map<string, Slot>();
  const listeners = new Set<() => void>();
  const queue: (() => void)[] = [];
  let running = 0;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const relative = (query: Query) =>
    query.filter.some((entry) => {
      const path = contract.path(entry.field);
      return path?.field.type === 'time' && entry.values.some((value) => !TIME_LITERAL.test(value));
    });

  const keyOf = (query: Query, scope: DataScope) => {
    const context = options.context?.() ?? {};
    return hash({ query, current: scope.current, me: context.me, zone: context.timeZone });
  };

  const ttlOf = (result: QueryResult) =>
    Math.max(
      FRESH_MS,
      Math.min(...result.reads.map((id) => (contract.source(id)?.ttl ?? 30) * 1000)),
    );

  // Relative times move with the clock, so their results are fresh within the minute they ran.
  const expired = (slot: Slot, result: QueryResult) =>
    now() - result.at > ttlOf(result) ||
    (relative(slot.query) &&
      slot.ranAt !== undefined &&
      Math.floor(now() / 60_000) !== Math.floor(slot.ranAt / 60_000));

  // Before a first result, the sources a query reaches are known from its fields.
  const readsOf = (query: Query): string[] => {
    const found = new Set([contract.source(query.source)?.id ?? query.source]);
    const { of, by, split } = query.aggregate;
    for (const name of [
      ...query.fields,
      ...query.filter.map((entry) => entry.field),
      ...query.sort.map((entry) => entry.field),
      of,
      by,
      split,
    ]) {
      if (name === NONE) continue;
      const path = contract.path(name);
      if (path?.target !== undefined) found.add(path.target);
      if (path?.via === undefined && path?.field.type === 'ref' && path.field.source) {
        found.add(path.field.source);
      }
    }
    return [...found];
  };

  const set = (key: string, slot: Slot, entry: DataEntry) => {
    slot.entry = entry;
    slots.delete(key);
    slots.set(key, slot);
    while (slots.size > capacity) {
      const oldest = slots.keys().next().value as string;
      if (slots.get(oldest)?.flight) break;
      slots.delete(oldest);
    }
  };

  const throttle = <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        running++;
        task()
          .then(resolve, reject)
          .finally(() => {
            running--;
            queue.shift()?.();
          });
      };
      if (running < concurrency) start();
      else queue.push(start);
    });

  const start = (key: string, slot: Slot): Promise<QueryResult> => {
    if (slot.flight) return slot.flight;
    let generation = slot.generation;
    const flight = throttle(() => {
      generation = slot.generation;
      const ranAt = now();
      slot.ranAt = ranAt;
      // Freshness counts from arrival, so a fetch slower than its ttl isn't stale on arrival.
      return runQuery(contract, fetchers, slot.query, {
        clock: { now: ranAt, ...timeZoneOf(options.context?.()) },
        ...(slot.scope.current === undefined ? {} : { current: slot.scope.current }),
        context: options.context?.() ?? {},
      }).then((result) => ({ ...result, at: now() }));
    });
    slot.flight = flight;
    flight.then(
      (result) => {
        slot.flight = undefined;
        // A write that invalidated while the fetch ran may have changed what it read.
        slot.invalid = slot.generation !== generation;
        slot.failedAt = undefined;
        set(key, slot, { status: 'ready', result, stale: slot.invalid });
        notify();
      },
      (error: unknown) => {
        slot.flight = undefined;
        slot.failedAt = now();
        options.onError?.(error);
        const previous = slot.entry.result;
        set(key, slot, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          ...(previous === undefined ? {} : { result: previous }),
          stale: false,
        });
        notify();
      },
    );
    return flight;
  };

  const slotFor = (query: Query, scope: DataScope): [string, Slot] => {
    const key = keyOf(query, scope);
    let slot = slots.get(key);
    if (!slot) {
      slot = {
        entry: { status: 'loading', stale: false },
        query,
        scope,
        invalid: false,
        generation: 0,
      };
      set(key, slot, slot.entry);
    }
    return [key, slot];
  };

  return {
    read(query, scope = {}) {
      const [key, slot] = slotFor(query, scope);
      const { entry } = slot;
      if (entry.status === 'loading') {
        void start(key, slot).catch(() => {});
        return slot.entry;
      }
      if (entry.status === 'error') {
        if (!slot.flight && now() - (slot.failedAt ?? 0) > RETRY_MS) {
          void start(key, slot).catch(() => {});
        }
        return slot.entry;
      }
      const old = entry.result !== undefined && expired(slot, entry.result);
      if ((old || slot.invalid) && !slot.flight) {
        if (!entry.stale) slot.entry = { ...entry, stale: true };
        void start(key, slot).catch(() => {});
      }
      return slot.entry;
    },

    peek(query, scope = {}) {
      return slots.get(keyOf(query, scope))?.entry;
    },

    load(query, scope = {}) {
      const [key, slot] = slotFor(query, scope);
      const { entry } = slot;
      if (entry.status === 'ready' && entry.result && !slot.invalid) {
        if (!expired(slot, entry.result)) return Promise.resolve(entry.result);
      }
      return start(key, slot);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    invalidate(sources) {
      let touched = false;
      for (const slot of slots.values()) {
        const reads = slot.entry.result?.reads ?? readsOf(slot.query);
        if (!reads.some((id) => sources.includes(id))) continue;
        slot.invalid = true;
        slot.generation++;
        if (slot.entry.status === 'ready' && !slot.entry.stale) {
          slot.entry = { ...slot.entry, stale: true };
        }
        touched = true;
      }
      if (touched) notify();
    },

    matches(filters, row, scope = {}) {
      const context = options.context?.() ?? {};
      return rowMatches(contract, filters, row, {
        clock: { now: now(), ...timeZoneOf(context) },
        ...(scope.current === undefined ? {} : { current: scope.current }),
        ...(context.me === undefined ? {} : { me: context.me }),
      });
    },
  };
}

const timeZoneOf = (context: BindingContext | undefined) =>
  context?.timeZone === undefined ? {} : { timeZone: context.timeZone };
