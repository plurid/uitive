# Planning

A planner turns use and requests into proposed operations, which policy then checks. Aptuitive has two. The **deterministic planner** in core needs no model, no key and no network: it answers plain commands and learns from use. **Claude**, through the model planner on your server, answers requests in plain words, works towards a person's stated goal and redesigns pages. Whoever pays holds the key: the model planner runs on your server, and the browser only ever talks to your server.

## Without a model

The deterministic planner answers these commands at once, in the browser, whichever planner the client has:

| Command                                                             | What it does                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `hide Bold`, `remove Bold`, `get rid of Bold`                       | Moves Bold out of view, into overflow                                                      |
| `show Table`, `add Table`, `bring back Table`, `pin Table`          | Keeps Table in view, bringing it out of overflow if needed; after a hide, `show` undoes it |
| `unpin Table`                                                       | Lets Table move again; after a pin, reverts it                                             |
| `restore Bold`                                                      | Brings Bold back; after a hide, reverts it                                                 |
| `move Table to the top`, `put Table first`, `move Print to the end` | Moves an item in a reorderable list, out of overflow first if need be                      |
| `compact`, `use the compact density`                                | Sets a choice to one of its values                                                         |
| `reset the page`, `undo my layout`                                  | Puts the page in view back to standard                                                     |

Items are found by label, exactly, then by prefix, then by any part, and an unclear name answers `ambiguous` with the candidates. Anything else needs a model: without one, it answers `unsupported`.

## Learning from use

The provider in React, and `startAptuitive` without it, call `client.learn()` whenever a session starts: one plan from use, once a session. The deterministic planner promotes items people keep reaching for in overflow over items that sit unused, past a margin, so two items used about equally never trade places. What policy accepts applies at the next safe moment, as [How it works](how-it-works.md#commands-and-plans) describes.

With a model planner, each of those plans is one request to your server. Pass `learn: false` to `createAptuitive` to plan only when you call `client.plan()` yourself, such as from a button through `usePlan`.

## Claude on your server

The server owns the contract and the key. Create a handler with the contract, a planner and a way to tell who may ask:

<!-- example: docs/examples/server/handler.ts#handler -->

```ts
export const handler = createAptuitiveHandler({
  contract: shop,
  // Claude where the server has a key; the deterministic planner otherwise, as in development.
  planner: process.env.ANTHROPIC_API_KEY ? anthropicPlanner() : heuristicPlanner(),
  // Planning spends money: only signed-in people may ask. The default allows localhost only.
  authorize: (request) => /(^|;\s*)session=/.test(request.headers.get('cookie') ?? ''),
});
```

| Option      | What it does                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`  | The contract the application's clients use. Clients send only its hash; another hash answers 409.                                                                                  |
| `planner`   | Who plans, such as `anthropicPlanner()`.                                                                                                                                           |
| `authorize` | Whether a request may plan. Planning spends money, so the default only allows requests to localhost: in production, check the session.                                             |
| `maxBody`   | The largest request body, in bytes. The default is 131072 (128 KiB).                                                                                                               |
| `perMinute` | Requests per minute per client, told apart by `X-Forwarded-For`, so serve it behind a proxy that sets that header; without it, every request shares one budget. The default is 20. |
| `onError`   | Hears of failures, never request bodies. The default logs the message.                                                                                                             |

The handler answers `POST <base>/plan` and `POST <base>/command`: it takes a Fetch `Request` and returns a `Response`, so it runs wherever those exist.

**Next.js**: one dynamic route serves both.

<!-- example: docs/examples/server/next-route.ts -->

```ts
// app/api/aptuitive/[kind]/route.ts: one route serves both /plan and /command.
import { handler } from './handler.js';

export const POST = handler;
```

**Node, Express and Fastify**: `toNodeListener` from `@plurid/aptuitive-server/node` turns the handler into a `(request, response)` listener, in CommonJS or ES modules. A body that `express.json()` already parsed is used as it is, and progress streams as it is written.

<!-- example: docs/examples/server/node-server.ts#node -->

```ts
// In Express: app.use('/api/aptuitive', toNodeListener(handler)).
createServer(toNodeListener(handler)).listen(8787);
```

**Deno, Bun, Cloudflare Workers or Hono**: pass requests to the handler as they are.

## Connect the client

In the browser, `remotePlanner` sends requests to the handler, and the deterministic planner answers whatever the server can't:

<!-- example: docs/examples/server/client.ts#client -->

```ts
export const aptuitive = createAptuitive({
  contract: shop,
  store: localStore('shop'),
  bindings,
  // Claude through the application's server; simple commands still work when it can't answer.
  planner: remotePlanner({ url: '/api/aptuitive', fallback: heuristicPlanner() }),
});
```

- `url` is the handler's base: requests go to `<url>/plan` and `<url>/command`.
- `headers` go with every request, such as a token your `authorize` reads. Cookies go to a handler on the same origin.
- `timeoutMs` is 60 seconds for plans and 20 for commands.
- Simple commands never reach the server: "hide Bold" is answered in the browser, at no cost.
- When the server fails, the fallback answers, and the reason, such as "server answered 401: Not allowed", is kept in the adaptation's `meta.fellBack`. A request only a model could answer then says so: `unavailable`.

## The model planner

`anthropicPlanner()` plans with Claude through structured outputs: the contract compiles to the schema the model must answer in, so an answer can only name what the application offers. It reads the server's key from `ANTHROPIC_API_KEY` or an `ant auth login` profile.

| Option      | What it sets                                                    | Default              |
| ----------- | --------------------------------------------------------------- | -------------------- |
| `model`     | The model                                                       | `'claude-opus-5-5'`  |
| `effort`    | How much it thinks before answering; `low` keeps commands quick | `'low'`              |
| `maxTokens` | The most it may write, thinking included                        | `16000`              |
| `timeoutMs` | How long a plan may take                                        | `60000`              |
| `fallbacks` | The server-side refusal fallback                                | `true`               |
| `client`    | The Anthropic client, such as one with your own settings        | from the environment |

- **Keys** stay on the server. In development, keep the key in a gitignored `.env.local`; never put it in client code or in a variable the bundler exposes, such as `VITE_` or `NEXT_PUBLIC_`.
- **Caching**: one schema per contract, or per part of a large one, keeps the compiled grammar and the prompt cache warm between requests.
- **Repair**: when policy would reject part of a plan, the model gets one more round to repair it.
- **Cost** hasn't been measured with a live key yet.

## Statuses

The handler answers with these statuses; on any but 200, `remotePlanner` falls back:

| Status | When                                                                                        |
| ------ | ------------------------------------------------------------------------------------------- |
| 200    | A plan, or with `Accept: application/x-ndjson`, progress lines, then the result or an error |
| 400    | The body isn't JSON or a plan request, or a command is over 500 characters                  |
| 401    | `authorize` said no: "Not allowed"                                                          |
| 404    | Anything but `POST …/plan` or `POST …/command`                                              |
| 409    | The client's contract isn't the server's: "The application changed; reload the page"        |
| 413    | The body is over `maxBody`                                                                  |
| 429    | Over `perMinute`, or Anthropic's rate limit                                                 |
| 502    | The model declined, the plan was cut short, or Anthropic answered with an error             |
| 500    | Anything else went wrong: "Planning failed", with the details for `onError` only            |
| 503    | No Anthropic credentials, or Anthropic rejected them                                        |

## Large contracts

A request about a large contract is planned over a subset of it: the **areas** on screen and the few most relevant to the words, where an area is one source with the actions that act on it and the routes that show it. Past 40 sources or 200 actions, plans get worse, and `aptuitive check` says so: curate what the interface needs, as [Coding agents](coding-agents.md#curation) shows. [ADR 0005](adr/0005-planning-at-scale.md) has the details.

## Goals and autonomy

A **goal** is what the person wants from the application, in their words, such as "I watch costs". `client.ask(text, { goal: true })` keeps it, `setGoal` changes it, and planners read it whenever they plan.

**Autonomy** says how far planned changes may go without the person, who can change it in "Your interface":

| Autonomy  | What planned changes do                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| `suggest` | Wait for the person's yes                                                                |
| `mixed`   | Apply at a safe moment once a second plan agrees, or the evidence is strong. The default |
| `auto`    | Apply at the next safe moment; suggested items join the interface at once                |

In every mode, a redesign stays a suggestion until the person accepts it, and **freeze** stops planned changes while the person's own still apply.

## What the planner sees

`client.request()` returns exactly what a planner receives: the contract's hash, usage as numbers, the current state of each surface, the route and the words of a request. Never rows, never params, never text typed into the application. [Privacy and security](privacy-and-security.md) has the full list.
