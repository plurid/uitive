# @plurid/aptuitive-server

The handler that serves Aptuitive's model planner: a Fetch-standard function, with limits and streaming progress, that holds the contract and the key so the browser never sees either. The client's `remotePlanner` calls it.

```sh
pnpm add @plurid/aptuitive-server zod
```

Aptuitive is a preview and not yet published: until it is, install it from the repository's tarballs, as [Getting started](https://github.com/plurid/aptuitive/blob/master/docs/getting-started.md#install) shows. Create the handler with the contract, a planner and a way to tell who may ask:

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

In Next.js, one route serves both kinds of request:

<!-- example: docs/examples/server/next-route.ts -->

```ts
// app/api/aptuitive/[kind]/route.ts: one route serves both /plan and /command.
import { handler } from './handler.js';

export const POST = handler;
```

In Express, Fastify or `node:http`, in CommonJS or ES modules, `toNodeListener` adapts it:

<!-- example: docs/examples/server/node-server.ts#node -->

```ts
// In Express: app.use('/api/aptuitive', toNodeListener(handler)).
createServer(toNodeListener(handler)).listen(8787);
```

- **`authorize` first**: planning spends money, so by default only requests to localhost may plan. In production, check the session.
- Requests are limited to 20 a minute per client and 128 KiB each, and bodies are never logged.
- Clients that accept `application/x-ndjson` get progress lines, then the result.
- It re-exports [`@plurid/aptuitive-planner`](https://github.com/plurid/aptuitive/blob/master/packages/planner/README.md), with the Anthropic SDK included.

It runs wherever `Request` and `Response` exist, such as Node 22, Deno, Bun or Cloudflare Workers, and needs zod 4.2 or later. Read [Planning](https://github.com/plurid/aptuitive/blob/master/docs/planning.md) and the [API reference](https://github.com/plurid/aptuitive/blob/master/docs/api/server.md). MIT licensed.
