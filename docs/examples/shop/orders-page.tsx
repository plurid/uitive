import { Page, useSurface } from '@plurid/uitive-react';
import { uitive } from './client.js';

/** Stands for the application's own orders page, which stays exactly as it is. */
function OrdersList() {
  return <p>The orders list the application already has.</p>;
}

// #region page
export function OrdersPage() {
  const value = useSurface(uitive, 'orders');
  return <Page value={value} blocks={{}} regions={{ orders: OrdersList }} />;
}
// #endregion
