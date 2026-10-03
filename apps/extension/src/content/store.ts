import type { Store } from '@plurid/aptuitive-core';

/**
 * The person's interface in the extension's local storage, read once before the client starts
 * so that the store's synchronous `load` works. Changes from other tabs arrive through `watch`.
 */
export async function chromeStore(key: string): Promise<Store> {
  let value: unknown = (await chrome.storage.local.get(key))[key];
  let written = JSON.stringify(value ?? null);
  const listeners = new Set<() => void>();
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[key];
    if (area !== 'local' || !change) return;
    const text = JSON.stringify(change.newValue ?? null);
    // Our own writes come back here too; only someone else's change is news.
    if (text === written) return;
    value = change.newValue;
    written = text;
    for (const listener of listeners) listener();
  });
  return {
    load: () => (value === undefined ? undefined : structuredClone(value)),
    save: (state) => {
      value = state;
      written = JSON.stringify(state ?? null);
      void chrome.storage.local.set({ [key]: state });
    },
    clear: () => {
      value = undefined;
      written = 'null';
      void chrome.storage.local.remove(key);
    },
    watch: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
