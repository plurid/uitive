import { query, ui } from '@plurid/uitive-core';
import { uitive } from './client.js';

// #region redesign
const fields = [
  'orders.number',
  'orders.total',
  'orders.currency',
  'orders.customer.name',
  'orders.placed',
];

export const needsAttention = ui.page(
  ui.section('Needs attention', 'stack', [
    ui.block('metric', { data: 'waiting', label: 'Paid, not shipped', compare: 'none' }),
    ui.block('table', {
      data: 'oldest',
      columns: ['orders.number', 'orders.total', 'orders.customer.name', 'orders.placed'],
      lookups: [],
      rowActions: [{ action: 'orders.cancel', set: [] }],
      density: 'compact',
      link: 'entity',
    }),
  ]),
  [
    {
      name: 'waiting',
      query: query('orders', {
        filter: [{ field: 'orders.status', op: 'eq', values: ['paid'] }],
        aggregate: { measure: 'count' },
      }),
    },
    {
      name: 'oldest',
      query: query('orders', {
        fields,
        filter: [{ field: 'orders.status', op: 'eq', values: ['paid'] }],
        sort: [{ field: 'orders.placed', direction: 'asc' }],
        limit: 10,
      }),
    },
  ],
);
// #endregion

// #region apply
/** The person's own redesign: policy checks it like any plan, and Revert brings the page back. */
export function redesignOrders() {
  return uitive.setPage('orders', needsAttention);
}
// #endregion
