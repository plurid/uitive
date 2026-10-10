// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../__fixtures__/chrome.ts';
import { adapterById } from '../adapters.ts';
import { run } from './run.ts';
import { chromeStore } from './store.ts';

const loaded = adapterById('stripe-dashboard');
if (!loaded) throw new Error('No adapter');

const fake = fakeChrome({ delay: 1 });
const frames: (FrameRequestCallback | undefined)[] = [];
const flush = () => {
  const pending = frames.splice(0);
  for (const frame of pending) frame?.(performance.now());
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
let started: ReturnType<typeof run>;

beforeAll(async () => {
  vi.stubGlobal('chrome', fake.chrome);
  fake.answer(async (message) =>
    (message as { kind: string }).kind === 'keys'
      ? { ok: true, value: { stripe: { test: true, live: false } } }
      : { ok: false, problem: 'Not in tests' },
  );
  // Frames run when the test says, so a burst of changes can be counted.
  window.requestAnimationFrame = (callback) => frames.push(callback);
  window.cancelAnimationFrame = (id) => {
    frames[id - 1] = undefined;
  };
  history.replaceState({}, '', '/test/dashboard');
  document.body.innerHTML = `
    <header><input type="search" aria-label="Search" /></header>
    <div role="alert">CANARY-notice</div>
    <nav aria-label="Main" style="display: flex">
      <a href="/test/dashboard">Home</a>
      <a href="/test/balance/overview">Balances</a>
      <a href="/test/payments">Transactions</a>
      <a href="/test/customers">Customers</a>
      <a href="/test/products">Product catalog</a>
      <a href="/test/connect">Connect</a>
      <a href="/test/billing">Billing</a>
      <a href="/test/reports">Reporting</a>
    </nav>
    <main>
      <a href="/customers/cus_x">Live customer</a>
      <a href="/test/customers/cus_x">Test customer</a>
    </main>`;
  const store = await chromeStore('definition:stripe-dashboard');
  started = run({ window, adapter: loaded.adapter, contract: loaded.contract, store });
  await settle();
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const uses = (action: string) =>
  started.client.request('command', 'x').summary.rows.find((row) => row.action === action)?.uses ??
  0;

describe('the content script', () => {
  it('says which sources it can read from the keys it has and the mode the page is in', async () => {
    const sources = () => started.client.request('command', 'x').environment?.sources ?? {};
    expect(sources().charges).toBe('live');
    history.pushState({}, '', '/payments');
    expect(sources().charges).toBe('unavailable');
    history.pushState({}, '', '/test/dashboard');
    fake.answer(async () => ({ ok: true, value: { stripe: { test: false, live: false } } }));
    await fake.send({ kind: 'ask', text: 'hide Connect' }, {});
    expect(sources().charges).toBe('unavailable');
  });

  it("counts only the person's own clicks and key presses", async () => {
    const before = uses('nav.billing');
    document.querySelector<HTMLElement>('a[href="/test/billing"]')?.click();
    expect(uses('nav.billing')).toBe(before);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyA' }),
    );
    expect(started.report().original).toBe(false);
  });

  it('follows a burst of changes once, in the next frame, and not its own', async () => {
    flush();
    const syncs = started.report().timing.syncs;
    for (let index = 0; index < 5; index++) {
      document.querySelector('main')?.append(document.createElement('p'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(frames.filter(Boolean)).toHaveLength(1);
    flush();
    expect(started.report().timing.syncs).toBe(syncs + 1);
    const more = document.createElement('div');
    more.setAttribute('data-uitive-more', '');
    document.body.append(more);
    more.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frames.filter(Boolean)).toHaveLength(0);
  });

  it("records no timing for a sync's own location change", async () => {
    const syncs = started.report().timing.syncs;
    history.pushState({}, '', '/test/payments');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(started.report().route).toBe('payments');
    expect(started.report().timing.syncs).toBe(syncs);
  });

  it("keeps links in test mode, through the page's own link to exactly that place", () => {
    const clicked: string[] = [];
    for (const link of document.querySelectorAll('main a')) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        clicked.push(link.textContent ?? '');
      });
    }
    started.client.navigate({ route: 'customer', params: { id: 'cus_x' } });
    expect(clicked).toEqual(['Test customer']);
  });

  it('hears repairs and Forget from other tabs', async () => {
    await chrome.storage.local.set({
      'overrides:stripe-dashboard': { 'nav.customers': { href: '^/test/customers$' } },
    });
    await settle();
    expect(started.report().repairs).toEqual(['nav.customers']);
    expect(started.report().changes.length).toBeGreaterThan(0);
    expect(sessionStorage.getItem('uitive:stripe-dashboard')).not.toBeNull();
    await chrome.storage.local.clear();
    await settle();
    expect(started.report().repairs).toEqual([]);
    expect(started.report().changes).toEqual([]);
    expect(sessionStorage.getItem('uitive:stripe-dashboard')).toBeNull();
  });
});
