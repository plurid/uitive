import { query } from '@plurid/uitive-core';
import { useQuery } from '@plurid/uitive-react';
import { uitive } from './client.js';

// #region query
const unshipped = query('orders', {
  fields: ['orders.number', 'orders.total', 'orders.currency', 'orders.customer.name'],
  filter: [
    { field: 'orders.status', op: 'eq', values: ['paid'] },
    { field: 'orders.placed', op: 'lt', values: ['-2d'] },
  ],
  sort: [{ field: 'orders.placed', direction: 'asc' }],
  limit: 10,
});
// #endregion

// #region component
/** Orders paid more than two days ago and not shipped, read with the person's own session. */
export function Unshipped() {
  const entry = useQuery(uitive, unshipped);
  if (!entry.result) return <p role="status">{entry.error ?? 'Loading'}</p>;
  return (
    <ul>
      {entry.result.rows.map((row) => (
        <li key={String(row['orders.number'])}>
          Order {String(row['orders.number'])} for {String(row['orders.customer.name'])}
        </li>
      ))}
    </ul>
  );
}
// #endregion
