/**
 * Where a client keeps its state. Loading is synchronous, so a stored interface renders on the
 * first paint, with no layout shift.
 */
export interface Store {
  /** The stored state, or nothing; synchronous, so the first paint shows the person's interface. */
  load(): unknown;
  /** Stores the state. */
  save(state: unknown): void;
  /** Deletes the stored state. */
  clear(): void;
  /** Calls `listener` when something else changes the stored state, such as another tab. */
  watch?(listener: () => void): () => void;
}

/** Keeps state in memory, as JSON, so every load is an independent copy. */
export function memoryStore(initial?: unknown): Store {
  let text = initial === undefined ? undefined : JSON.stringify(initial);
  return {
    load: () => (text === undefined ? undefined : JSON.parse(text)),
    save: (state) => {
      text = JSON.stringify(state);
    },
    clear: () => {
      text = undefined;
    },
  };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface EventTargetLike {
  addEventListener(type: 'storage', listener: (event: { key: string | null }) => void): void;
  removeEventListener(type: 'storage', listener: (event: { key: string | null }) => void): void;
}

/** Keeps state in the browser's `localStorage`; does nothing where there is none. */
export function localStore(key: string): Store {
  const storage = () => (globalThis as { localStorage?: StorageLike }).localStorage;
  return {
    load() {
      const text = storage()?.getItem(key);
      return text ? JSON.parse(text) : undefined;
    },
    save(state) {
      storage()?.setItem(key, JSON.stringify(state));
    },
    clear() {
      storage()?.removeItem(key);
    },
    watch(listener) {
      const target = globalThis as Partial<EventTargetLike>;
      if (!target.addEventListener || !target.removeEventListener) return () => {};
      // Browsers fire `storage` in every other tab of the same origin when one writes.
      const onStorage = (event: { key: string | null }) => {
        if (event.key === key || event.key === null) listener();
      };
      target.addEventListener('storage', onStorage);
      return () => target.removeEventListener?.('storage', onStorage);
    },
  };
}
