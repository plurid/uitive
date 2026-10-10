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
      customers: {
        path: '/customers',
        rows: '/customers',
        search: 'q',
        filters: { 'id:in': 'id' },
        pagination: { kind: 'offset', param: 'offset' },
      },
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
  // Who is signed in, for `$me`, and where they are, for "today" and time buckets.
  context: () => ({
    me: signedIn(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
};
// #endregion

/** The signed-in person's ID, as the page serving the admin writes it; none outside a page. */
function signedIn(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.querySelector<HTMLMetaElement>('meta[name="user"]')?.content;
}
