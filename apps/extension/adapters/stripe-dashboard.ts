import { action, defineApp, list, page, route, toJson, ui } from '@plurid/uitive-core';
import type { AdapterInput } from '@plurid/uitive-adapter';
import { endpoints, sources } from './stripe/api.generated.ts';

// Hrefs and names are guesses until checked on the real dashboard, in test mode. Paths may start
// with /test/ in test mode, so every pattern allows it.
const mode = '^/(test/)?';

const sidebar = [
  ['nav.home', 'Home', `${mode}dashboard/?$`, ['Home', 'Accueil', 'Startseite']],
  ['nav.balances', 'Balances', `${mode}balance(/overview)?/?$`, ['Balances', 'Soldes', 'Salden']],
  ['nav.transactions', 'Transactions', `${mode}payments/?$`, ['Transactions', 'Transaktionen']],
  ['nav.customers', 'Customers', `${mode}customers/?$`, ['Customers', 'Clients', 'Kunden']],
  [
    'nav.products',
    'Product catalog',
    `${mode}products`,
    ['Product catalog', 'Catalogue de produits', 'Produktkatalog'],
  ],
  ['nav.connect', 'Connect', `${mode}connect`, ['Connect']],
  ['nav.billing', 'Billing', `${mode}billing`, ['Billing', 'Facturation', 'Abrechnung']],
  [
    'nav.reporting',
    'Reporting',
    `${mode}(reports|reporting)`,
    ['Reporting', 'Rapports', 'Berichte'],
  ],
] as const;

export const contract = defineApp({
  id: 'stripe-dashboard',
  version: '1',
  description:
    "A payments dashboard, as the extension sees it: its sidebar, its pages, and data from the payments API with the person's own restricted key.",
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
      label: 'Transactions as they are',
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
    balances: route({ path: '/balance/overview' }),
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
      label: 'Transactions',
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
  charges: 'Charges and refunds: read',
  refunds: 'Charges and refunds: read',
  customers: 'Customers: read',
  disputes: 'Disputes: read',
  payouts: 'Payouts: read',
  'balance-transactions': 'Balance: read',
  invoices: 'Invoices: read',
  subscriptions: 'Subscriptions: read',
};

export const adapter: AdapterInput = {
  format: 'uitive.adapter',
  formatVersion: 1,
  id: 'stripe-dashboard',
  label: 'Stripe Dashboard',
  origins: ['https://dashboard.stripe.com'],
  contract: toJson(contract) as unknown as Record<string, unknown>,
  anchors: {
    sidebar: {
      match: [
        { role: 'navigation', name: ['Main', 'Navigation', 'Sidebar'] },
        { role: 'navigation' },
      ],
    },
    main: { match: [{ role: 'main' }] },
    notices: { required: true, match: [{ role: 'alert' }] },
    ...Object.fromEntries(
      sidebar.map(([id, , href, names]) => [
        id,
        { within: 'sidebar', match: [{ href }, { role: 'link', name: [...names] }] },
      ]),
    ),
  },
  routes: [
    { path: `${mode}dashboard/?$`, route: 'home' },
    { path: `${mode}payments/(?<id>(ch|py|pi)_\\w+)/?$`, route: 'payment' },
    { path: `${mode}payments/?$`, route: 'payments' },
    { path: `${mode}customers/(?<id>cus_\\w+)/?$`, route: 'customer' },
    { path: `${mode}customers/?$`, route: 'customers' },
    { path: `${mode}balance(/overview)?/?$`, route: 'balances' },
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
    stripe: {
      label: 'Stripe API',
      base: 'https://api.stripe.com',
      keys: { test: '^rk_test_', live: '^rk_live_' },
      testMode: '^/test/',
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
