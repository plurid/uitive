# @plurid/uitive-server

The handler that serves Uitive's model planner: a Fetch-standard function, with limits and streaming progress, that holds the contract and the key so the browser never sees either. The client's `remotePlanner` calls it.

```sh
pnpm add @plurid/uitive-core @plurid/uitive-server zod
```

Create the handler with the contract, a planner and a way to tell who may ask:

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

In Next.js, one route serves both kinds of request:

<!-- example: docs/examples/server/next-route.ts -->

```ts
// app/api/uitive/[kind]/route.ts: one route serves both /plan and /command.
import { handler } from './handler.js';

export const POST = handler;
```

In Express, Fastify or `node:http`, in CommonJS or ES modules, `toNodeListener` adapts it:

<!-- example: docs/examples/server/node-server.ts#node -->

```ts
// In Express: app.use('/api/uitive', toNodeListener(handler)).
createServer(toNodeListener(handler)).listen(8787);
```

- **`authorize` first**: planning spends money, so every handler says who may plan, with the application's own session check; there is no default.
- It takes only same-site JSON, checks every request's shape, limits requests to 20 a minute per client and 128 KiB each, and never logs bodies. The browser hears only what failed; the details go to `onError`.
- Clients that accept `application/x-ndjson` get progress lines, then the result.
- It re-exports [`@plurid/uitive-planner`](https://github.com/plurid/uitive/blob/master/packages/planner/README.md), with Anthropic's SDK included for `anthropic()`; OpenAI-compatible servers and Gemini need nothing more.

It runs wherever `Request` and `Response` exist, such as Node 22, Deno, Bun or Cloudflare Workers, and needs zod 4.2 or later. Read [Planning](https://github.com/plurid/uitive/blob/master/docs/planning.md) and the [API reference](https://github.com/plurid/uitive/blob/master/docs/api/server.md). MIT licensed.
