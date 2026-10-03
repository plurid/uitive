import { UitiveProvider, Confirmations } from '@plurid/uitive-react';
import { uitive } from './client.js';
import { kit } from './kit.js';
import { OrdersPage } from './orders-page.js';

// #region provider
export function Admin() {
  return (
    <UitiveProvider client={uitive} kit={kit}>
      {/* Asks before anything changes data; without it, generated pages can't write at all. */}
      <Confirmations />
      <OrdersPage />
    </UitiveProvider>
  );
}
// #endregion
