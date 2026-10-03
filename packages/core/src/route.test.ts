import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { payments } from './__fixtures__/payments.js';
import { action, defineApp, page } from './contract.js';
import { ui } from './page.js';
import { buildPath, entityRoute, matchRoute, route } from './route.js';
import { source } from './source.js';

describe('routes', () => {
  it('match paths, literal segments first, ignoring queries and hashes', () => {
    expect(matchRoute(payments, '/payments/ch_001?tab=events#top')).toEqual({
      route: 'payment',
      params: { id: 'ch_001' },
    });
    expect(matchRoute(payments, '/payments/')).toEqual({ route: 'payments', params: {} });
    expect(matchRoute(payments, '/')).toEqual({ route: 'home', params: {} });
    expect(matchRoute(payments, '/customers/cus%20ada')?.params).toEqual({ id: 'cus ada' });
    expect(matchRoute(payments, '/refunds')).toBeUndefined();

    const shop = defineApp({
      id: 'shop',
      description: 'Shop',
      actions: { open: action({ label: 'Open', description: 'Open' }) },
      routes: {
        order: route({ path: '/orders/:id' }),
        create: route({ path: '/orders/new' }),
      },
      surfaces: {},
    });
    expect(matchRoute(shop, '/orders/new')?.route).toBe('create');
    expect(matchRoute(shop, '/orders/42')?.route).toBe('order');
  });

  it('build paths, encoding params, and find the route for a source', () => {
    expect(buildPath(payments, 'payment', { id: 'ch 1' })).toBe('/payments/ch%201');
    expect(buildPath(payments, 'payment')).toBeUndefined();
    expect(buildPath(payments, 'home')).toBe('/');
    expect(entityRoute(payments, 'customers')).toBe('customer');
    expect(entityRoute(payments, 'disputes')).toBeUndefined();
    expect(payments.route('PAYMENT')).toBe('payment');
  });

  it('reject routes that point at nothing', () => {
    const base = {
      id: 'app',
      description: 'App',
      actions: { open: action({ label: 'Open', description: 'Open' }) },
      sources: {
        orders: source({
          label: 'Orders',
          description: 'Orders',
          row: z.object({ id: z.string() }),
          key: 'id',
        }),
      },
      surfaces: {
        order: page({})({
          label: 'Order',
          description: 'One order',
          entity: 'orders',
          standard: () => ui.page(ui.section('', 'stack', [])),
        }),
      },
    };
    const attempt = (spec: Record<string, unknown>) => () =>
      defineApp({ ...base, routes: { here: route(spec as never) } });
    expect(attempt({ path: 'orders' })).toThrow(/must start with \//);
    expect(attempt({ path: '/orders/:1d' })).toThrow(/not a param name/);
    expect(attempt({ path: '/a/:id/b/:id' })).toThrow(/repeats :id/);
    expect(attempt({ path: '/orders', entity: 'orders' })).toThrow(/needs :id for the orders key/);
    expect(attempt({ path: '/x/:id', entity: 'carts' })).toThrow(/unknown source "carts"/);
    expect(attempt({ path: '/x', page: 'nope' })).toThrow(/"nope" is not a page/);
    expect(attempt({ path: '/x', page: 'order' })).toThrow(
      /about orders, so the route must show one/,
    );
    expect(attempt({ path: '/x', action: 'close' })).toThrow(/unknown action "close"/);
    expect(() => defineApp({ ...base, routes: { Here: route({ path: '/' }) } })).toThrow(
      /must match/,
    );
  });
});
