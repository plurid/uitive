# Uitive for Chrome (private prototype)

The second front door: Uitive on pages it doesn't own. The extension applies adapters (a JSON contract plus anchors, routes and official API connectors) to a site you enable, and lets you reshape it by asking in the side panel. Changes are yours: listed with their reasons, revertible one by one, and the original page is always one shortcut away (Alt+Shift+A).

It is a private prototype. The first adapter targets a payments dashboard whose terms forbid modifying it, so it is for personal use in test mode only, and nothing is published.

## What leaves your browser

- To the model you have a key for (Claude, OpenAI or Gemini), only when you ask for something: the adapter's contract, your words, your interface's definition, usage counts and the page's structure (which parts were found). Never page text, rows or ids.
- To the payments API: read requests, with a restricted key you create, scoped to read permissions.
- Keys stay in the extension's own storage, used only by its service worker; pages and content scripts can't read them.

## Try it on the fictional dashboard

```sh
pnpm install
node tools/fixtures/payments-dashboard/start.ts
node apps/extension/build.ts --out dist/fixture --fixture http://127.0.0.1:4180 --api http://127.0.0.1:4181
```

1. In Chrome, open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and pick `apps/extension/dist/fixture`.
2. Open http://127.0.0.1:4180/test/dashboard, then the Uitive side panel from the toolbar, and choose "Enable on this site".
3. Ask: "hide Connect", "hide Billing". Hidden links wait in a More list at the end of the sidebar.
4. In the panel's Keys, paste any key starting `rk_test_` for the API; with a key for Claude, OpenAI or Gemini, free-form requests such as "make my home a morning check of failed payments, disputes and payouts" are planned by Claude.

## Check it on the real site

The adapter's anchors are guesses until checked on the real page. You sign in yourself, in test mode; nobody else enters credentials or keys.

1. Build with `node apps/extension/build.ts` and load `apps/extension/dist` unpacked, in a Chrome profile of your choice.
2. Open the dashboard in test mode, open the side panel and choose "Enable on this site"; Chrome asks you for that one site.
3. "This page" lists the parts found and not found. For each one not found, "Pick" it and click where it is now; the repair stays on this device, and the report tells us how to correct the adapter.
4. To try redesigned pages, create a restricted test key with read access only (charges and refunds, customers, disputes, payouts, balance, invoices, subscriptions) and paste it in the panel.
5. Ask for changes; check that the original is one Alt+Shift+A away, that a DevTools performance trace shows no long tasks from the extension, and that "Forget everything" leaves nothing behind.

## Tests

`pnpm test` runs the end-to-end suite in Chrome (when installed) against the fictional dashboard: anchors, hiding through re-renders and reloads, the More list, key refusal, a redesigned page on API data, and a check that requests never carry page text or rows.
