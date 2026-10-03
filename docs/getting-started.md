# Getting started

Uitive needs three things: a contract that says what may adapt, a client that holds each person's interface, and an interface drawn from that client. This guide builds the smallest complete integration, a notes editor's toolbar in React that learns from use and changes when asked. [Without React](without-react.md) does the same for any other page, and [Coding agents](coding-agents.md) has an agent do these steps for you.

## Install

Uitive needs React 18.3 or 19 for its React bindings, zod 4.2 or later, and Node 22 or later for its tools.

```sh
pnpm add @plurid/uitive-core @plurid/uitive-react zod
```

Or let `init` install them, and write a starting folder too:

```sh
npx @plurid/uitive-cli init
```

It writes `contract.ts`, `bindings.ts` and `client.ts` into `src/uitive/` (or `uitive/` when there is no `src`), and `kit.tsx` with React. The steps below fill them in for a notes editor: replace `contract.ts` with the contract below, keep `bindings.ts` and `client.ts`, and put the components with your application's own. The examples keep every file in one folder and import with `.js` extensions, which TypeScript resolves to `.ts` files under `"moduleResolution": "bundler"` or `"nodenext"`.

## Declare a contract

The contract is the boundary: everything a person or a model may change, and nothing else. This one declares eight actions and a toolbar that shows up to five of them, with the rest under More and Share always shown. It goes in `contract.ts`, replacing the one `init` wrote, if you ran it.

<!-- example: docs/examples/quick-start/contract.ts -->

```ts
import { action, defineApp, list } from '@plurid/uitive-core';

export const contract = defineApp({
  id: 'notes',
  description: 'A notes editor',
  actions: {
    bold: action({ label: 'Bold', description: 'Make the selection bold' }),
    italic: action({ label: 'Italic', description: 'Make the selection italic' }),
    link: action({ label: 'Link', description: 'Link the selection' }),
    heading: action({ label: 'Heading', description: 'Turn the line into a heading' }),
    share: action({ label: 'Share', description: 'Share the note' }),
    quote: action({ label: 'Quote', description: 'Turn the paragraph into a quote' }),
    code: action({ label: 'Code', description: 'Format the selection as code' }),
    table: action({ label: 'Table', description: 'Insert a table' }),
  },
  surfaces: {
    toolbar: list({
      label: 'Toolbar',
      description: 'Formatting and insertion, above the note',
      items: ['bold', 'italic', 'link', 'heading', 'share', 'quote', 'code', 'table'],
      capacity: 5,
      required: ['share'],
      reorderable: true,
    }),
  },
});
```

Labels and descriptions are written for people and for models alike: they are how a request such as "hide Bold" finds its action. Action IDs are lowercase, with dots, colons or dashes; surface names are camelCase. [Contracts](contracts.md) covers every kind of surface.

## Create a client

A client holds one person's interface: how they use the application, what they changed, and what the system learned. Its store keeps that between visits; `localStore` keeps it in the browser. The `client.ts` that `init` writes creates one, with bindings for later; with this contract, it amounts to this:

<!-- example: docs/examples/quick-start/client.ts -->

```ts
import { createUitive, localStore } from '@plurid/uitive-core';
import { contract } from './contract.js';

// Learns from use and changes when asked; the person's interface is kept in this browser.
export const uitive = createUitive({
  contract,
  store: localStore('notes'),
});
```

With no planner given, the client plans with the deterministic planner: it answers plain commands and learns from use, offline, with no model and no key. [Planning](planning.md) adds a language model, from any provider, on your server.

## Draw the toolbar

`useSurface` gives the toolbar as this person has it: the actions that show, then those in overflow. Draw them with your own components, and record each use with how it was reached. `run` is your editor's own handler, what Bold does in your editor, which Uitive never needs to know.

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

How an action was reached is what learning reads. An action someone keeps digging out of More is one they'd rather see; an action that sits unused gives way to it.

## Let people ask

`useCommand` runs a request in the person's own words.

<!-- example: docs/examples/quick-start/ask.tsx -->

```tsx
import { useState, type FormEvent } from 'react';
import { useCommand } from '@plurid/uitive-react';
import { uitive } from './client.js';

/** Where people ask for a change in their own words; the banner says what happened. */
export function Ask() {
  const { ask, pending } = useCommand(uitive);
  const [text, setText] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await ask(text);
    setText('');
  };
  return (
    <form onSubmit={submit}>
      <input
        aria-label="Ask for a change"
        placeholder='Try "hide Bold" or "move Table to the top"'
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" disabled={pending}>
        Ask
      </button>
    </form>
  );
}
```

The ask box shows nothing itself: the banner, in the next step, says what happened. Without a model, these work: `hide …`, `show …` or `pin …` (after a hide, `show` undoes it), `unpin …`, `restore …`, `move … to the top` or `to the end` (out of More, if need be), a choice's value (`dark`, `use the dark theme`), and on pages, `reset the page`. Each answers with a status:

| Status        | What it means                                                       |
| ------------- | ------------------------------------------------------------------- |
| `done`        | The change applied, or nothing needed to change.                    |
| `partial`     | Some of it applied; the rest was refused, with reasons.             |
| `not_allowed` | Policy refused it, such as hiding Share, which is always shown.     |
| `ambiguous`   | The words fit several actions; the result lists them.               |
| `unsupported` | The deterministic planner doesn't understand it; a model might.     |
| `unavailable` | The model planner couldn't be reached, and nothing else could help. |

## Show what changed

Every change belongs to the person: they can see it, keep it or revert it. `<UitiveBanner>` says what just changed and why, with Revert, and Keep for changes the person didn't make themselves; `<UitiveYourInterface>` lists every change, with export, import and reset.

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

The banner floats at the bottom right of the page; add `docked` to place it in the page's flow. "Your interface" is a panel, for a settings page or a side panel. Both render in shadow roots, styled with CSS custom properties: see [React](react.md#the-meta-interface).

`UitiveProvider` also keeps the person's state across tab switches and visits: usage is saved when the page is hidden, and a new session starts when they come back after a while.

## Run it

Render the editor where your application starts, with your own `run`:

<!-- example: docs/examples/quick-start/main.tsx -->

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from './app.js';

// What each action does in your editor; this one only says which ran.
const run = (action: string) => console.log(`${action} ran`);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Editor run={run} />
    </StrictMode>,
  );
}
```

Start the development server and ask for "hide Bold": Bold moves under More, and the banner says so. Reload, and the change stays; Revert in the banner brings Bold back.

## Watch it learn

The provider plans from use once a session, as it starts, and what policy accepts waits for the next safe moment: the start of the session after. Nothing moves while someone works. Reach for Table under More a couple of times, and come back after a break: Uitive plans from that use. Come back once more, and Table is on the toolbar. "Your interface" lists the change with its reason and Revert; the banner announces it too when it applies while the page is open, as when the person returns to a tab, but not when they load the page afresh.

A session ends after 30 minutes without use (`idleMinutes`). [Testing](testing.md) shows the same in a test, session by session, and [How it works](how-it-works.md) explains the rules.

## Check it

`uitive check` loads the contract and bindings and checks they hold: IDs, the JSON form, request schemas a model can answer in, labels and bindings. It prints what the contract covers, and exits with 1 when something fails, so it belongs in CI. It loads the modules without typechecking them, so run `tsc` too.

```sh
npx uitive check
```

## Next

- [Data and actions](data-and-actions.md): sources the interface can show, and actions that change data, with confirmation.
- [Pages](pages.md): whole pages people can redesign, from generic blocks on your data.
- [Planning](planning.md): requests in plain words, planned by a model of your choice on your server.
- [React](react.md): every hook, the page renderer and the kit.
