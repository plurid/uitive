import { readFileSync } from 'node:fs';
import { ui } from '@plurid/uitive-core';
import type { AnyPage } from '@plurid/uitive-core';
import { describe, expect, it } from 'vitest';
import { checkAdapter, routeOf } from './checks.js';
import { compileEffects } from './effects.js';
import type { Adapter } from './format.js';

const shipped = JSON.parse(
  readFileSync(
    new URL('../../../apps/extension/adapters/stripe-dashboard.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const checked = checkAdapter(shipped);
if ('problems' in checked) throw new Error(checked.problems.join('\n'));
const adapter: Adapter = checked.adapter;

const sidebar = [
  'nav.home',
  'nav.balances',
  'nav.transactions',
  'nav.customers',
  'nav.products',
  'nav.connect',
  'nav.billing',
  'nav.reporting',
];
const standardHome = ui.page(ui.region('home.original')) as unknown as AnyPage;
const values = (
  visible: readonly string[],
  overflow: readonly string[] = [],
  home: AnyPage = standardHome,
) => ({
  lists: { sidebar: { visible, overflow } },
  pages: { home: { value: home, standard: standardHome } },
});

describe('checkAdapter', () => {
  it('passes the shipped adapter, whose contract round-trips', () => {
    expect(checked.contract.id).toBe('stripe-dashboard');
    expect(checked.contract.sourceIds).toContain('charges');
  });

  it('names what doesn’t resolve', () => {
    const broken = structuredClone(shipped) as Adapter;
    broken.anchors['nav.home'] = { within: 'nowhere', match: [{ role: 'link' }], required: false };
    broken.anchors.notices = { within: 'main', match: [{ role: 'alert' }], required: true };
    broken.routes.push({ path: '^/(unclosed', route: 'nope' });
    const result = checkAdapter(broken);
    expect('problems' in result && result.problems).toEqual([
      'anchors.nav.home.within: no anchor "nowhere"',
      'routes.6: ^/(unclosed doesn’t compile'.replace('’', "'"),
      'routes.6: the contract has no route "nope"',
      'anchors.notices: required anchors must sit outside replaceable regions (main)',
    ]);
  });

  it('finds loops among anchors that aren’t required, and test-mode patterns that don’t compile', () => {
    const broken = structuredClone(shipped) as Adapter;
    broken.anchors.first = { within: 'second', match: [{ role: 'link' }], required: false };
    broken.anchors.second = { within: 'first', match: [{ role: 'link' }], required: false };
    const [name = '', connector] = Object.entries(broken.connectors)[0] ?? [];
    if (!connector) throw new Error('The shipped adapter has a connector');
    connector.testMode = '^/(test';
    const result = checkAdapter(broken);
    expect('problems' in result && result.problems).toEqual([
      'anchors.first: "within" loops',
      'anchors.second: "within" loops',
      `connectors.${name}.testMode: ^/(test doesn't compile`,
    ]);
  });
});

describe('routeOf', () => {
  it('matches paths in either mode, with params', () => {
    expect(routeOf(adapter, '/test/payments/ch_3QxYz12')).toEqual({
      route: 'payment',
      params: { id: 'ch_3QxYz12' },
    });
    expect(routeOf(adapter, '/payments')).toEqual({ route: 'payments', params: {} });
    expect(routeOf(adapter, '/settings')).toBeUndefined();
  });
});

describe('compileEffects', () => {
  it('does nothing to a page as it ships', () => {
    expect(compileEffects(adapter, values(sidebar), 'home')).toEqual([]);
  });

  it('hides what moved to overflow, and offers it in a More list', () => {
    const effects = compileEffects(
      adapter,
      values(
        sidebar.filter((item) => item !== 'nav.connect'),
        ['nav.connect'],
      ),
      'home',
    );
    expect(effects).toEqual([
      { kind: 'hide', anchor: 'nav.connect' },
      {
        kind: 'more',
        container: 'sidebar',
        items: [{ action: 'nav.connect', anchor: 'nav.connect' }],
      },
    ]);
  });

  it('orders what stays when it moved', () => {
    const moved = ['nav.customers', ...sidebar.filter((item) => item !== 'nav.customers')];
    expect(compileEffects(adapter, values(moved), 'home')).toEqual([
      { kind: 'order', container: 'sidebar', items: moved },
    ]);
  });

  it('replaces a region with a redesign, or augments it when the redesign keeps the original', () => {
    const fresh = ui.page(
      ui.section('Morning', 'stack', [ui.block('note', { title: 'Hi', text: 'There' })]),
    ) as unknown as AnyPage;
    const kept = ui.page(
      ui.section('', 'stack', [
        ui.block('note', { title: 'Hi', text: 'There' }),
        ui.region('home.original'),
      ]),
    ) as unknown as AnyPage;
    expect(compileEffects(adapter, values(sidebar, [], fresh), 'home')).toEqual([
      { kind: 'overlay', surface: 'home', region: 'main', mode: 'replace', page: fresh },
    ]);
    expect(compileEffects(adapter, values(sidebar, [], kept), 'home')[0]).toMatchObject({
      mode: 'augment',
    });
    // Off its route, a redesign doesn't apply.
    expect(compileEffects(adapter, values(sidebar, [], fresh), 'payments')).toEqual([]);
  });

  it('never hides a required anchor', () => {
    const strict = {
      ...adapter,
      anchors: {
        ...adapter.anchors,
        'nav.connect': { ...adapter.anchors['nav.connect']!, required: true },
      },
    };
    expect(
      compileEffects(
        strict,
        values(
          sidebar.filter((item) => item !== 'nav.connect'),
          ['nav.connect'],
        ),
        'home',
      ),
    ).toEqual([]);
  });
});
