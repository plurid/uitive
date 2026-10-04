# Findings: integrating Uitive with coding agents

These runs used the product's earlier name, Aptuitive; packages, commands and elements appear here by their names today.

Can a coding agent with only the agent kit (the CLI, the `integrate-uitive` skill and the packages) integrate Uitive into a real application it has never seen, in hours? Each run below is one agent, timed from its first command to its report, with no help from anyone. What the kit got wrong is the useful part: each gap found is listed with what changed since.

## Summary

| Run | Application             | Interface                  | Time       | Coverage                                                           |
| --- | ----------------------- | -------------------------- | ---------- | ------------------------------------------------------------------ |
| 1   | Excalidraw (drawing)    | React 19                   | 40 minutes | 17 actions, 1 list, 1 choice                                       |
| 2   | Medusa Admin (commerce) | React 18.3, `@medusajs/ui` | 37 minutes | 3 sources, 39 actions (33 with effects), 9 routes, 2 pages, 1 list |
| 3   | Grist (spreadsheet)     | GrainJS, no React          | 54 minutes | 10 actions, 2 lists                                                |

Every run met its whole definition of done without help, and each application looked exactly as before for someone who changed nothing. Each run used the kit as it was before that run's fixes. By the agents' own estimates, between half and three quarters of each run went to the kit's gaps, all listed below with what changed.

Not yet measured: planning with a model, since no run had a Claude API key; and the browser extension on the real payments dashboard.

## Run 1: Excalidraw (2026-10-03)

**The application.** Excalidraw at commit `ed10ac7`: React 19 and Vite in a yarn 1 monorepo, with the editor in `packages/excalidraw` and the app in `excalidraw-app`. No backend and no API description, so the integration is actions, a list and a choice. It ran locally without seed data.

**The setup.** A fresh agent (Claude Opus 5.5) got the skill, the CLI and the packages as tarballs, a running dev server, and a definition of done:

1. `uitive check` passes.
2. Excalidraw looks and behaves as before for someone who changes nothing.
3. A real part of the interface is adaptable and wired in.
4. A plain command changes it live, the change survives a reload, and a revert undoes it.

There was no Claude API key, so only the deterministic planner was available.

**The result.** All four points were met in **40 minutes**, with no intervention.

- **The Shapes toolbar became a list.**
  - Its 11 visible tools are the list's items, with the "More tools" menu as its overflow.
  - "hide Diamond" moves Diamond into that menu, it survives a reload, and a revert brings it back.
  - Excalidraw's own tool buttons record usage.
- **The theme became a choice**, kept in step with Excalidraw's own theme toggle.
- **People can ask from inside Excalidraw.** The agent added an "Adapt interface…" item to Excalidraw's main menu, built from Excalidraw's own dialog components.
- **Nothing changes for someone who changes nothing.**
  - The interface was pixel-identical to the original.
  - Excalidraw's suite passed: 2,451 tests, plus `tsc` and ESLint.
- **The diff.**
  - 11 files changed: 989 lines added, of which 674 are `yarn.lock`, and 144 removed.
  - New files: `uitive/`, the dialog, and a test.
  - The library change is a generic `toolbarLayout` prop with no Uitive dependency, which Excalidraw could take on its own.
- **Coverage.** 17 actions, 1 list, 1 choice, 1 page, 1 region; no data sources.

**Where the kit fell short**, in the agent's order of time lost (about 20 of the 40 minutes), and what changed:

| Gap                                                                                                                                                                   | Change since                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A page that is one region collapsed full-height apps to 0 px: the page wrapper had no height                                                                          | Such a page now renders the application itself, with no wrapper                                                                                                                                                  |
| `check` loaded the contract in plain Node, so tsconfig path aliases failed                                                                                            | `check` resolves tsconfig `paths`; the skill and the generated contract say what can't load                                                                                                                      |
| The deterministic planner's commands were undocumented, and "dark theme" or "set theme to dark" weren't understood                                                    | Choice commands match by words: a value plus filler or the choice's own name; the skill, client and READMEs list the commands                                                                                    |
| `detect` and `init` weren't monorepo-aware, and `init` wrote a server and overrides the app didn't need                                                               | `detect` lists a workspace's packages with an interface. `init` puts agent configuration at the repository root, overrides only what it installs, and adds a server and zod only when needed                     |
| `.mcp.json` pointed at an unpublished package                                                                                                                         | Not written when installing from tarballs                                                                                                                                                                        |
| Generated code ignored the host's style: `.js` imports, and `satisfies`, which Prettier 2.6 can't parse                                                               | Imports follow the project's module resolution, `satisfies` is gone, and generated files go through the project's Prettier                                                                                       |
| `check` said "0 of 17 actions run" although `perform` was bound                                                                                                       | Coverage reports actions with effects, and whether `perform` is bound                                                                                                                                            |
| A failed install gave no reason; yarn was pinned but not installed                                                                                                    | The pinned package manager runs through npx, and failures show its output                                                                                                                                        |
| The skill didn't mention `discover`, which named lists invalidly, kept "More" triggers and matched exact labels at 0.5                                                | The skill covers `discover`. List names are camelCase, "More" triggers are left out, bracketed descriptions are ignored, and exact labels score 1                                                                |
| Smaller: `keywords` on actions, a client that assumed a server, the SDK pulled in by the CLI, no READMEs, `generate --help` failing, repeated theme changes piling up | Fixed: actions take labels; a client without a server plans on the device; the planner's schema and prompt need no SDK; each package has a README; full help per command; a later choice replaces an earlier one |

**Caveats.**

- This was the simplest kind of integration: no backend, no data, no model planning.
- It's one run by one agent, and the time costs above are the agent's own estimates.
- The run used the kit as it was before the fixes.
- Runs 2 and 3 tested what this one didn't: an API and its data, and an application without React.

## Run 2: Medusa Admin (2026-10-03)

**The application.** Medusa's admin dashboard from Medusa 2.21.2 (`packages/admin/dashboard` at commit `044fbbb9`), run on its own: React 18.3, React Router 7, and Medusa's design system, `@medusajs/ui`. It talked to a local Medusa backend with demo products but no orders or customers, so the agent created 4 customers and 6 orders through the admin API. The admin's OpenAPI description (3.8 MB) was available.

**The definition of done.**

1. `uitive check` passes.
2. The admin looks and behaves as before for someone who changes nothing.
3. Sources generated from the OpenAPI description, curated to what the dashboard shows (at least orders, customers and products), bound with the REST bindings and the signed-in admin's session, returning real rows.
4. The orders list and order detail as routes and pages, each the existing page as a region; the main navigation as a list.
5. Live: a command changes the navigation, survives a reload and reverts; a page redesigned from generic blocks on real data, drawn with the kit mapped to `@medusajs/ui`, passes policy, survives a reload and reverts; an action runs from a generated page only after Uitive's confirmation, and a destructive one asks for its typed phrase.

**The result.** All points were met in **37 minutes**.

- **Nothing changes for someone who changes nothing.**
  - With the six pristine files put back for an A/B on the same data, the orders, order detail, products and customers pages screenshot byte for byte the same.
  - The console shows the same messages.
  - The admin's TypeScript check fails with the same 9 errors it had before (the standalone copy's own), and its tests pass.
  - Two deviations: an "Adapt interface" item in the user menu, and the app's zod pin moved from 4.2.0 to 4.6.5 (gap 1).
- **Data.** Orders, customers and products were generated from the OpenAPI description and curated. The curation kept fields, labels and keywords, picked the customer's name, sales channel and country, and passed the `fields` query that Medusa needs to include email, currency and statuses. It excluded actions the dashboard doesn't offer and lowered three effects with reasons. Real rows came back through `restFetch` with the admin's session cookie.
- **Pages.** `/orders` and `/orders/:id` became routes whose pages are the existing pages as regions, and the order page knows which order it shows. The sidebar is a list of six.
- **Live.**
  - "hide Products" moved Products under a new "More" in the sidebar; it survived a reload, and "show Products" brought it back.
  - A redesigned orders page (four metrics, and a table of orders that need attention with row actions and an Export button) applied through `setPage` with no rejections. It was drawn with Medusa's Container, Table, Button and Prompt, and the dashboard's own money, date and status cells. It survived a reload and reverted in one step.
  - Exporting orders (a write) asked first. Canceling test order #6 (destructive) kept its button disabled until "Cancel order" was typed; afterwards the API reported the order canceled and the page refreshed itself.
- **The diff.** 27 files, mostly the copied OpenAPI description and the lockfile. The integration itself:
  - `uitive/`: the contract (108 lines), bindings (52), client (25), the kit mapped to `@medusajs/ui` (380), and the curation;
  - the provider and router;
  - the sidebar following the list (61 lines);
  - the Adapt dialog (126);
  - the two order pages as regions (9 lines each);
  - and the new strings.
- **Coverage.** 3 sources; 39 actions, 33 with effects, all bound to run through `perform`; 9 routes, 2 pages, 2 regions, 1 list.

**Where the kit fell short**, in the agent's order of time lost (about 23 of the 37 minutes), and what changed:

| Gap                                                                                                                                                                                                                     | Change since                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two copies of zod: `init` silently replaced the app's exact pin, and with the pin restored, generated schemas from the app's zod met core's own copy, so `tsc` ran out of memory, then gave 49 errors with a 12 GB heap | zod is a peer dependency (`^4.2.0`, tested against 4.2.0), so the application's single copy serves Uitive too. `init` keeps it and says when it is older than 4.2, and `check` warns about a second copy                                                                                                   |
| Which kit part each block draws with was undocumented: section titles were drawn by `<Page>` itself, and tables sat in no container                                                                                     | A new `Section` part (a section's container and title), and the React README maps every block to the parts it uses                                                                                                                                                                                         |
| The curation format was only in the type declarations, and `survey` printed field counts, not names                                                                                                                     | The CLI's README documents every key; `survey` lists the fields of chosen sources, and always in `--json`                                                                                                                                                                                                  |
| `uitive/kit.tsx` sat outside Tailwind's `src` globs, and outside the app's own typecheck                                                                                                                                | `init` writes into `src/uitive` when there is a `src` folder, and records the folder in package.json for every command                                                                                                                                                                                     |
| The bindings template widened the contract's type, so `useSurface` returned every surface's type                                                                                                                        | The template types bindings with the contract                                                                                                                                                                                                                                                              |
| No feedback after a confirmed run, and nothing to map the design system's toast to                                                                                                                                      | A new `Notice` part says how each run ended; mapped to a toast, it shows once per run                                                                                                                                                                                                                      |
| No way to name fields: tables read "Display id" and "Created at"                                                                                                                                                        | The curation takes `labels`                                                                                                                                                                                                                                                                                |
| `discover` matched a drawer's "Cancel" to the destructive `orders.cancel` with full confidence, matched "Create" to `customers.*` on other pages, titled the order route "#6", and listed the navigation five times     | Buttons in dialogs and sort buttons are ignored; a generic verb needs the page to say what it acts on, a dismissal never matches a longer action, and words the page supplies count half. Routes keyed by a row are titled by their path, and navigation is merged across pages without its shortcut hints |
| Smaller: React's banner wrappers needed the DOM package, which wasn't installed; READMEs pointed into this repository; `detect` named different package managers in text and JSON                                       | React depends on the DOM package and registers elements on first use; the READMEs point to what an integrator has; `detect` agrees with itself                                                                                                                                                             |

One more change came from this run: the React provider now handles the session lifecycle itself, which the playbook never mentioned. Still open: generated code follows the host's style only when the host's Prettier is installed.

## Run 3: Grist (2026-10-03)

**The application.** grist-core at commit `6e4b1c9`: TypeScript with an interface built on GrainJS, not React, an Express server, yarn 1, and Node 22. It ran locally with single-user sign-in and a sample document.

**The definition of done.**

1. `uitive check` passes.
2. Grist looks and behaves as before for someone who changes nothing.
3. A real part of the interface is adaptable through the contract and wired in through the DOM package, with Grist's own controls recording usage.
4. Live: a command changes it, the change survives a reload, and reverting brings it back.

**The result.** All four points were met in **54 minutes**. The first proof landed 19 minutes in.

- **Two parts adapt**: the document's "Add new" menu and the left panel's Tools, as two lists of 10 actions.
  - "hide Import" left the menu with Add page, Add widget to page, Add empty table and Copy data, with Import under a new "More". The change survived a reload, and Revert restored the menu, also across a reload.
  - On Tools, "hide Code view" applied live, "More" listed it, and "restore Code view" brought it back.
- **Nothing changes for someone who changes nothing.** With no stored state, the menu and Tools look exactly as before, no banner shows, and the page logs no errors. The one addition is a "Your interface" item in the account menu.
- **Usage.** Grist's own controls record usage, such as `{"action":"table.add-empty","via":"region","surface":"addNew"}`, and still open Grist's own dialogs.
- **The diff.** 8 files changed, 160 lines added and 21 removed, plus four new files: the contract, the client, a "Your interface" window with a request box, and a re-export for `check`. TypeScript builds cleanly and Grist's linter passes.
- **Coverage.** 10 actions, 1 route, 1 page, 1 region, 2 lists.

**Where the kit fell short**, in the agent's order of time lost (about 28 of the 39 minutes left after the slow build), and what changed:

| Gap                                                                                                                                                                                                                                           | Change since                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The DOM package's README promised elements that rearrange existing markup, but there were none. The playbook only covered React, the elements offered no request box, and a host's duties went unsaid                                         | `startUitive` sets a page up in one call. `adaptMarkup` adapts markup marked with `data-uitive-list` and `data-uitive-item`: hidden through one stylesheet (menus rendered later included), reordered through CSS `order`, nothing moved, and clicks recorded. `<uitive-ask>`, `<uitive-more>` and `<uitive-confirm>` are new, and the playbook has the path without React |
| `init` wrote `uitive/` at the root, outside Grist's TypeScript projects, and nothing mentioned `check --contract`                                                                                                                             | `init --dir` puts the folder anywhere and records it in package.json, where every command reads it                                                                                                                                                                                                                                                                         |
| The packages couldn't be `require`d, so Grist's CommonJS server couldn't load them, and the server package only showed Next.js                                                                                                                | Every export has a `default` condition (Node 22 can require ES modules), and `toNodeListener` from `@plurid/uitive-server/node` serves the handler from Express or `node:http`                                                                                                                                                                                             |
| The CLI needed Node 24 (Grist needs 22); `init` installed no DOM package and gave React steps; dependencies went in unsorted, with absolute tarball paths                                                                                     | The CLI and MCP server run on Node 22; `init` installs the DOM package and its steps for apps without React, sorts dependencies, and uses relative paths. It also says when it configures Claude Code by default, and `detect` recognizes GrainJS, Lit, Preact and Knockout                                                                                                |
| Id rules only showed up as runtime errors                                                                                                                                                                                                     | Documented on the contract's fields and in the playbook: action ids are lowercase with dots or dashes, surface names camelCase                                                                                                                                                                                                                                             |
| The banner came back after every reload, sat on Grist's toast layer with no docked mode, and suggested "hide share"; "Your interface" repeated the host's heading; "restore X" after "hide X" added a second change, whose Revert hid X again | The banner shows only what happens while it is open, takes `docked`, and suggests a command from the application's own lists; headings are `::part(heading)`; and undoing a change reverts it, rather than adding its opposite                                                                                                                                             |
| `discover` kept document ids as fixed path segments, matched the "Add new" menu button to "Add page", never opened menus, and listed shortcut hints and duplicates as items                                                                   | Ids that mix letters and digits become parameters, buttons that open menus are listed apart and never matched, and hints and duplicates are dropped                                                                                                                                                                                                                        |

Still open: discovery doesn't open menus, and can't tell a document's own names (its pages) from the interface's labels.

## The documentation, dry run (2026-10-03)

A fresh agent with only the documentation and the packed packages, working offline, followed [Getting started](getting-started.md) in a new Vite React app and [Without React](without-react.md) on a plain page. It met every point of both definitions of done in about 14 minutes: 5 for React, 2.5 for the plain page, and the rest checking further claims. It never needed a type declaration, and every code block compiled and ran as written once installed.

| Gap                                                                                                                                                         | Change since                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `init --packages` failed: pnpm 11 ignores overrides in package.json, and the list of overrides left out the DOM package, which the React package depends on | Every tarball is overridden, in `pnpm-workspace.yaml` for pnpm 10 and later; a failed install prints the package manager's warnings |
| The guide's files clashed with `init`'s (`notes` against `contract`), and `check` passed while `tsc` failed                                                 | The examples export `contract`, as `init`'s files expect; the guide says which file replaces which, and to run `tsc` too            |
| "move Table to the top" changed nothing while Table was under More, yet answered `done`                                                                     | Moving an item from overflow brings it into view first; "show" after a hide undoes the hide                                         |
| The plain page's "move Chart to the top" was refused: the list wasn't reorderable, nor the menu a flex box                                                  | The example is both                                                                                                                 |
| Wiring left to guesswork: what `run` is, where `Editor` renders, how the plain page starts, imports ending in `.js`                                         | A "Run it" step with `main.tsx`, a client file for the plain page, and a note on each                                               |
| The example ask box showed raw statuses, and explanations said "1 sessions"                                                                                 | The banner answers instead; counts read "once" and "a session"                                                                      |

Still open: a learned change that applies as the page loads is listed in "Your interface" but not announced by the banner; an undo, such as "restore" after "hide", shows "Done" without naming the change; and no plain command resets a single list.

## Caveats

- One run per application, by one agent each, and the time costs are the agents' own estimates.
- No run planned with a model: commands went through the deterministic planner, and redesigns were applied the way a model's plan would be, through the client and its policy checks.
