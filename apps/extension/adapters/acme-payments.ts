import { action, defineApp, list, page, route, toJson, ui } from '@plurid/uitive-core';
import type { AdapterInput } from '@plurid/uitive-adapter';
import { endpoints, sources } from './acme-payments/api.generated.ts';

// Acme Payments is fictional: the dashboard in tools/fixtures/payments-dashboard, whose API this
// adapter's sources are generated from. Test data lives under /test/, so every pattern allows it.
const mode = '^/(test/)?';

const sidebar = [
  ['nav.home', 'Home', `${mode}dashboard/?$`],
  ['nav.funds', 'Funds', `${mode}funds/?$`],
  ['nav.payments', 'Payments', `${mode}payments/?$`],
  ['nav.customers', 'Customers', `${mode}customers/?$`],
  ['nav.catalog', 'Catalog', `${mode}catalog`],
  ['nav.partners', 'Partners', `${mode}partners`],
  ['nav.invoices', 'Invoices', `${mode}invoices`],
  ['nav.reports', 'Reports', `${mode}reports`],
] as const;

export const contract = defineApp({
  id: 'acme-payments',
  version: '1',
  description:
    "A payments dashboard, as the extension sees it: its sidebar, its pages, and data from its API with the person's own read-only key.",
  sources,
  actions: Object.fromEntries(
    sidebar.map(([id, label]) => [
      id,
      action({ label, description: `Opens ${label} from the sidebar`, group: 'Sidebar' }),
    ]),
  ),
  regions: {
    'home.original': {
      label: 'Home as it is',
      description: "The dashboard's home page, unchanged",
    },
    'payments.original': {
      label: 'Payments as they are',
      description: 'The list of payments, unchanged',
    },
    'customer.original': {
      label: 'Customer page as it is',
      description: "One customer's page, unchanged",
      entity: 'customers',
    },
  },
  routes: {
    home: route({ path: '/dashboard', page: 'home' }),
    payments: route({ path: '/payments', page: 'payments' }),
    payment: route({ path: '/payments/:id', entity: 'charges', key: 'id' }),
    customers: route({ path: '/customers' }),
    customer: route({ path: '/customers/:id', entity: 'customers', key: 'id', page: 'customer' }),
    funds: route({ path: '/funds' }),
  },
  surfaces: {
    sidebar: list({
      label: 'Sidebar',
      description: 'The links down the side of the dashboard; links moved out wait in a More list',
      items: sidebar.map(([id]) => id),
      capacity: sidebar.length,
      reorderable: true,
    }),
    home: page({})({
      label: 'Home',
      description: 'The first page of the dashboard: anything the person wants to check first',
      standard: () => ui.page(ui.region('home.original')),
    }),
    payments: page({})({
      label: 'Payments',
      description: 'The payments page: the payments the person wants to see, and how',
      standard: () => ui.page(ui.region('payments.original')),
    }),
    customer: page({})({
      label: 'Customer page',
      description: "One customer's page, redesigned once for every customer",
      entity: 'customers',
      standard: () => ui.page(ui.region('customer.original')),
    }),
  },
});

const permissions: Record<string, string> = {
  charges: 'Payments: read',
  refunds: 'Payments: read',
  customers: 'Customers: read',
  disputes: 'Disputes: read',
  payouts: 'Funds: read',
  'balance-transactions': 'Funds: read',
  invoices: 'Invoices: read',
  subscriptions: 'Invoices: read',
};

export const adapter: AdapterInput = {
  format: 'uitive.adapter',
  formatVersion: 2,
  id: 'acme-payments',
  label: 'Acme Payments (fictional)',
  origins: ['https://dashboard.acme-payments.example'],
  testMode: '^/test/',
  examples: [
    'hide Partners and Invoices',
    'make my home a morning check of failed payments, disputes and payouts',
  ],
  contract: toJson(contract) as unknown as Record<string, unknown>,
  anchors: {
    sidebar: { match: [{ role: 'navigation', name: ['Main'] }, { role: 'navigation' }] },
    main: { match: [{ role: 'main' }] },
    notices: { required: true, match: [{ role: 'alert' }] },
    ...Object.fromEntries(
      sidebar.map(([id, label, href]) => [
        id,
        { within: 'sidebar', match: [{ href }, { role: 'link', name: [label] }] },
      ]),
    ),
  },
  routes: [
    { path: `${mode}dashboard/?$`, route: 'home' },
    { path: `${mode}payments/(?<id>ch_\\w+)/?$`, route: 'payment' },
    { path: `${mode}payments/?$`, route: 'payments' },
    { path: `${mode}customers/(?<id>cus_\\w+)/?$`, route: 'customer' },
    { path: `${mode}customers/?$`, route: 'customers' },
    { path: `${mode}funds/?$`, route: 'funds' },
  ],
  lists: {
    sidebar: { container: 'sidebar', items: Object.fromEntries(sidebar.map(([id]) => [id, id])) },
  },
  regions: {
    'home.original': { anchor: 'main' },
    'payments.original': { anchor: 'main' },
    'customer.original': { anchor: 'main' },
  },
  pages: {
    home: { route: 'home', region: 'home.original' },
    payments: { route: 'payments', region: 'payments.original' },
    customer: { route: 'customer', region: 'customer.original' },
  },
  connectors: {
    acme: {
      label: 'Acme API',
      base: 'https://api.acme-payments.example',
      auth: { header: 'x-acme-key', prefix: '' },
      keys: {
        test: '^acme_test_',
        live: '^acme_live_',
        refuse: [
          {
            pattern: '^acme_secret_',
            reason: 'Secret keys are refused: create a read-only key in Acme',
          },
        ],
        label: 'read-only key',
        hint: { test: 'acme_test_...', live: 'acme_live_...' },
      },
      sources: Object.fromEntries(
        Object.entries(endpoints.sources).map(([id, rest]) => [
          id,
          { ...rest, permission: permissions[id] ?? 'Read' },
        ]),
      ),
      rate: { perSecond: 5, concurrent: 2 },
    },
  },
};
