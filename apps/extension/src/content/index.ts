import '../zod.ts';
import type { Strategy } from '@plurid/uitive-adapter';
import { adapterFor } from '../adapters.ts';
import { early } from './boot.ts';
import { run } from './run.ts';
import { chromeStore } from './store.ts';

// Registered only on origins the person enabled; does nothing where no adapter applies.
const found = adapterFor(window.location.origin);
if (found) {
  // What the page showed last applies at once; the rest waits for the extension's storage.
  const boot = early(window, found.adapter);
  const repairs = `overrides:${found.adapter.id}`;
  void Promise.all([
    chromeStore(`definition:${found.adapter.id}`),
    chrome.storage.local
      .get(repairs)
      .then((stored) => (stored[repairs] ?? {}) as Record<string, Strategy>),
  ]).then(([store, overrides]) => {
    const start = () => {
      boot.stop();
      run({
        window,
        adapter: found.adapter,
        contract: found.contract,
        store,
        overrides,
        engine: boot.engine,
      });
    };
    if (document.documentElement) start();
    else document.addEventListener('readystatechange', start, { once: true });
  });
}
