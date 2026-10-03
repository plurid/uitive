# Aptuitive domain context

Aptuitive lets an application's interface adapt to each person who uses it (learned from usage, and redesigned in their own words) without leaving the boundaries the application declares. A language model may propose changes; the application's contract constrains what can be expressed; policy decides what applies; the user owns the result.

## Domain language

- **Contract**: the typed declaration of what is adaptable in one application: its actions, its sources and its surfaces. It is the single source for TypeScript types, the model's output schemas, runtime validation and the prompt.
- **Action**: something a user can do (`mail.archive`), with a label and a description written for people and models alike. One action may appear on several surfaces. An action may take **params** and declare an **effect**: `read`, `write` or `destructive`; one with a `ref` param is a **row action**. Actions without an effect belong to the interface only.
- **Perform**: running an action through the application's binding. Runs from generated interfaces wait for a **confirmation**: one explicit step for a write, a typed phrase for a destructive run.
- **Surface**: a place in the interface that can adapt. Each surface has a **kind**: `list`, `choice`, `collection` or `page`. A surface may be keyed by **context**, such as the service on screen.
- **Page**: a surface the user can redesign completely: a flat list of **elements** (each a placed block with its children's IDs) forming one tree from a root, plus **named queries** its blocks share. A page keyed by context can be redesigned for one value or for every value (`*`); a page about a source's rows has an **entity**, and `$current` names the row.
- **Block**: a part a page is built from: the built-in `section`, `tabs` and `region`, or a component the application renders with typed props.
- **Kit**: the presentational parts generic blocks are drawn with (sections, tables, stats, charts, buttons, fields, dialogs, the notice after a run and the like). A default kit ships; an application swaps in its design system's parts one at a time, or how single value types display.
- **Generic block**: a block Aptuitive draws itself from the contract: `table`, `list`, `detail`, `metric`, `chart`, `timeline` and `board` show a named query's result; `form` and `actions` run actions; `note` and `links` need no data. A page's own block of the same name replaces the generic one.
- **Adapter**: a JSON contract plus bindings to a page Aptuitive doesn't own (anchors, routes, endpoints the page already calls, official API connectors), which the browser extension applies. The application's code is never involved.
- **Curation**: an application's choices about its API description, in `aptuitive/curation.json`: which sources and actions to keep, their fields and names, nested values to lift, and effects lowered with a reason. Generated sources and actions are rebuilt from the description and the curation, never edited.
- **Discovery**: what a running application's pages suggest, read from their accessibility trees without pressing anything: routes, a region per route, lists from navigation and toolbars, buttons matched to actions, and the buttons that open menus it doesn't open. Buttons in dialogs and sort buttons are never actions, and a generic verb or a dismissal alone never matches a longer action.
- **JSON contract**: a contract as data (`toJson`, `fromJson`), which adapters, coding agents and hosted planners exchange. It round-trips with the same hash; validators stay in code and are reattached when it loads.
- **Route**: a place in the application (`/customers/:id`), optionally showing one row of a source and one page; links and row links are built from routes.
- **Location**: where the user is, as the application's router reports it: the route, its params, the row a page is about (what `$current` names) and any context named like a param. Visiting a route records its action.
- **User page**: a page the user made themselves, at `/apt/<slug>`, from built-in and generic blocks and regions not tied to a row. Up to twenty per person.
- **Region**: part of the application as it already is, such as the original page, which a page can embed. Declared on the contract, optionally about one source; a standard page can be a single region.
- **Source**: data pages can show, declared as a typed read model: a flat row schema, a key, a title and summary fields, and the **capabilities** of its binding (what it filters, sorts, searches and pages by itself). Planners see its schema, never its rows.
- **Field**: one value of a source's rows, typed `text`, `number`, `money`, `time`, `enum`, `ref` or `bool`. A `ref` holds another source's key, which makes it a relation; queries name fields qualified by source (`payments.amount`), at most one hop away (`payments.customer.email`).
- **Query**: a question about one source as plain data: fields, filters, sorting, a limit, search text and an aggregate (a measure, grouped by a field and optionally split by another). Values are strings parsed per field type when the query runs; `$current` names the page's row and `$me` the signed-in user.
- **Binding**: the application's code behind a contract: `fetch` reads sources with the user's own permissions, `perform` runs actions and `navigate` follows links. Core pushes down what the binding declares and does the rest on the client, within each source's **scan** cap; a result cut short by the cap is **partial** and says so.
- **Via**: the path a user took to an action: `region`, `overflow`, `suggested`, `palette`, `shortcut` or `command`.
- **Usage event**: one activation: action, via and session index. Never text typed into the application, never page content.
- **Session**: a period of use that ends after an idle gap. Sessions are the unit of decay, budgets and safe moments. Each is planned from use once, as it starts (`learn`), unless the application turns that off.
- **Usage summary**: the deterministic statistics derived from usage events; the only usage a planner sees.
- **Definition**: one user's interface: the standard layout plus the applied operations of the model layer and the user layer. Typed by the contract, versioned, readable and exportable.
- **Operation**: one change to one surface (promote, demote, move, set, add, place, …) with an origin (`heuristic`, `model` or `user`), evidence and a reason.
- **Proposal**: operations from a planner that have not been applied.
- **Pending**: a checked proposal waiting for the next safe moment.
- **Planner**: produces proposals: the deterministic **heuristic** in the core, or the **model** planner on a server, with a **model** from any provider: Anthropic, OpenAI or a server that speaks its API, Gemini, or one the application implements. Models that can't keep to the schema answer in JSON, checked against it and repaired once.
- **Area**: one source with the actions that act on it and the routes that show it. A large contract's requests are planned over a **subset** of areas: those on screen and the most relevant few.
- **Repair**: one more round with the model when the part of policy that needs no user state rejects part of its plan.
- **Policy**: the rules every operation must pass: contract IDs, required items, reachability, precedence, budgets, cooldowns and application validators.
- **Stabiliser**: decides when checked operations apply: safe moments, budgets, dwell time, hysteresis and expiry.
- **Safe moment**: a time a structural change may apply without moving the interface under the user.
- **User layer**: operations the user made: commands, pins, hides, reverts and accepted suggestions. It outranks the model layer.
- **Command**: a request in the user's own words, answered with operations and a status.
- **Revert / Keep**: the user's answer to an applied operation. A revert starts a cooldown; a second revert blocks that operation for good. Undoing a change ("restore" after "hide", "unpin" after "pin") reverts it, rather than adding its opposite.

## Invariants

1. Required items are never hidden, whether by the model or by a command.
2. Every action stays reachable: through overflow, the palette or the standard view.
3. Planner output references only contract IDs. Action IDs, context values and choice values match `^[a-z0-9][a-z0-9.:-]*$`; surface names are camelCase identifiers; no two collide ignoring case, and model output is compared case-insensitively.
4. Precedence: application policy, then the user layer, then the model layer.
5. Structural operations apply only at safe moments, within the budget, at most one demotion per surface, after a dwell of three sessions; a model operation must recur in two plans or clear a margin.
6. Every applied operation has evidence and a reason and can be reverted.
7. With no planner available, the interface renders the last applied definition with no layout shift.
8. Generated items and pages pass their schemas, length caps and the application's validators, and never execute anything by themselves. A page's elements form exactly one tree from its root, within its depth and size limits.
9. A redesign the user did not ask for stays a suggestion until they accept it. Pages the user made are theirs alone: planners never create, rename, redesign or delete them unasked.
10. Planners see sources' schemas, never their rows. Every query passes policy field by field before it runs, and it runs through the application's bindings with the user's own permissions.
11. Amounts in different currencies are never added together; a summary of money is filtered to one currency or grouped by currency.
12. Nothing changes data without the user's yes: generated interfaces confirm every write and need a typed phrase for destructive runs; with no interface able to ask, the run is refused. Usage records the run, never its params.

## Modules

- **Core** (`@plurid/aptuitive-core`) owns contracts and kinds, sources and queries, the query executor and data cache, the recorder, the usage summary, the heuristic planner, policy, the stabiliser, the client store, storage and the simulator. It runs anywhere: no DOM or Node APIs. zod is a peer dependency of core and of every package built on it, so an application and Aptuitive share one copy.
- **React** (`@plurid/aptuitive-react`) exposes the client through a provider and hooks (surfaces, queries, actions, confirmations, location, user pages, any router), renders pages with the application's blocks, regions and the generic blocks, and draws generic blocks with a **kit**: presentational parts an application maps to its design system. The provider also connects the page's lifecycle: usage is saved when the page is hidden, a session starts when the person comes back, and each session is planned from use once.
- **DOM** (`@plurid/aptuitive-dom`) adapts an application's own markup, marked with `data-apt-list` and `data-apt-item`, through one stylesheet and CSS `order`, without moving any node, and provides the meta-interface elements: the ask box, banner, More menu, confirmation dialog, "Your interface" and the debug panel. `startAptuitive` does a page's setup in one call, the lifecycle included.
- **Planner** (`@plurid/aptuitive-planner`) owns the schema compiler, the prompt, the model planner and the built-in models, free of Node and DOM APIs, so it runs on servers and in extensions alike. Anthropic's SDK loads only when Claude plans; the other models call `fetch`.
- **Server** (`@plurid/aptuitive-server`) owns the Fetch-standard handler, its limits and streaming; it re-exports the planner. `@plurid/aptuitive-server/node` serves the handler from Express or `node:http`.
- **Adapter** (`@plurid/aptuitive-adapter`) owns what pages Aptuitive doesn't own need: accessibility trees from snapshots, page facts and discovery. It runs anywhere, for the CLI and the extension alike.
- **CLI** (`@plurid/aptuitive-cli`) is the agent kit: detection, scaffolding, the OpenAPI mapper and curation, block props from TypeScript, discovery and the integration check. A project keeps its files in one folder, `src/aptuitive` or `aptuitive` by default, recorded in its package.json as `aptuitive.dir`.
- **MCP** (`@plurid/aptuitive-mcp`) serves the agent kit's steps as tools over the Model Context Protocol, confined to the project. The Claude Code plugin in `plugins/claude-code` bundles it with the integration skill.
- **Apps** are demonstrations: the cloud console, built on sources, runnable actions and generic blocks, with two blocks of its own. Real open-source applications integrated by coding agents will show the rest.
- **Extension** (`apps/extension`) is the second front door: a Manifest V3 extension that applies **adapters** to pages Aptuitive doesn't own. Its service worker holds the person's keys and plans and reads official APIs with them; its content script finds anchors, applies effects with marks and one stylesheet, and draws redesigned pages in closed shadow roots; its side panel is where people ask, review and revert, repair an anchor with one click when a site changes, and forget everything. It is a private prototype, tested against the fictional dashboard in `tools/fixtures/payments-dashboard`.

## Scope

Decisions are recorded in `docs/adr/`.
