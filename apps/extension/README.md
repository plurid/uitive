# Uitive for Chrome (private prototype)

The second front door: Uitive on pages it doesn't own. The extension applies adapters (a JSON contract plus anchors, routes and official API connectors) to a site you enable, and lets you reshape it by asking in the side panel. Changes are yours: listed with their reasons, revertible one by one, and the original page is always one shortcut away (Alt+Shift+A, which does nothing while you type in a field).

It is a private prototype. The first adapter targets a payments dashboard whose terms forbid modifying it, so it is for personal use in test mode only, and nothing is published.

## What leaves your browser

- To the model of the first provider you have a key for (Claude, then OpenAI, then Gemini), only when you ask for something: your words, your interface's definition as IDs, usage counts and the page's structure (which parts were found, and which sources can be read). Never page text, rows or ids. The service worker checks every request field by field before a model sees it, and takes at most 10 a minute and 5,000,000 tokens a month.
- To the payments API: read requests, with a restricted key you create, scoped to read permissions; at most 2,000 a month.
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
3. Ask: "hide Connect", "hide Billing". Hidden links wait in a More list at the end of the sidebar.
4. In the panel's Keys, paste any key starting `rk_test_` for the API; with a key for Claude, OpenAI or Gemini, free-form requests such as "make my home a morning check of failed payments, disputes and payouts" are planned by that provider's model.

Fixture builds are granted the fixture's origins at install. Add `--ask` to grant nothing, as for the real site: the side panel then asks Chrome for the site and its API.

## Check it on the real site

The adapter's anchors are guesses until checked on the real page. You sign in yourself, in test mode; nobody else enters credentials or keys.

1. Build with `node apps/extension/build.ts` and load `apps/extension/dist` unpacked, in a Chrome profile of your choice.
2. Open the dashboard in test mode, open the side panel and choose "Enable on this site"; Chrome asks you for that one site and the payments API. If the panel can't see the tab's address, it lists the sites it has adapters for, each with its own "Enable".
3. "This page" lists the parts found and not found. For each one not found, "Pick" it and click where it is now; the repair stays on this device, and the report tells us how to correct the adapter.
4. To try redesigned pages, create a restricted test key with read access only (charges and refunds, customers, disputes, payouts, balance, invoices, subscriptions) and paste it in the panel.
5. Ask for changes; check that the original is one Alt+Shift+A away, that a DevTools performance trace shows no long tasks from the extension, and that "Forget everything" leaves nothing behind: `chrome://extensions` shows no site access for Uitive afterwards.

## Tests

`pnpm test` runs the end-to-end suite in Chrome against the fictional dashboard: anchors, hiding through re-renders and reloads, the shortcut (and not while typing), the More list, key refusal, a redesigned page on API data, a check of what the service worker receives with page text and API rows on screen, and Forget. It finds Chrome at `CHROME_PATH`, where Chrome installs, or Playwright's Chromium; without one it skips, except in CI (`CI` set), where it fails.

A second build grants nothing at install, as published: the suite opens its side panel on the dashboard, presses "Enable" and checks that Chrome is asked for the site and its API together. Chrome's permission prompt can't be automated, so granting it is checked by hand: build with `--ask`, load it, choose "Enable" in the side panel, allow, and check that the page reloads with Uitive running and that redesigned pages read from the API.
