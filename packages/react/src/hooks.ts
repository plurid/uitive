'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  stableStringify,
  type ActionIdOf,
  type ActionView,
  type Adaptation,
  type AnyContract,
  type Aptuitive,
  type Confirmation,
  type DataEntry,
  type DataScope,
  type Location,
  type ParamsOf,
  type Pending,
  type PerformOptions,
  type PerformResult,
  type Query,
  type Snapshot,
  type SurfaceIdOf,
  type SurfaceValueOf,
  type UserPage,
  type View,
} from '@plurid/aptuitive-core';

/**
 * The client's whole snapshot. It changes with every usage event, so use it for panels, not for
 * the interface itself; prefer {@link useSurface} there.
 */
export function useSnapshot<C extends AnyContract>(client: Aptuitive<C>): Snapshot {
  return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
}

/**
 * A surface's value, for the current context unless one is given. Re-renders only when that
 * value changes. Server rendering uses the standard layout, so hydration never mismatches; the
 * user's definition follows on the client.
 */
export function useSurface<C extends AnyContract, K extends SurfaceIdOf<C>>(
  client: Aptuitive<C>,
  id: K,
  context?: string,
): SurfaceValueOf<C, K> {
  const read = useCallback(() => client.surface(id, context), [client, id, context]);
  const standard = useCallback(() => client.standard(id, context), [client, id, context]);
  return useSyncExternalStore(client.subscribe, read, standard);
}

/** A surface as the application ships it, whatever the user's definition. */
export function useStandard<C extends AnyContract, K extends SurfaceIdOf<C>>(
  client: Aptuitive<C>,
  id: K,
  context?: string,
): SurfaceValueOf<C, K> {
  const read = useCallback(() => client.standard(id, context), [client, id, context]);
  return useSyncExternalStore(client.subscribe, read, read);
}

/** Every action, ranked for a palette by how the user reaches for them. */
export function useRanked<C extends AnyContract>(
  client: Aptuitive<C>,
): readonly ActionView<ActionIdOf<C>>[] {
  return useSyncExternalStore(client.subscribe, client.ranked, client.ranked);
}

/** Whether the user is looking at their own interface or the standard one. */
export function useView<C extends AnyContract>(client: Aptuitive<C>): View {
  const read = useCallback(() => client.getSnapshot().view, [client]);
  return useSyncExternalStore(client.subscribe, read, read);
}

/** The latest adaptation, for banners. Re-renders only when a new one arrives. */
export function useLatest<C extends AnyContract>(client: Aptuitive<C>): Adaptation | undefined {
  const read = useCallback(() => client.getSnapshot().latest, [client]);
  return useSyncExternalStore(client.subscribe, read, read);
}

/** Changes waiting for the next safe moment. */
export function usePending<C extends AnyContract>(client: Aptuitive<C>): readonly Pending[] {
  const read = useCallback(() => client.getSnapshot().pending, [client]);
  return useSyncExternalStore(client.subscribe, read, read);
}

/** A request's state, for an interface: whether it is in flight, and its result or error. */
export interface Request<T> {
  /** Whether a request is in flight. */
  pending: boolean;
  /** The last result, once there is one. */
  result: T | undefined;
  /** Why the last request failed, if it did. */
  error: unknown;
}

/** Asks in the user's own words, tracking the request for the interface. */
export function useCommand<C extends AnyContract>(client: Aptuitive<C>) {
  const [state, setState] = useState<Request<Adaptation>>({
    pending: false,
    result: undefined,
    error: undefined,
  });
  const ask = useCallback(
    async (text: string, options?: { goal?: boolean }) => {
      setState((current) => ({ ...current, pending: true, error: undefined }));
      try {
        const result = await client.ask(text, options);
        setState({ pending: false, result, error: undefined });
        return result;
      } catch (error) {
        setState({ pending: false, result: undefined, error });
        throw error;
      }
    },
    [client],
  );
  return { ...state, ask };
}

/** Plans on request, tracking it for the interface. */
export function usePlan<C extends AnyContract>(client: Aptuitive<C>) {
  const [state, setState] = useState<Request<Adaptation>>({
    pending: false,
    result: undefined,
    error: undefined,
  });
  const plan = useCallback(async () => {
    setState((current) => ({ ...current, pending: true, error: undefined }));
    try {
      const result = await client.plan();
      setState({ pending: false, result, error: undefined });
      return result;
    } catch (error) {
      setState({ pending: false, result: undefined, error });
      throw error;
    }
  }, [client]);
  return { ...state, plan };
}

/**
 * Connects the page's lifecycle to sessions: coming back to a tab after an idle gap applies
 * pending changes before the user acts, each session is planned from use once (see `learn`), and
 * leaving the page writes state to storage. Starts no sessions itself and plans a session only
 * once, so React's development double-mounting changes nothing. `AptuitiveProvider` calls it;
 * call it yourself only for a client used without the provider.
 */
export function useLifecycle<C extends AnyContract>(client: Aptuitive<C>): void {
  useEffect(() => {
    void client.learn();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        client.resume();
        void client.learn();
      } else client.flush();
    };
    const onPageHide = () => client.flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [client]);
}

const LOADING: DataEntry = { status: 'loading', stale: false };
const UNBOUND: DataEntry = {
  status: 'error',
  error: 'This application reads no data',
  stale: false,
};
const silent = () => () => {};

/**
 * One query's result, shared with everything else that asks for it. Fetches when there is none
 * or it went stale; renders from the cache meanwhile.
 */
export function useQuery<C extends AnyContract>(
  client: Aptuitive<C>,
  query: Query | undefined,
  scope: DataScope = {},
): DataEntry {
  return useQueries(client, [query], scope)[0] as DataEntry;
}

/** Several queries' results at once, in order; an undefined query reads as loading. */
export function useQueries<C extends AnyContract>(
  client: Aptuitive<C>,
  queries: readonly (Query | undefined)[],
  scope: DataScope = {},
): readonly DataEntry[] {
  const data = client.data;
  const key = stableStringify([queries, scope.current ?? null]);
  const cached = useRef<readonly DataEntry[]>([]);
  const current = scope.current;
  const read = useCallback(() => {
    const entries = queries.map((query) => {
      if (!data) return UNBOUND;
      if (!query) return LOADING;
      return data.peek(query, current === undefined ? {} : { current }) ?? LOADING;
    });
    const same =
      entries.length === cached.current.length &&
      entries.every((entry, index) => entry === cached.current[index]);
    if (!same) cached.current = entries;
    return cached.current;
    // The key stands for the queries and scope.
  }, [data, key]);
  const entries = useSyncExternalStore(data?.subscribe ?? silent, read, read);
  useEffect(() => {
    for (const query of queries) {
      if (query && data) data.read(query, current === undefined ? {} : { current });
    }
    // Reading again after every change refetches what went stale or was invalidated.
  }, [data, key, entries]);
  return entries;
}

/** Runs actions; writes from generated interfaces wait for the user's yes. */
export function usePerform<C extends AnyContract>(client: Aptuitive<C>) {
  return useCallback(
    <A extends ActionIdOf<C>>(action: A, params?: ParamsOf<C, A>, options?: PerformOptions) =>
      client.perform(action, params, options),
    [client],
  );
}

/**
 * The application's own control for an action: running it records usage (no hand-written
 * `record()`), and the application confirms in its own way.
 */
export function useAction<C extends AnyContract, A extends ActionIdOf<C>>(
  client: Aptuitive<C>,
  action: A,
): (params?: ParamsOf<C, A>, options?: Omit<PerformOptions, 'origin'>) => Promise<PerformResult> {
  return useCallback(
    (params, options) => client.perform(action, params, { ...options, origin: 'native' }),
    [client, action],
  );
}

/** The run waiting for the user's yes, with the means to answer it. */
export function useConfirmation<C extends AnyContract>(client: Aptuitive<C>) {
  const read = useCallback(() => client.getSnapshot().confirmation, [client]);
  const confirmation: Confirmation | undefined = useSyncExternalStore(
    client.subscribe,
    read,
    () => undefined,
  );
  const confirm = useCallback(
    (phrase?: string) => (confirmation ? client.confirm(confirmation.id, phrase) : false),
    [client, confirmation],
  );
  const cancel = useCallback(() => {
    if (confirmation) client.cancel(confirmation.id);
  }, [client, confirmation]);
  return { confirmation, confirm, cancel };
}

/** Where the user is, as the router last reported it. */
export function useLocation<C extends AnyContract>(client: Aptuitive<C>): Location | undefined {
  const read = useCallback(() => client.getSnapshot().location, [client]);
  return useSyncExternalStore(client.subscribe, read, () => undefined);
}

/** The pages the user made. */
export function useUserPages<C extends AnyContract>(client: Aptuitive<C>): readonly UserPage[] {
  return useSyncExternalStore(client.subscribe, client.userPages, client.userPages);
}

/**
 * Connects any router: tells the client every route change and lets it follow links through
 * the router. With React Router, `useAptuitiveRouter(client, { path: pathname + search,
 * navigate })`; with Next.js, `{ path: usePathname(), navigate: useRouter().push }`.
 */
export function useAptuitiveRouter<C extends AnyContract>(
  client: Aptuitive<C>,
  router: { path: string; navigate: (href: string) => void },
): void {
  const navigate = useRef(router.navigate);
  useEffect(() => {
    navigate.current = router.navigate;
  });
  useEffect(() => client.setLocation(router.path), [client, router.path]);
  useEffect(() => client.attachRouter((href) => navigate.current(href)), [client]);
}
