import { UitiveProvider, Confirmations } from '@plurid/uitive-react';
import { uitive } from './client.js';
import { kit } from './kit.js';
import { OrdersPage } from './orders-page.js';

// #region provider
export function Admin() {
  return (
    <UitiveProvider client={uitive} kit={kit}>
      {/* Buttons and destructive runs wait for it; a form showing every value is the yes. */}
      <Confirmations />
      <OrdersPage />
    </UitiveProvider>
  );
}
// #endregion
