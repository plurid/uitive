import '../zod.ts';
import type { Strategy } from '@plurid/uitive-adapter';
import { adapterFor } from '../adapters.ts';
import { run } from './run.ts';
import { chromeStore } from './store.ts';

// Registered only on origins the person enabled; does nothing where no adapter applies.
const found = adapterFor(window.location.origin);
if (found) {
  const repairs = `overrides:${found.adapter.id}`;
  void Promise.all([
    chromeStore(`definition:${found.adapter.id}`),
    chrome.storage.local
      .get(repairs)
      .then((stored) => (stored[repairs] ?? {}) as Record<string, Strategy>),
  ]).then(([store, overrides]) => {
    const start = () =>
      run({ window, adapter: found.adapter, contract: found.contract, store, overrides });
    if (document.documentElement) start();
    else document.addEventListener('readystatechange', start, { once: true });
  });
}
