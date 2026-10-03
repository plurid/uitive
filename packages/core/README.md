# @plurid/aptuitive-core

The engine of Aptuitive: an application declares a typed contract of what may adapt, and each person's interface learns from their use and changes when they ask, within it. Planners propose, policy decides what applies and when, and the person owns the result: every change is listed with its reason and can be kept, reverted or exported. Runs anywhere, with no DOM or Node APIs.

```sh
pnpm add @plurid/aptuitive-core zod
```

Aptuitive is a preview and not yet published: until it is, install it from the repository's tarballs, as [Getting started](https://github.com/plurid/aptuitive/blob/master/docs/getting-started.md#install) shows. Declare what may adapt, such as a notes editor's toolbar:

<!-- example: docs/examples/quick-start/contract.ts -->

```ts
import { action, defineApp, list } from '@plurid/aptuitive-core';

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

Then create a client for each person, with a store for their interface:

<!-- example: docs/examples/quick-start/client.ts -->

```ts
import { createAptuitive, localStore } from '@plurid/aptuitive-core';
import { contract } from './contract.js';

// Learns from use and changes when asked; the person's interface is kept in this browser.
export const aptuitive = createAptuitive({
  contract,
  store: localStore('notes'),
});
```

Draw `aptuitive.surface('toolbar')` with your own components, record each use with `aptuitive.record`, and let people ask with `aptuitive.ask('hide Bold')`.

- **Without a key**, the deterministic planner answers plain commands and learns from use, offline.
- **Data**: sources declared with the `field` helpers, read through the bindings' `fetch` with the person's own permissions. Queries are data, and core pushes down what the binding can do; `restFetch` and `restPerform` take REST endpoints as data.
- **Actions that run** declare an `effect`: writes wait for the person's yes, destructive ones for a typed phrase.
- **Claude** plans on your server: `remotePlanner` calls [`@plurid/aptuitive-server`](https://github.com/plurid/aptuitive/blob/master/packages/server/README.md).

It needs zod 4.2 or later, shared with the application. Read the [guides](https://github.com/plurid/aptuitive/blob/master/README.md#documentation), starting with [Contracts](https://github.com/plurid/aptuitive/blob/master/docs/contracts.md) and [Data and actions](https://github.com/plurid/aptuitive/blob/master/docs/data-and-actions.md), and the [API reference](https://github.com/plurid/aptuitive/blob/master/docs/api/core.md). MIT licensed.
