# @plurid/aptuitive-planner

Aptuitive's model planner: it compiles a contract into a structured-output schema and a prompt, plans with Claude, and repairs a plan once when policy rejects part of it. Large contracts are planned over the part a request needs. It uses no Node or DOM APIs, so it runs on servers and in browser extensions alike.

```sh
pnpm add @plurid/aptuitive-planner @anthropic-ai/sdk zod
```

Aptuitive is a preview and not yet published: until it is, install it from the repository's tarballs, as [Getting started](https://github.com/plurid/aptuitive/blob/master/docs/getting-started.md#install) shows. Applications use it through [`@plurid/aptuitive-server`](https://github.com/plurid/aptuitive/blob/master/packages/server/README.md), which re-exports it:

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

- `anthropicPlanner()` reads the key from `ANTHROPIC_API_KEY` or an `ant auth login` profile. It takes `model` (`claude-opus-5-5` by default), `effort`, `maxTokens`, `timeoutMs` and your own `client`.
- `@plurid/aptuitive-planner/schema` and `@plurid/aptuitive-planner/prompt` need no SDK: tools use them to measure schemas and prompts.
- Keys stay with whoever pays: on the application's server, or in the person's own extension. Never in a page's code.

`@anthropic-ai/sdk` is an optional peer, needed only by `anthropicPlanner`; zod 4.2 or later is shared with the application. Read [Planning](https://github.com/plurid/aptuitive/blob/master/docs/planning.md) and the [API reference](https://github.com/plurid/aptuitive/blob/master/docs/api/planner.md). MIT licensed.
