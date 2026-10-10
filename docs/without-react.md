# Without React

`@plurid/uitive-dom` brings Uitive to pages without React: it adapts the markup the application already renders, in place, and provides the meta-interface as custom elements. It works with any framework or none, such as GrainJS, Lit, Vue or a page rendered on the server. Grist, built on GrainJS, was integrated this way in 54 minutes: see [Findings](findings.md#run-3-grist-2026-10-03).

Lists, choices, commands and the meta-interface work without React. Pages, generic blocks and the kit are React only for now.

## Install

Install `@plurid/uitive-core`, `@plurid/uitive-dom` and zod 4.2 or later:

```sh
pnpm add @plurid/uitive-core @plurid/uitive-dom zod
```

Or run `npx uitive init`, which installs the DOM package when it finds no React. It also writes `contract.ts`, `bindings.ts` and `client.ts` into the Uitive folder: replace the contract with yours, as below, and keep the other two. Its contract starts with the home page as a region, which only React draws.

## Declare the list

The contract is the same as with React. Since the markup shows every item, give the list a capacity of all of them: then only people move items out, and the page looks exactly as before until someone does. `reorderable` lets people move items, as in "move Chart to the top".

<!-- example: docs/examples/without-react/contract.ts -->

```ts
import { action, defineApp, list } from '@plurid/uitive-core';

export const contract = defineApp({
  id: 'editor',
  description: 'A document editor',
  actions: {
    table: action({ label: 'Table', description: 'Insert a table' }),
    image: action({ label: 'Image', description: 'Insert an image' }),
    chart: action({ label: 'Chart', description: 'Insert a chart' }),
    divider: action({ label: 'Divider', description: 'Insert a divider' }),
    comment: action({ label: 'Comment', description: 'Comment on the selection' }),
  },
  surfaces: {
    // The markup shows every item, so the capacity is all of them: only people move items out.
    insert: list({
      label: 'Insert',
      description: 'What the Insert menu offers',
      items: ['table', 'image', 'chart', 'divider', 'comment'],
      capacity: 5,
      reorderable: true,
    }),
  },
});
```

## Mark the markup

Mark each list's container with `data-uitive-list` and each item in it with `data-uitive-item`, naming the action. Add `<uitive-more>` where moved-out items should be found, `<uitive-ask>` for requests, and `<uitive-banner>` to say what changed. This markup goes in your page, such as `index.html`; the container is a flex box, so the menu can be reordered.

<!-- example: docs/examples/without-react/menu.html -->

```html
<!-- A flex container, so the menu can be reordered. -->
<nav class="insert" data-uitive-list="insert" style="display: flex; gap: 0.25rem">
  <button type="button" data-uitive-item="table">Table</button>
  <button type="button" data-uitive-item="image">Image</button>
  <button type="button" data-uitive-item="chart">Chart</button>
  <button type="button" data-uitive-item="divider">Divider</button>
  <button type="button" data-uitive-item="comment">Comment</button>
  <uitive-more list="insert"></uitive-more>
</nav>
<uitive-ask></uitive-ask>
<uitive-banner></uitive-banner>
```

Add the attributes wherever the application builds the elements: in its templates, or in the calls that create them. Markup rendered later, such as a menu built when it opens, adapts too.

## Start

The client is the same as with React, as the `client.ts` that `init` writes creates it:

<!-- example: docs/examples/without-react/client.ts -->

```ts
import { createUitive, localStore } from '@plurid/uitive-core';
import { contract } from './contract.js';

// Learns from use and changes when asked;
// the person's interface is kept in this browser.
export const uitive = createUitive({ contract, store: localStore('editor') });
```

Then start Uitive once, from your page's entry script, such as `src/main.ts` importing `start.ts`. `startUitive` registers the elements and gives each one the client, adapts the marked markup, starts a new session when the person comes back after a while, plans each session from use once, and saves usage whenever the page is hidden or closed. It returns a function that undoes it all.

<!-- example: docs/examples/without-react/start.ts -->

```ts
import { startUitive } from '@plurid/uitive-dom';
import { uitive } from './client.js';

// Registers the elements, adapts the marked markup and keeps state across visits.
startUitive(uitive);
```

## How markup adapts

- **Items moved out are hidden** by one stylesheet, never removed, so the application's framework keeps its nodes. `<uitive-more list="…">` lists them; choosing one clicks the hidden original, so the application's own handler runs. When the original isn't in the page, `<uitive-more>` emits `uitive-open` with `detail.list` and `detail.action`, for the application to run.
- **Reordered lists** set CSS `order` on the container's children, which needs a flex or grid container. Otherwise the list can't reorder, and `onProblem` hears of it once (by default, `console.warn`). A container that is hidden at first, such as a closed menu's, gets its order anyway and is judged once it shows.
- **Order is visual only.** CSS `order` changes where items appear, not where they are in the markup, so keyboard focus and screen readers still follow the markup's order. That is the price of never moving the framework's nodes. Hiding items has no such cost, and the default capacity of every item moves nothing, so a page looks and reads as before until someone reorders it; for lists where focus order matters, draw them yourself from `client.surface(list)`, as below.
- **Clicks on items record use**, reached directly. Pass `record: false` when the application records use itself.
- **Shadow roots**: markup inside one, such as a Lit component's, adapts with `root` set to that shadow root, through `adaptMarkup(client, { root })`.

## Draw lists yourself

For markup the page draws itself, read the list from the client and draw it again whenever the client changes:

<!-- example: docs/examples/without-react/render.ts#render -->

```ts
const draw = () => {
  const buttons = uitive.surface('insert').visible.map((item) => {
    const button = document.createElement('button');
    button.textContent = item.label;
    button.addEventListener('click', () => {
      uitive.record(item.id, { via: 'region', surface: 'insert' });
      run(item.id);
    });
    return button;
  });
  menu.replaceChildren(...buttons);
};
draw();
return uitive.subscribe(draw);
```

`client.surface(list)` gives the `visible` actions, then those in `overflow`. Record each use with how it was reached, `region` or `overflow`.

## The elements

| Element                   | What it does                                                                              | Attributes      | Events                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `<uitive-ask>`            | Takes a request in the person's words, and says in a line what happened                   | `placeholder`   | `uitive-asked` (`detail.adaptation`)                                                         |
| `<uitive-banner>`         | Says what just changed and why, with Revert and Keep, and answers requests                | `docked`        | `uitive-dismiss` (`detail.adaptation`)                                                       |
| `<uitive-more>`           | Lists the items moved out of a list                                                       | `list`, `label` | `uitive-open` (`detail.list`, `detail.action`)                                               |
| `<uitive-confirm>`        | Asks before an action changes data                                                        |                 |                                                                                              |
| `<uitive-your-interface>` | Every change the person owns, with keep, revert, freeze, reset, export, import and forget |                 | `uitive-export` (`detail.document`), `uitive-import` (`detail.adaptation` or `detail.error`) |
| `<uitive-debug>`          | Usage, the planner's exact request, the definition and pending changes, for development   | `collapsed`     | `uitive-simulated` (`detail.persona`, `detail.reports`)                                      |

- Every element emits `uitive-error` (`detail.error`) when something it runs fails. Events bubble out of the shadow root.
- Each element uses the client `startUitive` gave every element, or its own `client` property when set.
- `<uitive-debug>` comes from `@plurid/uitive-dom/debug`, registered by `defineDebugElement()`, so production pages don't load it.
- `<uitive-more>` moves focus to its first item when it opens; the arrow keys, Home and End move between items, and Escape closes it.
- The elements style their shadow roots with constructed stylesheets, which a strict `style-src` policy allows.
- Without `startUitive`, `defineElements()` registers the elements, and `UitiveElement.useClient(client)` gives them the client.

## Confirmations

Place `<uitive-confirm>` once. While it is in the page, actions with effects that the application runs through `client.perform` wait for the person's answer: one step for a write, a typed phrase for a destructive run. Without it, they are refused. It asks in a modal dialog that shows every param, money in its own currency, holds focus while it is open, cancels on Escape and gives focus back when the run is answered. The application's own controls, which ask in their own way, pass `{ origin: 'native' }` to `perform`, so their runs count as use without asking twice.

## Styling

The elements render in shadow roots, styled through CSS custom properties: `--uitive-accent`, `--uitive-surface`, `--uitive-text`, `--uitive-muted`, `--uitive-border`, `--uitive-radius` and `--uitive-font`.

- `<uitive-banner>` floats at the bottom right; restyle `:host` to place it elsewhere, or add `docked` to put it in the page's flow, such as in the application's notification area.
- Each element's content is `::part(content)`, and the headings of `<uitive-banner>`, `<uitive-confirm>` and `<uitive-your-interface>` are `::part(heading)`, for hosts that title them in their own way.

## Requests in plain words

Without a planner, `<uitive-ask>` answers plain commands such as "hide Image" or "move Chart to the top". For requests in plain words, give the client a `remotePlanner` that calls your server: [Planning](planning.md).
