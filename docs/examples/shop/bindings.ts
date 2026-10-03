import { restFetch, restPerform, type Bindings } from '@plurid/uitive-core';
import type { shop } from './contract.js';

// #region bindings
// Reads and writes as the signed-in person, with the application's own session cookie.
export const bindings: Bindings<typeof shop> = {
  fetch: restFetch({
    base: '/api',
    credentials: 'include',
    sources: {
      orders: {
        path: '/orders',
        rows: '/orders',
        filters: {
          'status:eq': 'status',
          'status:in': 'status',
          'placed:gte': 'placed_after',
          'placed:lt': 'placed_before',
          'customer:eq': 'customer',
        },
        sort: { param: 'order', format: '-field' },
        pagination: { kind: 'offset', param: 'offset' },
        item: { path: '/orders/{id}', row: '/order' },
      },
      customers: { path: '/customers', rows: '/customers', search: 'q' },
    },
  }),
  perform: restPerform({
    base: '/api',
    credentials: 'include',
    actions: {
      'orders.note': { method: 'POST', path: '/orders/{order}/notes' },
      'orders.cancel': { method: 'POST', path: '/orders/{order}/cancel' },
    },
  }),
};
// #endregion
