import { z } from 'zod';
import { action, defineApp, list, page } from '../contract.js';
import { field } from '../field.js';
import { ui } from '../page.js';
import { route } from '../route.js';
import { source } from '../source.js';

/** 2026-10-03 12:00 UTC, in seconds: the fixture's "now". */
export const NOW = Date.UTC(2026, 9, 3, 12) / 1000;
const DAY = 86_400;

export const sources = {
  payments: source({
    label: 'Payments',
    description: 'Every charge, with its amount, status and customer',
    keywords: ['charges', 'transactions', 'revenue'],
    row: z.object({
      id: z.string(),
      amount: field.money({ currency: 'currency', minor: true }),
      currency: z.string(),
      status: field.enum(['succeeded', 'pending', 'failed']),
      created: field.time({ unit: 's' }),
      customer: field.ref('customers').nullable(),
      description: z.string(),
      refunded: z.boolean(),
    }),
    key: 'id',
    title: 'description',
    summary: ['amount', 'status'],
    capabilities: {
      filter: { created: ['gte', 'lt'], customer: ['eq'], status: ['eq'] },
      sort: ['created'],
      pagination: 'cursor',
    },
    maxLimit: 100,
  }),
  customers: source({
    label: 'Customers',
    description: 'People and businesses who pay',
    row: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      country: z.string(),
      created: field.time({ unit: 's' }),
    }),
    key: 'id',
    title: 'name',
    summary: ['name', 'email'],
    capabilities: { filter: { email: ['eq'] } },
  }),
  disputes: source({
    label: 'Disputes',
    description: 'Chargebacks needing evidence, or decided',
    keywords: ['chargebacks'],
    row: z.object({
      id: z.string(),
      amount: field.money({ currency: 'currency', minor: true }),
      currency: z.string(),
      status: field.enum(['needs_response', 'under_review', 'won', 'lost']),
      payment: field.ref('payments'),
      created: field.time({ unit: 's' }),
    }),
    key: 'id',
  }),
  payouts: source({
    label: 'Payouts',
    description: 'Money sent to the bank account',
    row: z.object({
      id: z.string(),
      amount: field.money({ code: 'usd', minor: true }),
      status: field.enum(['paid', 'pending', 'in_transit', 'failed']),
      arrival: field.time({ unit: 's', label: 'Arrival date' }),
    }),
    key: 'id',
    summary: ['amount', 'status'],
  }),
};

export const payments = defineApp({
  id: 'payments-dashboard',
  description: 'A payments dashboard: charges, customers, disputes and payouts',
  actions: {
    'go.home': action({ label: 'Home', description: 'The overview' }),
    'go.payments': action({ label: 'Payments', description: 'Every charge' }),
    'go.customers': action({ label: 'Customers', description: 'Everyone who pays' }),
    'go.disputes': action({ label: 'Disputes', description: 'Chargebacks' }),
    'go.payouts': action({ label: 'Payouts', description: 'Money sent to the bank' }),
    refund: action({
      label: 'Refund payment',
      description: 'Returns the whole amount to the customer',
      params: z.object({
        payment: field.ref('payments'),
        reason: field.enum(['duplicate', 'fraudulent', 'requested_by_customer']),
      }),
      effect: 'destructive',
      when: [{ field: 'payments.status', op: 'eq', values: ['succeeded'] }],
      invalidates: ['payments'],
    }),
    'note.add': action({
      label: 'Add note',
      description: 'Adds a note to a payment',
      params: z.object({ payment: field.ref('payments'), text: z.string() }),
      effect: 'write',
    }),
    export: action({
      label: 'Export payments',
      description: 'Downloads payments as a spreadsheet',
      effect: 'read',
    }),
  },
  sources,
  regions: {
    original: { label: 'Original page', description: 'The page as the dashboard ships it' },
  },
  routes: {
    home: route({ path: '/', page: 'home', action: 'go.home' }),
    payments: route({ path: '/payments', action: 'go.payments' }),
    payment: route({ path: '/payments/:id', entity: 'payments', page: 'payment' }),
    customer: route({ path: '/customers/:id', entity: 'customers', page: 'customer' }),
  },
  surfaces: {
    home: page({})({
      label: 'Home',
      description: 'The first page',
      standard: () => ui.page(ui.section('', 'stack', [ui.region('original')])),
    }),
    payment: page({})({
      label: 'Payment',
      description: 'One payment',
      entity: 'payments',
      standard: () => ui.page(ui.section('', 'stack', [ui.region('original')])),
    }),
    customer: page({})({
      label: 'Customer',
      description: 'One customer',
      entity: 'customers',
      standard: () => ui.page(ui.section('', 'stack', [ui.region('original')])),
    }),
    nav: list({
      label: 'Sidebar',
      description: 'Main navigation',
      items: ['go.home', 'go.payments', 'go.customers', 'go.disputes', 'go.payouts'],
      capacity: 5,
      required: ['go.home'],
    }),
  },
});

const customerIds = [
  'cus_ada',
  'cus_bo',
  'cus_cy',
  'cus_di',
  'cus_ed',
  'cus_fi',
  'cus_gu',
  'cus_hu',
];

export const rows = {
  customers: customerIds.map((id, index) => ({
    id,
    name: `Customer ${id.slice(4)}`,
    email: `${id.slice(4)}@example.com`,
    country: index % 3 === 0 ? 'FR' : 'US',
    created: NOW - (100 + index * 10) * DAY,
  })),
  payments: Array.from({ length: 40 }, (_, index) => ({
    id: `ch_${String(index).padStart(3, '0')}`,
    amount: 1000 + ((index * 737) % 9000),
    currency: index % 10 === 7 ? 'jpy' : index % 10 === 3 ? 'eur' : 'usd',
    status: (index % 6 === 0 ? 'failed' : index % 9 === 4 ? 'pending' : 'succeeded') as
      'succeeded' | 'pending' | 'failed',
    created: NOW - index * 1.5 * DAY,
    customer: index % 11 === 10 ? null : (customerIds[index % customerIds.length] as string),
    description: `Order ${1000 + index}`,
    refunded: index % 13 === 5,
  })),
  disputes: [
    {
      id: 'dp_1',
      amount: 2474,
      currency: 'usd',
      status: 'needs_response' as const,
      payment: 'ch_002',
      created: NOW - 2 * DAY,
    },
    {
      id: 'dp_2',
      amount: 5685,
      currency: 'usd',
      status: 'under_review' as const,
      payment: 'ch_006',
      created: NOW - 9 * DAY,
    },
    {
      id: 'dp_3',
      amount: 9370,
      currency: 'usd',
      status: 'won' as const,
      payment: 'ch_012',
      created: NOW - 20 * DAY,
    },
  ],
  payouts: [
    { id: 'po_1', amount: 120000, status: 'paid' as const, arrival: NOW - 7 * DAY },
    { id: 'po_2', amount: 98000, status: 'paid' as const, arrival: NOW - 14 * DAY },
    { id: 'po_3', amount: 143500, status: 'in_transit' as const, arrival: NOW + DAY },
  ],
};
