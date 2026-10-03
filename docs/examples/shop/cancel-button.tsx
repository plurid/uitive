import { useAction } from '@plurid/uitive-react';
import { uitive } from './client.js';

// #region action
/** The application's own button: it asks in its own way, and each run counts as use. */
export function CancelButton({ order }: { order: string }) {
  const cancel = useAction(uitive, 'orders.cancel');
  return (
    <button
      type="button"
      onClick={() => {
        if (window.confirm(`Cancel order ${order}?`)) void cancel({ order });
      }}
    >
      Cancel order
    </button>
  );
}
// #endregion
