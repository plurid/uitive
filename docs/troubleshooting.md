# Troubleshooting

Find the message or the symptom, then the fix. Messages are quoted as Uitive prints them.

## `uitive check`

**"contract.ts not found; run `uitive init` first"**: the command ran outside the application's package, or the Uitive folder is elsewhere. Run it where package.json is, or pass `--contract <file>`; `init --dir` records a folder in package.json as `uitive.dir`.

**"the module exports no contract: export one made with defineApp as `contract`"**: export the contract from `contract.ts`, made with `defineApp`.

**`actions: "Orders.Cancel" must match /^[a-z0-9][a-z0-9.:-]*$/`**: action IDs, route and region IDs, and context and choice values are lowercase, with dots, colons or dashes. Surfaces, contexts and blocks are camelCase. [Contracts](contracts.md#ids) lists every rule.

**`"orders.Cancel" collides with "orders.cancel" ignoring case`**: models can't be trusted with case, so IDs must differ by more than case.

**Errors from the contract's module itself**, such as an import that doesn't resolve: `check` loads the contract in Node, through the project's tsconfig paths. Aliases only the bundler knows don't resolve, so keep the contract importable on its own.

**"the contract changes when read back from JSON"**: one of its zod schemas is outside what the JSON contract carries, such as a transform. Use the `field` helpers or plain objects, strings, numbers, booleans, enums, arrays and nullables.

**schemas: "… optional fields", "… unions", "… bytes" or "an enum of …"**: a request schema is past what structured outputs accept: no optional fields, one union, 60,000 bytes and 400 enum values. Most often the contract is too large: curate it, as in [Coding agents](coding-agents.md#curation).

**"bindings.ts not found; it binds …" or "export `bindings` with fetch and perform"**: the bindings must export `bindings`, with `fetch` when the contract has sources and `perform` when actions have effects.

**"Two copies of zod: the application's … and Uitive's …"**: Uitive shares the application's zod. Install one zod, 4.2 or later, and let the package manager deduplicate it.

**"Actions share labels, so people can't tell them apart"**: give each action its own label; requests find actions by label.

**"Sources not found by their own labels"**: give those sources distinct labels, or `keywords`, so requests that name them find them.

## Installing and loading

**`init` warns that the project's zod is older than 4.2**: upgrade zod first; Uitive's schemas need 4.2 or later.

**`ERR_REQUIRE_ESM`, or `require()` of an ES module fails**: the packages are ES modules with a `default` export condition, which Node 22.12 and later can `require`. Update Node, or import them.

**The CLI or MCP server won't start**: they need Node 22 or later.

**`init --packages` says "install failed"**: installing from local tarballs, such as a build of this repository, the package manager couldn't resolve a package from them. `init` overrides every `@plurid/uitive-*` package with its tarball: in `pnpm-workspace.yaml` for pnpm 10 and later, which pnpm 11 requires, and in package.json otherwise. Pack all eight packages into the folder, and read the warnings `init` prints: an older `init` wrote pnpm's overrides into package.json, which pnpm 11 ignores (`The "pnpm" field in package.json is no longer read`).

## Commands and plans

**A request answers "unsupported"**: without a model, only plain commands work, such as `hide Bold`; [Planning](planning.md#without-a-model) lists them. Requests in plain words need the model planner on your server.

**A request answers "unavailable"**: the client has a model planner, but it couldn't be reached, and the request needs one. The adaptation's `meta.fellBack` says why, such as "server answered 401: Not allowed".

**"server answered 401: Not allowed"**: the handler's `authorize` refused the request. Its default allows only localhost; in production, check the session.

**"server answered 409: The application changed; reload the page"**: the client's contract isn't the server's. Deploy them together; a reload picks up the new client.

**"server answered 429: Too many requests; try again in a minute"**: over `perMinute`. Behind no proxy, every request shares one budget, because clients are told apart by `X-Forwarded-For`.

**"server answered 503: No Anthropic credentials", "No OpenAI credentials" or "No Gemini credentials"**: the server has no key for the model's provider. Set `ANTHROPIC_API_KEY` (or run `ant auth login`), `OPENAI_API_KEY` or `GEMINI_API_KEY` in the server's environment, never in client code.

**"server answered 502: The model's answer didn't follow the plan's form, even when asked again"**: the model couldn't keep to the schema. Use a model with structured output, or a stronger one; with a local server, try `structured: 'json'`.

**"Planning with Claude needs @anthropic-ai/sdk installed"**: `anthropic()` loads Anthropic's SDK when it first plans. Install it, or plan with another provider.

**The banner says "Not changed"**: the request named an item already as asked, such as hiding what is hidden, so nothing changed and the status is `done`.

**A request answers "ambiguous"**: the words fit several actions, listed in `candidates`. Use the label shown, or more of it.

**A request answers "not_allowed"**: policy refused it, such as hiding a required item, or a change the person reverted twice. Each rejection says which rule and why.

## Changes that don't appear

**A planned change hasn't applied**: planned changes apply only at safe moments, when a session starts after a break of 30 minutes (`idleMinutes`), so nothing moves while someone works. Also check:

- the autonomy: in `suggest`, changes wait for the person's yes;
- whether the interface is frozen;
- whether the person reverted the same change recently: it waits five sessions, and a second revert blocks it for good;
- in `mixed`, a model's change waits for a second plan to agree, unless the evidence is strong; the banner says how many changes will apply at the next session.

**Nothing learns from use**: the provider and `startUitive` plan once a session. With a client used without either, call `client.learn()` when a session starts, or `client.plan()` yourself; `learn: false` turns learning off.

**A redesign shows only as a suggestion**: a redesign the person didn't ask for always waits for them to accept it, whatever the autonomy.

**A list doesn't reorder in the markup**: `adaptMarkup` orders items with CSS `order`, which needs a flex or grid container. The console says so once: `the list "…" can't be reordered: its container isn't a flex or grid box`.

**Hidden items still show**: check that each item has `data-uitive-item` with the action's ID, inside a container with `data-uitive-list` naming the list, and that `startUitive` or `adaptMarkup` ran with the right `root` for markup in a shadow root.

## Actions and data

**"Nothing here can ask you to confirm this"**: a write or a destructive action ran from a generated page with no confirmation interface. Mount `<Confirmations />` in React, or `<uitive-confirm>` elsewhere.

**"Another change is waiting for your yes"**: one run waits for confirmation at a time.

**"Changes wait until you accept or dismiss the preview"**: data doesn't change while a redesign is being previewed.

**"This application reads no data"**: a page or `useQuery` asked for data, but the bindings have no `fetch`.

**A table says its result is partial**: the binding couldn't do all the query asked, so Uitive finished it on the client, and there were more rows to look through than `scan` allows (500 by default). Declare what the endpoint can do in the source's `capabilities` and the binding's `filters`, or raise `scan`.
