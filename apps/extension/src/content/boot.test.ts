// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { adapterById } from '../adapters.ts';
import { early, lastOf, remember } from './boot.ts';

const loaded = adapterById('acme-payments');
if (!loaded) throw new Error('No adapter');
const { adapter } = loaded;
const KEY = 'uitive:acme-payments';
const sidebar = `<nav aria-label="Main">
  <a href="/test/dashboard">Home</a><a href="/test/partners">Partners</a><a href="/test/invoices">Invoices</a>
</nav>`;

describe('page start', () => {
  it('hides what the page hid last, before the extension storage answers, and as the page renders', async () => {
    remember(window, adapter, {
      effects: [{ kind: 'hide', anchor: 'nav.partners' }],
      overrides: {},
    });
    document.body.innerHTML = '';
    const boot = early(window, adapter);
    // The page renders its sidebar later, as frameworks do.
    document.body.innerHTML = sidebar;
    await vi.waitFor(() =>
      expect(document.querySelector('a[href="/test/partners"]')?.getAttribute('data-uitive')).toBe(
        'nav.partners',
      ),
    );
    expect(document.querySelector('a[href="/test/invoices"]')?.hasAttribute('data-uitive')).toBe(
      false,
    );
    boot.stop();
  });

  it('keeps hides, orders and replaced regions, without the redesign or the More list', () => {
    const last = lastOf(
      [
        { kind: 'hide', anchor: 'nav.partners' },
        {
          kind: 'more',
          container: 'sidebar',
          items: [{ action: 'nav.partners', anchor: 'nav.partners' }],
        },
        {
          kind: 'overlay',
          surface: 'home',
          region: 'main',
          mode: 'replace',
          page: { root: 'top', elements: [], data: [] } as never,
        },
        {
          kind: 'overlay',
          surface: 'payments',
          region: 'main',
          mode: 'augment',
          page: { root: 'top', elements: [], data: [] } as never,
        },
      ],
      {},
    );
    expect(last.effects).toEqual([
      { kind: 'hide', anchor: 'nav.partners' },
      { kind: 'overlay', surface: 'home', region: 'main', mode: 'replace' },
    ]);
  });

  it('keeps nothing when nothing is hidden, and ignores what it cannot read', () => {
    remember(window, adapter, { effects: [], overrides: {} });
    expect(sessionStorage.getItem(KEY)).toBeNull();
    sessionStorage.setItem(KEY, '{"effects": [{"kind": "script", "code": "alert(1)"}]}');
    document.body.innerHTML = sidebar;
    expect(() => early(window, adapter).stop()).not.toThrow();
    expect(document.querySelector('[data-uitive]')).toBeNull();
    sessionStorage.setItem(KEY, 'not json');
    expect(() => early(window, adapter).stop()).not.toThrow();
  });
});
