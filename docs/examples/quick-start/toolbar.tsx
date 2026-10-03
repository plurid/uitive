import { useState } from 'react';
import { useSurface } from '@plurid/uitive-react';
import { uitive } from './client.js';

/** The toolbar each person shaped: what fits, then the rest under More. */
export function Toolbar({ run }: { run(action: string): void }) {
  const toolbar = useSurface(uitive, 'toolbar');
  const [more, setMore] = useState(false);
  return (
    <div role="toolbar" aria-label="Formatting">
      {toolbar.visible.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            uitive.record(item.id, { via: 'region', surface: 'toolbar' });
            run(item.id);
          }}
        >
          {item.label}
        </button>
      ))}
      {toolbar.overflow.length > 0 && (
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)}>
          More
        </button>
      )}
      {more && (
        <div role="menu">
          {toolbar.overflow.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setMore(false);
                uitive.record(item.id, { via: 'overflow', surface: 'toolbar' });
                run(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
