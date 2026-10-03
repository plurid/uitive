import { describe, expect, it, vi } from 'vitest';
import { NOW, payments, rows } from './__fixtures__/payments.js';
import { createAptuitive } from './client.js';
import { action, defineApp, page } from './contract.js';
import { fromRows } from './data.js';
import { ui } from './page.js';
import type { Planner } from './planner.js';
import { query } from './query.js';
import { route } from './route.js';

function setup(planner?: Planner) {
  const navigate = vi.fn();
  const onError = vi.fn();
  const client = createAptuitive({
    contract: payments,
    now: () => NOW * 1000,
    onError,
    ...(planner ? { planner } : {}),
    bindings: {
      fetch: fromRows(rows),
      perform: { export: () => ({ navigate: { route: 'payment', params: { id: 'ch_007' } } }) },
      navigate,
    },
  });
  return { client, navigate, onError };
}

const failedTable = ui.page(
  ui.section('', 'stack', [
    ui.block('table', {
      data: 'failed',
      columns: ['payments.id', 'payments.amount'],
      lookups: [],
      rowActions: [],
      density: 'compact',
      link: 'entity',
    }),
  ]),
  [
    {
      name: 'failed',
      query: query('payments', {
        fields: ['payments.id', 'payments.amount'],
        filter: [{ field: 'payments.status', op: 'eq', values: ['failed'] }],
      }),
    },
  ],
);

describe('location', () => {
  it('knows the route, its params and the row a page is about', () => {
    const { client } = setup();
    client.setLocation('/payments/ch_001?tab=events');
    expect(client.getSnapshot().location).toEqual({
      path: '/payments/ch_001?tab=events',
      route: 'payment',
      params: { id: 'ch_001' },
      entity: { source: 'payments', key: 'ch_001' },
    });
    client.setLocation('/apt/morning-check');
    expect(client.getSnapshot().location).toEqual({
      path: '/apt/morning-check',
      params: {},
      userPage: 'morning-check',
    });
    client.setLocation('/settings');
    expect(client.getSnapshot().location).toEqual({ path: '/settings', params: {} });
  });

  it('records a visit to a route with an action, once per visit', () => {
    const { client } = setup();
    client.setLocation('/payments');
    client.setLocation('/payments');
    client.setLocation('/payments/ch_001');
    client.setLocation('/payments');
    expect(client.events().map((event) => event.action)).toEqual(['go.payments', 'go.payments']);
  });

  it('sets a context from a param of the same name', () => {
    const console = defineApp({
      id: 'console',
      description: 'A console',
      actions: { open: action({ label: 'Open', description: 'Open' }) },
      contexts: { service: ['vm', 'db'] },
      routes: { service: route({ path: '/services/:service' }) },
      surfaces: {
        servicePage: page({})({
          label: 'Service',
          description: 'One service',
          context: 'service',
          standard: (value) => ui.page(ui.section(value ?? '', 'stack', [])),
        }),
      },
    });
    const client = createAptuitive({ contract: console, now: () => 0 });
    client.setLocation('/services/DB');
    expect(client.getSnapshot().contexts).toEqual({ service: 'db' });
  });

  it('follows routes and links through the router binding', async () => {
    const { client, navigate, onError } = setup();
    expect(client.navigate({ route: 'customer', params: { id: 'cus ada' } })).toBe(
      '/customers/cus%20ada',
    );
    expect(navigate).toHaveBeenLastCalledWith('/customers/cus%20ada');
    expect(client.navigate({ href: '/elsewhere' })).toBe('/elsewhere');
    expect(client.navigate({ route: 'customer' })).toBeUndefined();
    expect(onError).toHaveBeenCalled();
    await client.perform('export', {});
    expect(navigate).toHaveBeenLastCalledWith('/payments/ch_007');
  });
});

describe('user pages', () => {
  it('are made, renamed, redesigned and deleted by the user, with explanations', () => {
    const { client } = setup();
    const made = client.createPage('Morning check');
    expect(made.slug).toBe('morning-check');
    expect(client.explain(made.adaptation.applied[0] as string)?.title).toBe(
      'Your page Morning check made',
    );
    expect(client.createPage('Morning check!').slug).toBe('morning-check-2');
    expect(client.userPages().map((entry) => [entry.slug, entry.title])).toEqual([
      ['morning-check', 'Morning check'],
      ['morning-check-2', 'Morning check!'],
    ]);

    expect(client.setUserPage('morning-check', failedTable).applied).toHaveLength(1);
    expect(client.userPages()[0]?.value.data.map((entry) => entry.name)).toEqual(['failed']);
    expect(client.renamePage('morning-check', 'Failures').applied).toHaveLength(1);
    expect(client.renamePage('morning-check', 'Failures').rejected[0]?.message).toBe(
      'Already called Failures',
    );
    expect(client.deletePage('morning-check-2').applied).toHaveLength(1);
    expect(client.userPages().map((entry) => entry.title)).toEqual(['Failures']);
    expect(client.deletePage('nope').rejected[0]?.message).toBe('You have no page at nope');
  });

  it('pass the same rules as any page, and come back on revert', () => {
    const { client } = setup();
    const broken = ui.page(ui.section('', 'stack', [ui.block('table', { data: 'nothing' })]));
    expect(client.createPage('Broken', broken).adaptation.rejected[0]?.message).toMatch(/^Table: /);
    const made = client.createPage('Kept');
    client.revert(made.adaptation.applied[0] as string);
    expect(client.userPages()).toEqual([]);
  });

  it('are capped, so a person keeps a manageable set', () => {
    const { client } = setup();
    for (let index = 0; index < 20; index++) client.createPage(`Page ${index}`);
    expect(client.createPage('One too many').adaptation.rejected[0]).toMatchObject({
      rule: 'capacity',
      message: 'You can keep up to 20 pages',
    });
  });

  it('stay out of planners’ reach unless the person asks', async () => {
    const maker: Planner = {
      name: 'maker',
      async plan() {
        return {
          origin: 'model',
          operations: [
            {
              change: {
                kind: 'userPage',
                surface: 'userPages',
                op: 'create',
                slug: 'surprise',
                title: 'Surprise',
                value: failedTable,
              },
              evidence: [{ intent: true }],
            },
          ],
          meta: { planner: 'maker', ms: 0 },
        };
      },
    };
    const { client } = setup(maker);
    client.setGoal('I watch failures');
    const plan = await client.plan();
    expect(plan.rejected[0]).toMatchObject({
      rule: 'kind',
      message: 'Only you can create your pages',
    });
    expect(client.userPages()).toEqual([]);

    const asked: Planner = {
      name: 'asked',
      async plan() {
        const result = await maker.plan(undefined as never, payments);
        return {
          ...result,
          operations: result.operations.map((entry) => ({ ...entry, scope: 'explicit' as const })),
        };
      },
    };
    const commanded = setup(asked).client;
    const answer = await commanded.ask('make me a page of failed payments');
    expect(answer.status).toBe('done');
    expect(commanded.userPages().map((entry) => entry.slug)).toEqual(['surprise']);
  });

  it('tell planners which pages exist and which route is in view, never the row', () => {
    const { client } = setup();
    client.createPage('Morning check', failedTable);
    client.setLocation('/apt/morning-check');
    const request = client.request('command', 'add a chart');
    expect(request.state.userPages).toEqual([{ slug: 'morning-check', title: 'Morning check' }]);
    expect(request.state.userPage?.slug).toBe('morning-check');
    client.setLocation('/payments/ch_001');
    const about = client.request('command', 'show refunds');
    expect(about.route).toBe('payment');
    expect(JSON.stringify(about)).not.toContain('ch_001');
  });
});
