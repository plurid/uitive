# @plurid/uitive-dom

Uitive for pages without React. It adapts the markup an application already renders to each person's interface, in place, and provides the meta-interface as custom elements: a box to ask in, a banner that says what changed and why, a menu for what moved out, the confirmation before an action changes data, and "Your interface".

```sh
pnpm add @plurid/uitive-core @plurid/uitive-dom zod
```

Mark each list's container and its items, wherever the application builds that markup:

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

Then create the client and start Uitive once, from the page's entry script:

<!-- example: docs/examples/without-react/client.ts -->

```ts
import { createUitive, localStore } from '@plurid/uitive-core';
import { contract } from './contract.js';

// Learns from use and changes when asked; the person's interface is kept in this browser.
export const uitive = createUitive({ contract, store: localStore('editor') });
```

<!-- example: docs/examples/without-react/start.ts -->

```ts
import { startUitive } from '@plurid/uitive-dom';
import { uitive } from './client.js';

// Registers the elements, adapts the marked markup and keeps state across visits.
startUitive(uitive);
```

- Items the person moves out are hidden by one stylesheet, so markup rendered later adapts too. Nothing is moved, so the framework that built the markup keeps its nodes.
- Reordered lists set CSS `order` on their container's children, which needs a flex or grid container.
- Clicks on items record use, and each session is planned from use once.
- `<uitive-ask>`, `<uitive-banner>`, `<uitive-more>`, `<uitive-confirm>` and `<uitive-your-interface>` take the client from `startUitive`; `<uitive-debug>` comes from `@plurid/uitive-dom/debug`.
- Restyle the elements with `--uitive-*` custom properties, `::part(content)` and `::part(heading)`.

It works with any framework or none, such as GrainJS, Lit, Vue or server-rendered HTML, and needs zod 4.2 or later. Read [Without React](https://github.com/plurid/uitive/blob/master/docs/without-react.md) and the [API reference](https://github.com/plurid/uitive/blob/master/docs/api/dom.md). MIT licensed.
