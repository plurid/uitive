# Changelog

Every package is released together, at one version.

## 0.2.0 (2026-10-10)

A release of fixes, after an audit of every package. It closes security holes in the planner's handler and the agent kit, so everyone on 0.1.0 should upgrade.

### Upgrade from 0.1.0

1. **Give the handler an `authorize`.** `createUitiveHandler` requires one; 0.1.0 let in any request whose address named a local host, which a client can claim. Check the person's session, as the server example does; `init` writes a placeholder to replace:

<!-- example: docs/examples/server/handler.ts#handler -->

```ts
// Whichever model the server has a key for: Anthropic, OpenAI or Gemini.
const model = environmentModel();

export const handler = createUitiveHandler({
  contract: shop,
  // Without a key, as in development, the deterministic planner answers plain commands.
  planner: model ? modelPlanner({ model }) : heuristicPlanner(),
  // Planning spends money: only signed-in people may ask. Use the application's own session
  // check, the one its API makes; there is no default.
  authorize: async (request) => (await getSession(request)) !== undefined,
});
```

The handler takes only JSON (`content-type: application/json`, which `remotePlanner` sends) and refuses requests a browser marks cross-site. Behind a proxy that rewrites `X-Forwarded-For` in its own way, pass `client(request)` to key the rate limit.

2. **Deploy the server and its clients together.** A contract's hash now covers its standard pages, so every contract gets a new one. A client planning against an older hash is answered 409 until it reloads, and stored definitions migrate once on load, keeping every change that is still valid.

3. **Rename `canonicaliser` to `canonicalizer`**, if you use it.

4. **Move adapters to format 2**, if you write them for the extension: set `formatVersion: 2`, move `testMode` from each connector to the adapter, and list `keys.test` only when the adapter has a test mode. [ADR 0017](docs/adr/0017-adapter-format-2.md) has the new fields.

5. **Check amounts in the currencies whose minor units changed.** Minor units now follow ISO 4217, from a table in core, instead of the runtime's display rules: the Indonesian rupiah, Colombian peso, Hungarian forint, Pakistani rupee, Malagasy ariary and Lao kip have two decimal places, the Iraqi dinar three. Where an API counts differently, say so with `field.money({ digits })` or, for generated sources, the curation's `money.digits`.

6. **Style the default dialog by its new element**, if you restyled it: the kit's `Dialog` and `<uitive-confirm>` are native `<dialog>` elements; `.uitive-dialog-backdrop` is gone, so style `.uitive-dialog::backdrop`.

### Security

- `@plurid/uitive-server`: a malformed `Host` header or a `null` body crashed a `node:http` or Express server through `toNodeListener`; the adapter now answers every request and never builds a URL from `Host`. The default `authorize` trusted the client's `Host`; it is required now (see above). Provider error bodies and internal host names no longer reach the browser: it gets a fixed message per status, and `onError` gets the details. Requests are checked against a schema of the plan request, with every string and list capped, and bodies are measured in bytes as they are read.
- `uitive` and `@plurid/uitive-mcp`: an API description's title could inject code into a generated module, which `uitive check` then ran; every emitted string is quoted safely now, and generated files are parsed before they are written. The MCP server no longer reaches outside its root through symbolic links, absolute component paths, a `uitive.dir` of `..`, or `init` writing to a repository above it.
- `@plurid/uitive-core`: `import()` now runs every imported change through policy, so a shared file can't exceed caps, carry unchecked queries, or leave the client unable to plan.

### Changed

- **Commands and stated goals apply at once; planned changes alone wait** for a safe moment, the budget, dwell and agreement between plans from different sessions ([ADR 0011](docs/adr/0011-commands-and-what-a-model-may-claim.md)). A model's answer never deletes one of the person's own pages or brings back a change they blocked.
- **Generated writes confirm as every value is shown**: a form that shows every value it will send counts as the yes; buttons, destructive runs and forms that can't show a value wait for `<Confirmations />`, and are refused without one. Forms parse what is typed as policy checks it, so "yes" is true and `$5` is 5 dollars.
- `reset()` keeps the freeze, blocked changes, cooldowns and the stated goal; it puts the layout back.
- A second tab or a reload is no longer a safe moment for a tab in use. A tab running an older version of the application leaves a newer tab's state alone and tells `onError`.
- Time: `d` and `w` follow the calendar across daylight saving changes, hour buckets follow the local clock, and time groups are labeled locally (`2026-10-03`, `2026-10`). `field.time({ unit: 'date' })` is new, and `z.iso.date()` infers it.
- Keys and references compare exactly, case included; text and enum values still ignore case.
- `restFetch` throws on a pushed filter, sort or search it has no mapping for, instead of dropping it; `restPerform` refuses `.`, `..` and empty path params. A 404 on a row lookup is a missing row.
- JSON contracts carry no regular expressions: `pattern` is refused when written and when read.
- `outputSchema` refuses block props that hold a record, a union or a nullable value, which providers' structured outputs can't take; `uitive check` names the prop.
- `environmentModel()` reads `UITIVE_MODEL` as `provider:model`, or infers the provider from the model's name.
- `uitive check` also measures the largest schema a request can reach; shared labels warn ([ADR 0014](docs/adr/0014-the-agent-kit-gate-and-confinement.md)). `generate sources` skips writes whose required parameters a run can't send, gives colliding operations IDs from their paths, and errs further toward destructive effects.
- The MCP tools resolve every path against `cwd`, and write generated files only into the Uitive folder.
- `@plurid/uitive-adapter`: format 2, where a site's test mode and its connectors' keys and auth are data ([ADR 0017](docs/adr/0017-adapter-format-2.md)). The extension builds from adapter folders, and adapters for real sites are maintained by Uitive ([ADR 0016](docs/adr/0016-adapters-for-real-sites-are-the-product.md)); this repository ships a demo for a fictional dashboard.

### Fixed

- **Money**: a sum over an amount one relation away checked the wrong row's currency, and an aggregate over one never fetched it; charts no longer stack or total amounts in different currencies, and confirmations show amounts in their own currency.
- **Data**: a source without paging was read as one page of 100 rows and called complete; a full page now marks the result partial, as does a relation left unresolved. A time grouping with an empty time filled from 1970; hourly buckets over long spans dropped the latest; an invalidation during a fetch was lost; `ttl: 0` refetched forever; relative-time results flashed Loading every minute. `$me` works in page queries, from `bindings.context()`.
- **React**: a metric compared with the period before refetched forever; a form submitted twice wrote twice; several hooks broke hydration; chart, timeline, board and detail never said a result was partial; dialogs, tabs and the More menu manage focus and keys.
- **DOM**: the banner and "Your interface" show "Stop preview" while previewing; a list hidden when adapted reorders once shown; styles work under a strict Content Security Policy.
- **Planner**: a failed repair round no longer discards a plan policy mostly accepted; schemas never hold empty enums or exceed providers' limits on small contracts; streaming errors and timeouts report as such; Claude models are sent `effort` and fallbacks only where they take them.
- **Client**: plans that finish after "forget everything" no longer return the forgotten usage; a preview no longer outlives its suggestion and blocks every write; the definition no longer grows without bound.
- **Agent kit**: `init` keeps an existing MCP entry and never writes outside its root; discovery sees closed menus, keeps dialog buttons and row data out of actions, and finishes on pages that keep polling; the OpenAPI mapper handles recursive schemas.

### Added

- `field.money({ digits })` and the curation's `money.digits`, for minor units that differ from ISO 4217.
- `routeLabel`, `HandlerOptions.client`, `planRequestSchema`, `ProviderProps.nonce` for the kit's styles, `ChartPoint.currency`, and `PlanMeta.unrepaired`.
- The extension's build takes `--adapters <dir>`, `--check` and `--fixture-adapter <id>`.

## 0.1.0 (2026-10-04)

The first release.
