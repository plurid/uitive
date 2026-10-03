import {
  action,
  block,
  defineApp,
  field,
  list,
  page,
  route,
  source,
  ui,
} from '@plurid/aptuitive-core';
import { z } from 'zod';

// #region sources
export const sources = {
  orders: source({
    label: 'Orders',
    description: 'Orders customers placed, with their total and where they are in fulfilment',
    keywords: ['sales', 'purchases'],
    row: z.object({
      id: z.string(),
      number: z.number(),
      total: field.money({ currency: 'currency' }),
      currency: z.string(),
      status: field.enum(['pending', 'paid', 'shipped', 'cancelled']),
      placed: field.time(),
      customer: field.ref('customers'),
    }),
    key: 'id',
    title: 'number',
    summary: ['total', 'status'],
    // What the API does itself; Aptuitive does the rest on the client.
    capabilities: {
      filter: { status: ['eq', 'in'], placed: ['gte', 'lt'], customer: ['eq'] },
      sort: ['placed'],
      pagination: 'offset',
    },
  }),
  customers: source({
    label: 'Customers',
    description: 'People who order from the shop',
    row: z.object({ id: z.string(), name: z.string(), email: z.string() }),
    key: 'id',
    title: 'name',
    capabilities: { search: true },
  }),
};
// #endregion

// #region actions
const actions = {
  'go.orders': action({ label: 'Orders', description: 'Every order' }),
  'go.customers': action({ label: 'Customers', description: 'Everyone who orders' }),
  'orders.note': action({
    label: 'Add note',
    description: 'Adds a note to an order, for the team',
    params: z.object({ order: field.ref('orders'), text: z.string() }),
    effect: 'write',
    invalidates: ['orders'],
  }),
  'orders.cancel': action({
    label: 'Cancel order',
    description: 'Cancels an order that has not shipped, and refunds the customer',
    params: z.object({ order: field.ref('orders') }),
    effect: 'destructive',
    when: [{ field: 'orders.status', op: 'in', values: ['pending', 'paid'] }],
    invalidates: ['orders'],
  }),
};
// #endregion

// #region block
// One of the application's own components, offered to redesigns with typed props.
export const orderBlocks = {
  fulfilment: block({
    label: 'Fulfilment',
    description: "Where an order is in fulfilment, and what's next",
    props: z.object({ detailed: z.boolean() }),
  }),
};
// #endregion

// #region contract
export const shop = defineApp({
  id: 'shop-admin',
  description: 'The admin of an online shop: orders, customers and fulfilment',
  sources,
  actions,
  regions: {
    orders: { label: 'Orders', description: 'The orders list, as it is' },
    order: { label: 'Order', description: 'One order, as it is', entity: 'orders' },
  },
  routes: {
    orders: route({ path: '/orders', page: 'orders', action: 'go.orders' }),
    order: route({ path: '/orders/:id', entity: 'orders', page: 'order' }),
    customers: route({ path: '/customers', action: 'go.customers' }),
  },
  surfaces: {
    navigation: list({
      label: 'Navigation',
      description: 'The sidebar',
      items: ['go.orders', 'go.customers'],
      capacity: 2,
    }),
    // Every page starts as itself: one region, so the application looks exactly as before.
    orders: page({})({
      label: 'Orders',
      description: 'The orders to fulfil and follow up',
      standard: () => ui.page(ui.region('orders')),
    }),
    order: page(orderBlocks)({
      label: 'Order',
      description: 'One order, and what to do with it',
      entity: 'orders',
      standard: () => ui.page(ui.region('order')),
    }),
  },
});
// #endregion
