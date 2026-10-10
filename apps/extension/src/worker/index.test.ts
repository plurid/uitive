import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../__fixtures__/chrome.ts';

const secrets = vi.hoisted(() => new Map<string, string>());
vi.mock('./secrets.ts', () => ({
  getSecret: async (name: string) => secrets.get(name),
  setSecret: async (name: string, value: string) => void secrets.set(name, value),
  clearSecret: async (name: string) => void secrets.delete(name),
  clearSecrets: async () => secrets.clear(),
  secretNames: async () => [...secrets.keys()],
}));

const SITE = 'https://dashboard.acme-payments.example';
const PANEL = { url: 'chrome-extension://uitive-test/panel/index.html' };
let fake: ReturnType<typeof fakeChrome>;

async function start(manifestHosts: string[] = []) {
  vi.resetModules();
  fake = fakeChrome({ delay: 1, manifestHosts });
  vi.stubGlobal('chrome', fake.chrome);
  await import('./index.ts');
  return (message: object, sender: object = PANEL) =>
    fake.send(message, sender) as Promise<{ ok: boolean; value?: unknown; problem?: string }>;
}

beforeEach(() => secrets.clear());
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the worker', () => {
  it('asks for the site and the API its data comes from, and lists the sites when a tab hides its address', async () => {
    const ask = await start();
    fake.chrome.tabs.tabs.set(1, { id: 1, url: `${SITE}/test/dashboard` });
    fake.chrome.tabs.tabs.set(2, { id: 2 });
    expect((await ask({ kind: 'site.status', tabId: 1 })).value).toMatchObject({
      origin: SITE,
      adapter: { id: 'acme-payments' },
      enabled: false,
      access: [`${SITE}/*`, 'https://api.acme-payments.example/*'],
    });
    expect((await ask({ kind: 'site.status', tabId: 2 })).value).toMatchObject({
      origin: null,
      adapter: null,
      sites: [
        {
          origin: SITE,
          label: 'Acme Payments (fictional)',
          enabled: false,
          access: [`${SITE}/*`, 'https://api.acme-payments.example/*'],
        },
      ],
    });
  });

  it('disables a site and gives back its access, but never what was granted at install', async () => {
    const ask = await start(['http://127.0.0.1/*']);
    await fake.chrome.permissions.request({
      origins: [`${SITE}/*`, 'https://api.acme-payments.example/*'],
    });
    expect(await ask({ kind: 'site.enable', origin: SITE })).toEqual({ ok: true, value: true });
    expect(await ask({ kind: 'site.disable', origin: SITE })).toEqual({ ok: true, value: true });
    expect([...fake.chrome.scripting.scripts.keys()]).toEqual([]);
    expect([...fake.chrome.permissions.granted]).toEqual(['http://127.0.0.1/*']);
  });

  it('forgets everything: storage, keys, registrations and access', async () => {
    const ask = await start(['http://127.0.0.1/*']);
    await fake.chrome.permissions.request({
      origins: [`${SITE}/*`, 'https://api.acme-payments.example/*'],
    });
    await ask({ kind: 'site.enable', origin: SITE });
    await chrome.storage.local.set({ 'definition:acme-payments': { events: [] } });
    await chrome.storage.session.set({ anything: 1 });
    secrets.set('anthropic', 'sk-ant-unit');
    expect(await ask({ kind: 'forget' })).toEqual({ ok: true, value: true });
    expect(fake.chrome.storage.local.data.size).toBe(0);
    expect(fake.chrome.storage.session.data.size).toBe(0);
    expect(secrets.size).toBe(0);
    expect([...fake.chrome.scripting.scripts.keys()]).toEqual([]);
    expect([...fake.chrome.permissions.granted]).toEqual(['http://127.0.0.1/*']);
  });

  it('refuses keys as the adapter says, and names the key it takes', async () => {
    const ask = await start();
    const name = 'connector:acme-payments:acme:test';
    expect(await ask({ kind: 'secret.set', name, value: 'acme_secret_123' })).toMatchObject({
      ok: false,
      problem: 'Secret keys are refused: create a read-only key in Acme',
    });
    expect(await ask({ kind: 'secret.set', name, value: 'acme_live_123' })).toMatchObject({
      ok: false,
      problem: "That isn't a test read-only key for Acme API",
    });
    expect(await ask({ kind: 'secret.set', name, value: 'acme_test_123' })).toMatchObject({
      ok: true,
    });
    expect(secrets.get(name)).toBe('acme_test_123');
    fake.chrome.tabs.tabs.set(1, { id: 1, url: `${SITE}/test/dashboard` });
    expect((await ask({ kind: 'site.status', tabId: 1 })).value).toMatchObject({
      adapter: { modes: true, examples: [expect.any(String), expect.any(String)] },
      connectors: [
        {
          name: 'acme',
          key: 'read-only key',
          hint: { test: 'acme_test_...', live: 'acme_live_...' },
          secret: { test: name, live: 'connector:acme-payments:acme:live' },
        },
      ],
    });
  });

  it('tells a page which connectors have a key, and only a page the adapter serves', async () => {
    const ask = await start();
    secrets.set('connector:acme-payments:acme:test', 'acme_test_unit');
    const page = { tab: { id: 1 }, origin: SITE, url: `${SITE}/test/dashboard` };
    expect(await ask({ kind: 'keys', adapter: 'acme-payments' }, page)).toEqual({
      ok: true,
      value: { acme: { test: true, live: false } },
    });
    const elsewhere = { tab: { id: 2 }, origin: 'https://example.com' };
    expect(await ask({ kind: 'keys', adapter: 'acme-payments' }, elsewhere)).toMatchObject({
      ok: false,
    });
  });
});
