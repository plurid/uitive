# Privacy and security

Uitive adapts an interface from how it is used, so it is built to learn as little as it needs and to keep it with the person. This page lists exactly what leaves the device, who holds keys, and what stands between a model and the application.

## What a planner sees

`client.request()` returns exactly what a planner would receive: all that ever leaves the device. Call it to see for yourself.

| Part       | What it holds                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `contract` | The contract's ID and hash. The server holds the contract itself                                                                 |
| `summary`  | Usage as numbers, per action and surface: uses, sessions with a use, how actions were reached, decayed scores                    |
| `state`    | The interface as IDs: each list's visible and pinned items, choices, the pages in view, the person's own decisions and cooldowns |
| `contexts` | Context values active now, such as `tool: pen`                                                                                   |
| `route`    | The route in view, such as `orders.detail`; never the row it shows                                                               |
| `text`     | A request, in the words the person typed into Uitive                                                                             |
| `goal`     | The goal the person stated, if any                                                                                               |

It never holds:

- **Rows**: planners see sources' schemas, never their data. Queries a planner writes run through the application's bindings, in the browser, with the person's own permissions.
- **Params**: usage records which action ran and how it was reached, never what it ran with.
- **Text typed into the application**, or the page's content.

## Usage and storage

A usage event is an action's ID, how it was reached, the session, and optionally the surface, the page element and the contexts. The client keeps the last 2,000 events and 30 sessions, with the person's definition, in its store: with `localStore`, in the browser's `localStorage`, under the key you give it.

The person controls all of it in "Your interface": **export** downloads their definition as JSON, **import** brings it to another device, checked like any change, **reset** goes back to the standard interface and keeps usage, and **forget** (`client.clearData()`) deletes usage, definition and history.

## Whoever pays holds the key

Model calls cost money, and the key belongs to whoever pays for them ([ADR 0006](adr/0006-two-front-doors.md)).

- **In an application**, the planner runs on your server, with your key for the model's provider. The browser talks to your server, never to the provider, and never sees a key. Keep the key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`) in the server's environment, in a gitignored `.env.local` in development, and never in a variable the bundler exposes, such as `VITE_` or `NEXT_PUBLIC_`.
- **In the browser extension**, the person's own key, for Claude, OpenAI or Gemini, stays with the extension's service worker, and no planner ever receives a third-party page's text.

## The server

`createUitiveHandler` is the only part that spends money, so it guards itself:

- **`authorize`** decides who may plan. The default allows only requests to localhost, so a deployed handler refuses everyone until you check the session, as in [Planning](planning.md#a-model-on-your-server).
- **Limits**: 20 requests a minute per client by default (`perMinute`), told apart by `X-Forwarded-For`, so put the handler behind a proxy that sets it; bodies up to 128 KiB (`maxBody`); commands up to 500 characters.
- **The contract stays on the server**. Clients send only its hash, and a request made with another hash is refused, so no client can widen what a planner may name.
- **Bodies are never logged**. `onError` hears of failures without them.

## Policy is the boundary

A model's answer is data, never code, and it passes through the same checks as any change:

- The contract compiles to the schema the model must answer in, so a model that keeps to it can only name the application's actions, surfaces, blocks and fields. Answers from models that can't keep to a schema are checked against it, and nothing they name outside the contract gets past policy.
- Policy checks every operation: required items stay, every action stays reachable, the person's own decisions outrank the model's, and the application's validators run. What fails is refused with a reason the person reads.
- Pages pass their schemas, size and depth limits, and every query passes field by field before it runs. A page never executes anything.
- Planners never run actions. Nothing changes data without the person's yes: one step for a write, a typed phrase for a destructive run, and with no interface able to ask, the run is refused.
- Every applied change can be reverted, and the standard view is always one step away.

The invariants behind these rules are in [CONTEXT.md](../CONTEXT.md#invariants).

## In the page

- The elements escape every value they render, and render in shadow roots.
- `adaptMarkup` hides items with a constructable stylesheet, which works under a strict `style-src` policy, and moves no nodes.
- Actions with effects run through your bindings, with the person's own session, so Uitive can do nothing the person couldn't.

## The browser extension

The extension prototype applies Uitive to sites it doesn't own. Page text never reaches a planner: only the structure it found. It reads data through official APIs with the person's own key, never by replaying a site's internal requests, keeps everything on the device, and "Forget everything" deletes it all. Its README has the details: [apps/extension/README.md](../apps/extension/README.md).
