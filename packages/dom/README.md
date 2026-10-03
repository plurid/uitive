# @plurid/aptuitive-dom

Aptuitive for pages without React. It adapts the markup an application already renders to each person's interface, in place, and provides the meta-interface as custom elements: a box to ask in, a banner that says what changed and why, a menu for what moved out, the confirmation before an action changes data, and "Your interface".

```sh
pnpm add @plurid/aptuitive-core @plurid/aptuitive-dom zod
```

Mark each list's container and its items, wherever the application builds that markup:

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

Then create the client and start Aptuitive once, from the page's entry script:

<!-- example: docs/examples/without-react/client.ts -->

```ts
import { createAptuitive, localStore } from '@plurid/aptuitive-core';
import { contract } from './contract.js';

// Learns from use and changes when asked; the person's interface is kept in this browser.
export const aptuitive = createAptuitive({ contract, store: localStore('editor') });
```

<!-- example: docs/examples/without-react/start.ts -->

```ts
import { startAptuitive } from '@plurid/aptuitive-dom';
import { aptuitive } from './client.js';

// Registers the elements, adapts the marked markup and keeps state across visits.
startAptuitive(aptuitive);
```

- Items the person moves out are hidden by one stylesheet, so markup rendered later adapts too. Nothing is moved, so the framework that built the markup keeps its nodes.
- Reordered lists set CSS `order` on their container's children, which needs a flex or grid container.
- Clicks on items record use, and each session is planned from use once.
- `<apt-ask>`, `<apt-banner>`, `<apt-more>`, `<apt-confirm>` and `<apt-your-interface>` take the client from `startAptuitive`; `<apt-debug>` comes from `@plurid/aptuitive-dom/debug`.
- Restyle the elements with `--apt-*` custom properties, `::part(content)` and `::part(heading)`.

It works with any framework or none, such as GrainJS, Lit, Vue or server-rendered HTML, and needs zod 4.2 or later. Read [Without React](https://github.com/plurid/aptuitive/blob/master/docs/without-react.md) and the [API reference](https://github.com/plurid/aptuitive/blob/master/docs/api/dom.md). MIT licensed.
