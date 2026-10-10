# Uitive for Chrome

The second front door: Uitive on pages it doesn't own. The extension applies adapters (a JSON contract plus anchors, routes and official API connectors) to a site you enable, and lets you reshape it by asking in the side panel. Changes are yours: listed with their reasons, revertible one by one, and the original page is always one shortcut away (Alt+Shift+A, which does nothing while you type in a field).

This folder is the engine: the service worker, the content script, the side panel, the build, and an adapter for Acme Payments, a fictional dashboard in `tools/fixtures/payments-dashboard`. Adapters for real sites are maintained by Uitive and ship in its own builds; this build ships the demo, or the adapters you give it.

## What leaves your browser

- To the model of the first provider you have a key for (Claude, then OpenAI, then Gemini), only when you ask for something: your words, your interface's definition as IDs, usage counts and the page's structure (which parts were found, and which sources can be read). Never page text, rows or ids. The service worker checks every request field by field before a model sees it, and takes at most 10 a minute and 5,000,000 tokens a month.
- To the site's own API, through an adapter's connector: read requests, with a key you create, scoped to read permissions; at most 2,000 a month.
- Keys stay in the extension's own storage, used only by its service worker; pages and content scripts can't read them.

## What stays in your browser

- Your interfaces, repairs and usage counts, in the extension's storage.
- To find the parts it knows, the content script reads the page's links, roles and accessible names, and a repair keeps the picked element's link, label or text; both stay on the device.
- The parts a page hid last, in that tab's session storage, so a reload hides them before the page first paints; they go when the tab closes. The page can read them, as it can read the marks on its elements.
- Rows read from the API, in the service worker's memory for a minute, with only the fields the adapter's contract declares.

"Disable on this site" stops Uitive on a site and gives back its access; your interface stays. "Forget everything" erases all of the above and your keys, stops Uitive on every site and gives back every site's access; open pages drop their changes at once.

## Try it on the fictional dashboard

```sh
pnpm install
node tools/fixtures/payments-dashboard/start.ts
node apps/extension/build.ts --out dist/fixture --fixture http://127.0.0.1:4180 --api http://127.0.0.1:4181
```

1. In Chrome, open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and pick `apps/extension/dist/fixture`.
2. Open http://127.0.0.1:4180/test/dashboard, then the Uitive side panel from the toolbar, and choose "Enable on this site".
3. Ask: "hide Partners", "hide Invoices". Hidden links wait in a More list at the end of the sidebar.
4. In the panel's Keys, paste any key starting `acme_test_` for Acme's API (a key starting `acme_secret_` is refused, as the adapter says); with a key for Claude, OpenAI or Gemini, free-form requests such as "make my home a morning check of failed payments, disputes and payouts" are planned by that provider's model.

Fixture builds point the adapter at the fixture and are granted its origins at install. Add `--ask` to grant nothing, as for a real site: the side panel then asks Chrome for the site and its API.

## Write an adapter

An adapter is one TypeScript file, named for its ID, whose `adapter` export the build checks and writes as JSON beside it. `adapters/acme-payments.ts` is a complete example.

- **The contract**: what may adapt on the site, written with `@plurid/uitive-core` as for any application. Its sources come from the site's API description: `npx uitive generate sources --openapi <description> --curation <curation.json>` writes them, as it wrote `adapters/acme-payments/api.generated.ts` from the fixture's `openapi.json`.
- **Anchors, routes, lists, regions and pages**: how the extension finds each part of the page, by link, role and name, test ID, text or CSS, tried in order. `npx uitive discover` suggests routes, regions and lists from a running site's accessibility tree.
- **Connectors**: the site's official API, with how it takes keys (`auth`: a header and a prefix, `Bearer ` by default), what its keys look like for live data and, when the site has a test mode, for test data (`keys`), keys it refuses with a reason (`keys.refuse`), and the key's name and placeholder in the panel.
- **`testMode`**: a path pattern that marks test data, such as `^/test/`; a site without one has a single mode.
- **`examples`**: up to three requests the side panel suggests.

Build with your own adapters, from any folder:

```sh
node apps/extension/build.ts --adapters ../my-adapters --out ../my-adapters/dist
node apps/extension/build.ts --adapters ../my-adapters --check   # checks them and their JSON, builds nothing
```

`--adapters` takes folders, relative to this one or absolute, and replaces the demo. Adapters import only `@plurid/uitive-core`, `@plurid/uitive-adapter` and `zod`, resolved from this workspace, so there is one copy of each. The build fails on any adapter that doesn't pass its checks, on a file not named for its adapter, and on two adapters with one ID or origin. With several adapters, `--fixture-adapter <id>` names the one a fixture stands for.

## Tests

`pnpm test` runs the end-to-end suite in Chrome against the fictional dashboard: anchors, hiding through re-renders and reloads, the shortcut (and not while typing), the More list, key refusal, a redesigned page on API data, a check of what the service worker receives with page text and API rows on screen, and Forget. It finds Chrome at `CHROME_PATH`, where Chrome installs, or Playwright's Chromium; without one it skips, except in CI (`CI` set), where it fails.

A second build grants nothing at install, as published: the suite opens its side panel on the dashboard, presses "Enable" and checks that Chrome is asked for the site and its API together. Chrome's permission prompt can't be automated, so granting it is checked by hand: build with `--ask`, load it, choose "Enable" in the side panel, allow, and check that the page reloads with Uitive running and that redesigned pages read from the API.

The build's own tests load adapters from a folder outside the repository, as a product keeps its own, and the demo's sources are read page by page from the fixture's API.
