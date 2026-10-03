import { AptuitiveProvider, Confirmations } from '@plurid/aptuitive-react';
import { aptuitive } from './client.js';
import { kit } from './kit.js';
import { OrdersPage } from './orders-page.js';

// #region provider
export function Admin() {
  return (
    <AptuitiveProvider client={aptuitive} kit={kit}>
      {/* Asks before anything changes data; without it, generated pages can't write at all. */}
      <Confirmations />
      <OrdersPage />
    </AptuitiveProvider>
  );
}
// #endregion
