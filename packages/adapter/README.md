# @plurid/uitive-adapter

Uitive for pages it doesn't own, and discovery for pages it does. An adapter is data: a JSON contract plus anchors (how to find a page's parts), routes, lists, regions and official API connectors. This package checks adapters, compiles a person's interface into effects for a page (hide, order, a More list, overlays), and reads accessibility trees to discover what a page offers.

```sh
pnpm add @plurid/uitive-adapter zod
```

Discovery reads the accessibility tree Playwright writes, never the page's rows:

<!-- example: docs/examples/adapter/discover.ts#discover -->

```ts
// What Playwright's `page.locator('body').ariaSnapshot()` writes for the orders page.
const snapshot = `
- navigation "Main":
  - link "Orders":
    - /url: /orders
  - link "Customers":
    - /url: /customers
- main:
  - heading "Orders" [level=1]
  - button "Cancel order"
`;

const facts = factsOf(parseAriaSnapshot(snapshot), 'http://localhost:5173/orders');
// A route and a region for the page, the navigation as a list, and buttons matched to actions.
export const discovery = discoverApp([facts], shop);
```

- `checkAdapter(json)` checks an adapter's shape and contract, and that every anchor, route, list, region and connector it names resolves.
- `compileEffects(adapter, values, route)` turns the person's interface into effects: pure data, which the browser extension applies.
- `discoverApp(pages, contract)` proposes routes, regions, lists and which buttons are which actions; `uitive discover` runs it on a live application.

It runs anywhere, with no DOM or Node APIs, and needs zod 4.2 or later. Read the [browser extension's README](https://github.com/plurid/uitive/blob/master/apps/extension/README.md), [Coding agents](https://github.com/plurid/uitive/blob/master/docs/coding-agents.md#discovery) and the [API reference](https://github.com/plurid/uitive/blob/master/docs/api/adapter.md). MIT licensed.
