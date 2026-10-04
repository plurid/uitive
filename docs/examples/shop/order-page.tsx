import { Page, useSurface, type BlockComponents } from '@plurid/uitive-react';
import { uitive } from './client.js';
import type { orderBlocks } from './contract.js';

/** Stands for the application's own order page, which stays exactly as it is. */
function OrderDetail() {
  return <p>The order page the application already has.</p>;
}

// #region blocks
/** The application's components behind the order page's blocks, typed by their props. */
const blocks: BlockComponents<typeof orderBlocks> = {
  fulfillment: ({ props }) => (
    <p>{props.detailed ? 'Picked and packed, not yet shipped' : 'Not yet shipped'}</p>
  ),
};

export function OrderPage() {
  const value = useSurface(uitive, 'order');
  return <Page value={value} blocks={blocks} regions={{ order: OrderDetail }} />;
}
// #endregion
