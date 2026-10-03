# @plurid/uitive-react

React bindings for Uitive: a provider, hooks that re-render only when what they read changes, a page renderer and the generic blocks, drawn with a kit you map to your design system.

```sh
pnpm add @plurid/uitive-core @plurid/uitive-react zod
```

Draw a list from the person's interface with your own components:

<!-- example: docs/examples/quick-start/toolbar.tsx -->

```tsx
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
```

Then mount the provider once, with the banner that says what changed and "Your interface", where people keep or revert each change:

<!-- example: docs/examples/quick-start/app.tsx -->

```tsx
import { UitiveBanner, UitiveProvider, UitiveYourInterface } from '@plurid/uitive-react';
import { Ask } from './ask.js';
import { uitive } from './client.js';
import { Toolbar } from './toolbar.js';

export function Editor({ run }: { run(action: string): void }) {
  return (
    <UitiveProvider client={uitive}>
      <Toolbar run={run} />
      <Ask />
      {/* What just changed and why, with Revert and Keep; and every change, owned by the person. */}
      <UitiveBanner client={uitive} />
      <UitiveYourInterface client={uitive} />
    </UitiveProvider>
  );
}
```

- `useSurface(client, id)` gives a list's visible and overflow actions, a choice's value, a collection, or a page for `Page` to draw.
- `useCommand(client)` runs a request in the person's own words; `useAction(client, id)` runs the application's own controls through Uitive, so their use counts.
- `useQuery(client, query)` reads data, shared and cached; `useUitiveRouter(client, { path, navigate })` connects any router.
- `createKit({ Button, Table, Dialog, values: { money } })` swaps in your design system's parts, one at a time.
- `<Confirmations />` asks before a generated page changes data.

It needs React 18.3 or 19, and zod 4.2 or later. Read the [React guide](https://github.com/plurid/uitive/blob/master/docs/react.md), [Pages](https://github.com/plurid/uitive/blob/master/docs/pages.md) and the [API reference](https://github.com/plurid/uitive/blob/master/docs/api/react.md). MIT licensed.
