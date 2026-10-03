# Without React

`@plurid/aptuitive-dom` brings Aptuitive to pages without React: it adapts the markup the application already renders, in place, and provides the meta-interface as custom elements. It works with any framework or none, such as GrainJS, Lit, Vue or a page rendered on the server. Grist, built on GrainJS, was integrated this way in 54 minutes: see [Findings](findings.md#run-3-grist-2026-10-03).

Lists, choices, commands and the meta-interface work without React. Pages, generic blocks and the kit are React only for now.

## Install

Install `@plurid/aptuitive-core`, `@plurid/aptuitive-dom` and zod 4.2 or later. Until the packages are published, use the tarballs, as in [Getting started](getting-started.md#install); `aptuitive init` installs the DOM package when it finds no React. It also writes `contract.ts`, `bindings.ts` and `client.ts` into the Aptuitive folder: replace the contract with yours, as below, and keep the other two. Its contract starts with the home page as a region, which only React draws.

## Declare the list

The contract is the same as with React. Since the markup shows every item, give the list a capacity of all of them: then only people move items out, and the page looks exactly as before until someone does. `reorderable` lets people move items, as in "move Chart to the top".

<!-- example: docs/examples/without-react/contract.ts -->

```ts
import { action, defineApp, list } from '@plurid/aptuitive-core';

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

Mark each list's container with `data-apt-list` and each item in it with `data-apt-item`, naming the action. Add `<apt-more>` where moved-out items should be found, `<apt-ask>` for requests, and `<apt-banner>` to say what changed. This markup goes in your page, such as `index.html`; the container is a flex box, so the menu can be reordered.

<!-- example: docs/examples/without-react/menu.html -->

```html
<!-- A flex container, so the menu can be reordered. -->
<nav class="insert" data-apt-list="insert" style="display: flex; gap: 0.25rem">
  <button type="button" data-apt-item="table">Table</button>
  <button type="button" data-apt-item="image">Image</button>
  <button type="button" data-apt-item="chart">Chart</button>
  <button type="button" data-apt-item="divider">Divider</button>
  <button type="button" data-apt-item="comment">Comment</button>
  <apt-more list="insert"></apt-more>
</nav>
<apt-ask></apt-ask>
<apt-banner></apt-banner>
```

Add the attributes wherever the application builds the elements: in its templates, or in the calls that create them. Markup rendered later, such as a menu built when it opens, adapts too.

## Start

The client is the same as with React; the `client.ts` that `init` wrote creates one:

<!-- example: docs/examples/without-react/client.ts -->

```ts
import { createAptuitive, localStore } from '@plurid/aptuitive-core';
import { contract } from './contract.js';

// Learns from use and changes when asked; the person's interface is kept in this browser.
export const aptuitive = createAptuitive({ contract, store: localStore('editor') });
```

Then start Aptuitive once, from your page's entry script, such as `src/main.ts` importing `start.ts`. `startAptuitive` registers the elements and gives each one the client, adapts the marked markup, starts a new session when the person comes back after a while, plans each session from use once, and saves usage whenever the page is hidden or closed. It returns a function that undoes it all.

<!-- example: docs/examples/without-react/start.ts -->

```ts
import { startAptuitive } from '@plurid/aptuitive-dom';
import { aptuitive } from './client.js';

// Registers the elements, adapts the marked markup and keeps state across visits.
startAptuitive(aptuitive);
```

## How markup adapts

- **Items moved out are hidden** by one stylesheet, never removed, so the application's framework keeps its nodes. `<apt-more list="…">` lists them; choosing one clicks the hidden original, so the application's own handler runs. When the original isn't in the page, `<apt-more>` emits `apt-open` with `detail.list` and `detail.action`, for the application to run.
- **Reordered lists** set CSS `order` on the container's children, which needs a flex or grid container. Otherwise the list can't reorder, and `onProblem` hears of it once (by default, `console.warn`).
- **Clicks on items record use**, reached directly. Pass `record: false` when the application records use itself.
- **Shadow roots**: markup inside one, such as a Lit component's, adapts with `root` set to that shadow root, through `adaptMarkup(client, { root })`.

## Draw lists yourself

For markup the page draws itself, read the list from the client and draw it again whenever the client changes:

<!-- example: docs/examples/without-react/render.ts#render -->

```ts
const draw = () => {
  const buttons = aptuitive.surface('insert').visible.map((item) => {
    const button = document.createElement('button');
    button.textContent = item.label;
    button.addEventListener('click', () => {
      aptuitive.record(item.id, { via: 'region', surface: 'insert' });
      run(item.id);
    });
    return button;
  });
  menu.replaceChildren(...buttons);
};
draw();
return aptuitive.subscribe(draw);
```

`client.surface(list)` gives the `visible` actions, then those in `overflow`. Record each use with how it was reached, `region` or `overflow`.

## The elements

| Element                | What it does                                                                              | Attributes      | Events                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| `<apt-ask>`            | Takes a request in the person's words, and says in a line what happened                   | `placeholder`   | `apt-asked` (`detail.adaptation`)                                                      |
| `<apt-banner>`         | Says what just changed and why, with Revert and Keep, and answers requests                | `docked`        | `apt-dismiss` (`detail.adaptation`)                                                    |
| `<apt-more>`           | Lists the items moved out of a list                                                       | `list`, `label` | `apt-open` (`detail.list`, `detail.action`)                                            |
| `<apt-confirm>`        | Asks before an action changes data                                                        |                 |                                                                                        |
| `<apt-your-interface>` | Every change the person owns, with keep, revert, freeze, reset, export, import and forget |                 | `apt-export` (`detail.document`), `apt-import` (`detail.adaptation` or `detail.error`) |
| `<apt-debug>`          | Usage, the planner's exact request, the definition and pending changes, for development   | `collapsed`     | `apt-simulated` (`detail.persona`, `detail.reports`)                                   |

- Every element emits `apt-error` (`detail.error`) when something it runs fails. Events bubble out of the shadow root.
- Each element uses the client `startAptuitive` gave every element, or its own `client` property when set.
- `<apt-debug>` comes from `@plurid/aptuitive-dom/debug`, registered by `defineDebugElement()`, so production pages don't load it.
- Without `startAptuitive`, `defineElements()` registers the elements, and `AptElement.useClient(client)` gives them the client.

## Confirmations

Place `<apt-confirm>` once. While it is in the page, actions with effects that the application runs through `client.perform` wait for the person's answer: one step for a write, a typed phrase for a destructive run. Without it, they are refused. The application's own controls, which ask in their own way, pass `{ origin: 'native' }` to `perform`, so their runs count as use without asking twice.

## Styling

The elements render in shadow roots, styled through CSS custom properties: `--apt-accent`, `--apt-surface`, `--apt-text`, `--apt-muted`, `--apt-border`, `--apt-radius` and `--apt-font`.

- `<apt-banner>` floats at the bottom right; restyle `:host` to place it elsewhere, or add `docked` to put it in the page's flow, such as in the application's notification area.
- Each element's content is `::part(content)`, and the headings of `<apt-banner>`, `<apt-confirm>` and `<apt-your-interface>` are `::part(heading)`, for hosts that title them in their own way.

## Requests in plain words

Without a planner, `<apt-ask>` answers plain commands such as "hide Image" or "move Chart to the top". For requests in plain words, give the client a `remotePlanner` that calls your server: [Planning](planning.md).
