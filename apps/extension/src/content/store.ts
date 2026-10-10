import { hash } from '@plurid/uitive-core';
import type { Store } from '@plurid/uitive-core';

/**
 * The person's interface in the extension's local storage, read once before the client starts
 * so that the store's synchronous `load` works. Changes from other tabs arrive through `watch`.
 */
export async function chromeStore(key: string): Promise<Store> {
  let value: unknown = (await chrome.storage.local.get(key))[key];
  // Storage keeps object keys in its own order, so values compare by a hash of sorted JSON.
  const digest = (state: unknown) => hash(state ?? null);
  // What storage holds once every write of ours has landed, and those writes, oldest first.
  let confirmed = digest(value);
  let pending: string[] = [];
  const listeners = new Set<() => void>();
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[key];
    if (area !== 'local' || !change) return;
    const text = digest(change.newValue);
    // Our own writes come back here, in order, however many are on their way; only someone
    // else's change is news. Writes before an echo landed too, if unchanged and so unannounced.
    const echo = pending.indexOf(text);
    if (echo !== -1) {
      pending = pending.slice(echo + 1);
      confirmed = text;
      return;
    }
    confirmed = text;
    value = change.newValue;
    for (const listener of listeners) listener();
  });
  const write = (state: unknown, send: () => Promise<void>) => {
    value = state;
    const text = digest(state);
    // Storage announces only changes: a write that changes nothing would never come back.
    if (text === (pending.at(-1) ?? confirmed)) return;
    pending.push(text);
    send().catch(() => {
      const index = pending.indexOf(text);
      if (index !== -1) pending.splice(index, 1);
    });
  };
  return {
    load: () => (value === undefined ? undefined : structuredClone(value)),
    save: (state) => write(state, () => chrome.storage.local.set({ [key]: state })),
    clear: () => write(undefined, () => chrome.storage.local.remove(key)),
    watch: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
