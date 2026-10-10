import {
  action,
  defineApp,
  field,
  list,
  page,
  route,
  source,
  toJson,
  ui,
} from '@plurid/uitive-core';
import { z } from 'zod';
import type { AdapterInput } from '../format.js';

// A fictional orders dashboard: a sidebar of four links, a home page that can be redesigned, and
// one connector, with a test mode marked by a path prefix.
const mode = '^/(test/)?';

/** The sidebar's links, in the order the site shows them. */
export const sidebar = ['nav.home', 'nav.orders', 'nav.customers', 'nav.reports'] as const;

const links: Record<(typeof sidebar)[number], [label: string, href: string]> = {
  'nav.home': ['Home', `${mode}home/?$`],
  'nav.orders': ['Orders', `${mode}orders/?$`],
  'nav.customers': ['Customers', `${mode}customers/?$`],
  'nav.reports': ['Reports', `${mode}reports`],
};

const contract = defineApp({
  id: 'orders-dashboard',
  description: 'An orders dashboard, as the extension sees it',
  sources: {
    orders: source({
      label: 'Orders',
      description: 'Every order, with its total',
      row: z.object({
        id: z.string(),
        total: field.money({ currency: 'currency', minor: true }),
        currency: z.string(),
      }),
      key: 'id',
    }),
  },
  actions: Object.fromEntries(
    sidebar.map((id) => [
      id,
      action({ label: links[id][0], description: `Opens ${links[id][0]} from the sidebar` }),
    ]),
  ),
  regions: { 'home.original': { label: 'Home as it is', description: 'The home page, unchanged' } },
  routes: {
    home: route({ path: '/home', page: 'home' }),
    orders: route({ path: '/orders' }),
    order: route({ path: '/orders/:id', entity: 'orders', key: 'id' }),
  },
  surfaces: {
    sidebar: list({
      label: 'Sidebar',
      description: 'The links down the side',
      items: [...sidebar],
      capacity: sidebar.length,
      reorderable: true,
    }),
    home: page({})({
      label: 'Home',
      description: 'The first page',
      standard: () => ui.page(ui.region('home.original')),
    }),
  },
});

/** The adapter, as an adapter's author writes it. */
export const dashboard: AdapterInput = {
  format: 'uitive.adapter',
  formatVersion: 2,
  id: 'orders-dashboard',
  label: 'Orders (fictional)',
  origins: ['https://orders.example'],
  testMode: '^/test/',
  contract: toJson(contract) as unknown as Record<string, unknown>,
  anchors: {
    sidebar: { match: [{ role: 'navigation' }] },
    main: { match: [{ role: 'main' }] },
    notices: { required: true, match: [{ role: 'alert' }] },
    ...Object.fromEntries(
      sidebar.map((id) => [
        id,
        {
          within: 'sidebar',
          match: [{ href: links[id][1] }, { role: 'link', name: [links[id][0]] }],
        },
      ]),
    ),
  },
  routes: [
    { path: `${mode}home/?$`, route: 'home' },
    { path: `${mode}orders/(?<id>ord_\\w+)/?$`, route: 'order' },
    { path: `${mode}orders/?$`, route: 'orders' },
  ],
  lists: {
    sidebar: { container: 'sidebar', items: Object.fromEntries(sidebar.map((id) => [id, id])) },
  },
  regions: { 'home.original': { anchor: 'main' } },
  pages: { home: { route: 'home', region: 'home.original' } },
  connectors: {
    orders: {
      label: 'Orders API',
      base: 'https://api.orders.example',
      keys: { test: '^ok_test_', live: '^ok_live_' },
      sources: { orders: { path: '/orders', rows: '/data', permission: 'Orders: read' } },
      rate: { perSecond: 5, concurrent: 2 },
    },
  },
};
