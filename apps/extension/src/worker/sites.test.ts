import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../__fixtures__/chrome.ts';

let fake: ReturnType<typeof fakeChrome>;
beforeEach(() => {
  vi.resetModules();
  fake = fakeChrome();
  vi.stubGlobal('chrome', fake.chrome);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sites', () => {
  it('gives origins that differ only in punctuation registrations of their own', async () => {
    const { enable, enabled, disable, siteId } = await import('./sites.ts');
    fake.chrome.permissions.granted.add('https://a-b.com/*');
    fake.chrome.permissions.granted.add('https://a.b.com/*');
    expect(siteId('https://a-b.com')).not.toBe(siteId('https://a.b.com'));
    await enable('https://a-b.com');
    expect(await enabled('https://a.b.com')).toBe(false);
    await enable('https://a.b.com');
    expect(await enabled('https://a.b.com')).toBe(true);
    await disable('https://a-b.com');
    expect(await enabled('https://a-b.com')).toBe(false);
    expect(await enabled('https://a.b.com')).toBe(true);
  });

  it('moves registrations made under the old IDs, by the origin they match', async () => {
    await fake.chrome.scripting.registerContentScripts([
      {
        id: 'site-https-dashboard-stripe-com',
        matches: ['https://dashboard.stripe.com/*'],
        js: ['content.js'],
        runAt: 'document_start',
        persistAcrossSessions: true,
      },
    ]);
    const { enabled, enabledOrigins } = await import('./sites.ts');
    expect(await enabled('https://dashboard.stripe.com')).toBe(true);
    expect(await enabledOrigins()).toEqual(['https://dashboard.stripe.com']);
    expect([...fake.chrome.scripting.scripts.keys()]).toEqual([
      'site:https://dashboard.stripe.com',
    ]);
  });

  it('refuses a site the person has not allowed', async () => {
    const { enable } = await import('./sites.ts');
    await expect(enable('https://dashboard.stripe.com')).rejects.toThrow(/Allow Uitive/);
  });
});
