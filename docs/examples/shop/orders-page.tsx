import { Page, useSurface } from '@plurid/aptuitive-react';
import { aptuitive } from './client.js';

/** Stands for the application's own orders page, which stays exactly as it is. */
function OrdersList() {
  return <p>The orders list the application already has.</p>;
}

// #region page
export function OrdersPage() {
  const value = useSurface(aptuitive, 'orders');
  return <Page value={value} blocks={{}} regions={{ orders: OrdersList }} />;
}
// #endregion
