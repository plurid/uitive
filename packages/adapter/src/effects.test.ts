import { ui } from '@plurid/uitive-core';
import type { AnyPage } from '@plurid/uitive-core';
import { describe, expect, it } from 'vitest';
import { dashboard, sidebar } from './__fixtures__/dashboard.js';
import { checkAdapter, routeOf } from './checks.js';
import { compileEffects } from './effects.js';
import type { Adapter } from './format.js';

const shipped = structuredClone(dashboard) as Record<string, unknown>;

const checked = checkAdapter(shipped);
if ('problems' in checked) throw new Error(checked.problems.join('\n'));
const adapter: Adapter = checked.adapter;

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
  it('passes an adapter whose contract round-trips, filling in what it leaves out', () => {
    expect(checked.contract.id).toBe('orders-dashboard');
    expect(checked.contract.sourceIds).toContain('orders');
    expect(adapter.examples).toEqual([]);
    expect(adapter.connectors.orders?.auth).toEqual({ header: 'authorization', prefix: 'Bearer ' });
    expect(adapter.connectors.orders?.keys).toMatchObject({ refuse: [], label: 'API key' });
  });

  it('names what doesn’t resolve', () => {
    const broken = structuredClone(shipped) as Adapter;
    broken.anchors['nav.home'] = { within: 'nowhere', match: [{ role: 'link' }], required: false };
    broken.anchors.notices = { within: 'main', match: [{ role: 'alert' }], required: true };
    broken.routes.push({ path: '^/(unclosed', route: 'nope' });
    const result = checkAdapter(broken);
    expect('problems' in result && result.problems).toEqual([
      'anchors.nav.home.within: no anchor "nowhere"',
      'routes.3: ^/(unclosed doesn’t compile'.replace('’', "'"),
      'routes.3: the contract has no route "nope"',
      'anchors.notices: required anchors must sit outside replaceable regions (main)',
    ]);
  });

  it('finds loops among anchors that aren’t required, and test-mode patterns that don’t compile', () => {
    const broken = structuredClone(shipped) as Adapter;
    broken.anchors.first = { within: 'second', match: [{ role: 'link' }], required: false };
    broken.anchors.second = { within: 'first', match: [{ role: 'link' }], required: false };
    broken.testMode = '^/(test';
    const result = checkAdapter(broken);
    expect('problems' in result && result.problems).toEqual([
      'anchors.first: "within" loops',
      'anchors.second: "within" loops',
      "testMode: ^/(test doesn't compile",
    ]);
  });

  it('checks what keys look like, how they are sent, and that test keys go with a test mode', () => {
    const broken = structuredClone(adapter);
    const connector = broken.connectors.orders!;
    connector.keys.refuse = [{ pattern: '^(sk', reason: 'Secret keys are refused' }];
    connector.auth = { header: 'Cookie', prefix: '' };
    expect(checkAdapter(broken)).toEqual({
      problems: [
        "connectors.orders.keys.refuse.0: ^(sk doesn't compile",
        "connectors.orders.auth.header: browsers don't let pages set Cookie",
      ],
    });
    const single = structuredClone(adapter);
    delete single.testMode;
    expect(checkAdapter(single)).toEqual({
      problems: ['connectors.orders.keys.test: the adapter has no test mode to use test keys in'],
    });
    delete single.connectors.orders!.keys.test;
    expect('adapter' in checkAdapter(single)).toBe(true);
    const untested = structuredClone(adapter);
    delete untested.connectors.orders!.keys.test;
    expect(checkAdapter(untested)).toEqual({
      problems: [
        'connectors.orders.keys.test: the adapter has a test mode, so test keys need a pattern',
      ],
    });
  });
});

describe('routeOf', () => {
  it('matches paths in either mode, with params', () => {
    expect(routeOf(adapter, '/test/orders/ord_42')).toEqual({
      route: 'order',
      params: { id: 'ord_42' },
    });
    expect(routeOf(adapter, '/orders')).toEqual({ route: 'orders', params: {} });
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
        sidebar.filter((item) => item !== 'nav.reports'),
        ['nav.reports'],
      ),
      'home',
    );
    expect(effects).toEqual([
      { kind: 'hide', anchor: 'nav.reports' },
      {
        kind: 'more',
        container: 'sidebar',
        items: [{ action: 'nav.reports', anchor: 'nav.reports' }],
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
    expect(compileEffects(adapter, values(sidebar, [], fresh), 'orders')).toEqual([]);
  });

  it('never hides a required anchor', () => {
    const strict = {
      ...adapter,
      anchors: {
        ...adapter.anchors,
        'nav.reports': { ...adapter.anchors['nav.reports']!, required: true },
      },
    };
    expect(
      compileEffects(
        strict,
        values(
          sidebar.filter((item) => item !== 'nav.reports'),
          ['nav.reports'],
        ),
        'home',
      ),
    ).toEqual([]);
  });
});
