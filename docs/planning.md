# Planning

A planner turns use and requests into proposed operations, which policy then checks. Uitive has two. The **deterministic planner** in core needs no model, no key and no network: it answers plain commands and learns from use. **A language model**, from any provider, through the model planner on your server, answers requests in plain words, works toward a person's stated goal and redesigns pages. Whoever pays holds the key: the model planner runs on your server, and the browser only ever talks to your server.

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

The provider in React, and `startUitive` without it, call `client.learn()` whenever a session starts: one plan from use, once a session. The deterministic planner promotes items people keep reaching for in overflow over items that sit unused, past a margin, so two items used about equally never trade places. What policy accepts applies at the next safe moment, as [How it works](how-it-works.md#commands-and-plans) describes.

With a model planner, each of those plans is one request to your server. Pass `learn: false` to `createUitive` to plan only when you call `client.plan()` yourself, such as from a button through `usePlan`.

## A model on your server

The server owns the contract and the key. Create a handler with the contract, a planner and a way to tell who may ask:

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

`environmentModel()` picks whichever provider the server has a key for: `ANTHROPIC_API_KEY`, else `OPENAI_API_KEY`, else `GEMINI_API_KEY`. `UITIVE_MODEL` names the model, with its provider first when the name doesn't tell it (`openai:my-finetune`); a model whose name does (`claude-…`, `gpt-…`, `gemini-…`) plans only with its own provider's key. To choose one yourself, see [Choosing a model](#choosing-a-model).

`authorize` has no default: say who may plan, with the application's own check of the person's session. `getSession` above stands for that check; a cookie's name alone proves nothing. Until the application has one, `() => process.env.NODE_ENV !== 'production'`, as `init` writes it, keeps local development working and refuses everyone once deployed.

| Option      | What it does                                                                                                                                                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`  | The contract the application's clients use. Clients send only its hash; another hash answers 409.                                                                                                                                                                                                               |
| `planner`   | Who plans, such as `modelPlanner({ model })`.                                                                                                                                                                                                                                                                   |
| `authorize` | Required. Whether a request may plan: the application's check of the person's session. Planning spends money, so there is no default.                                                                                                                                                                           |
| `maxBody`   | The largest request body, in bytes. The default is 131072 (128 KiB).                                                                                                                                                                                                                                            |
| `perMinute` | Requests per minute per client. The default is 20.                                                                                                                                                                                                                                                              |
| `client`    | Tells clients apart for `perMinute`. The default is the right-most `X-Forwarded-For` entry, the one the proxy in front of the server wrote, so serve it behind a proxy that sets that header; without one, every request shares one budget. Behind several proxies, return the address your own proxy recorded. |
| `onError`   | Hears of failures, with their details, never request bodies. The default logs the message.                                                                                                                                                                                                                      |

The handler answers `POST <base>/plan` and `POST <base>/command`: it takes a Fetch `Request` and returns a `Response`, so it runs wherever those exist. It takes only JSON (`content-type: application/json`, which makes a browser ask the server before sending one from another origin) and refuses requests a browser marks as cross-site. Every request's shape is checked before a planner sees it: types, lengths and list sizes, the request and the goal at most 500 characters. The browser is told only what failed, such as "The model couldn't make a plan"; what a provider said, and the address of a model's server, go to `onError`.

**Next.js**: one dynamic route serves both.

<!-- example: docs/examples/server/next-route.ts -->

```ts
// app/api/uitive/[kind]/route.ts: one route serves both /plan and /command.
import { handler } from './handler.js';

export const POST = handler;
```

**Node, Express and Fastify**: `toNodeListener` from `@plurid/uitive-server/node` turns the handler into a `(request, response)` listener, in CommonJS or ES modules. A body that `express.json()` already parsed is used as it is, and progress streams as it is written. It refuses bodies over its own `maxBody`, 128 KiB by default, before the handler reads them, so raise both together. The handler sees the request's path and query under a fixed origin, never the Host header, which the client writes. A request it can't read answers 400, and a handler that throws, 500: the listener never rejects, so the server never stops on one.

<!-- example: docs/examples/server/node-server.ts#node -->

```ts
// In Express: app.use('/api/uitive', toNodeListener(handler)).
createServer(toNodeListener(handler)).listen(8787);
```

**Deno, Bun, Cloudflare Workers or Hono**: pass requests to the handler as they are.

## Connect the client

In the browser, `remotePlanner` sends requests to the handler, and the deterministic planner answers whatever the server can't:

<!-- example: docs/examples/server/client.ts#client -->

```ts
export const uitive = createUitive({
  contract: shop,
  store: localStore('shop'),
  bindings,
  // A model through the application's server; simple commands still work when it can't answer.
  planner: remotePlanner({ url: '/api/uitive', fallback: heuristicPlanner() }),
});
```

- `url` is the handler's base: requests go to `<url>/plan` and `<url>/command`.
- `headers` go with every request, such as a token your `authorize` reads. Cookies go to a handler on the same origin.
- `timeoutMs` is how long it waits for the server: 60 seconds for plans and 20 for commands. While progress streams, each line starts the wait again, so a long redesign that keeps reporting isn't cut short. A `signal` of the caller's own stops it too.
- Simple commands never reach the server: "hide Bold" is answered in the browser, at no cost.
- When the server fails, the fallback answers, and the reason, such as "server answered 401: Not allowed", is kept in the adaptation's `meta.fellBack` and passed to the client's `onError`. A request only a model could answer then says so: `unavailable`.

## Choosing a model

`modelPlanner({ model })` plans with any language model that can answer in JSON. The contract compiles to the JSON Schema the answer must follow, so a model that keeps to it can only name what the application offers. Every answer is checked against the schema all the same, and one that strays, or that policy would partly reject, goes back once for repair.

<!-- example: docs/examples/server/models.ts#providers -->

```ts
// Claude: reads ANTHROPIC_API_KEY, or an `ant auth login` profile.
export const claude = modelPlanner({ model: anthropic({ model: 'claude-sonnet-5-5' }) });

// OpenAI: reads OPENAI_API_KEY.
export const gpt = modelPlanner({ model: openai({ model: 'gpt-6.1-sol' }) });

// Gemini: reads GEMINI_API_KEY.
export const gemini = modelPlanner({ model: google({ model: 'gemini-3.8-flash' }) });
```

| Model               | Provider                                     | Key                                                 | How it keeps to the schema                                  |
| ------------------- | -------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `anthropic()`       | Anthropic                                    | `ANTHROPIC_API_KEY`, or an `ant auth login` profile | Structured outputs                                          |
| `openai({ model })` | OpenAI, and every server that speaks its API | `OPENAI_API_KEY`, for OpenAI's own API              | Strict JSON Schema; `json` or `text` for servers without it |
| `google({ model })` | Gemini                                       | `GEMINI_API_KEY` or `GOOGLE_API_KEY`                | Structured output (`responseJsonSchema`)                    |

- Each takes `apiKey`, for runtimes without a process environment such as Cloudflare Workers, where `environmentModel(env)` takes their variables too, and `timeoutMs`, 60 seconds by default.
- `anthropic()` also takes `effort` (`low` by default), `fallbacks` and a `client`, and sends effort and the refusal fallback only to models that take them: no Haiku has the fallback, and Haiku 4.5 takes no effort. It needs `@anthropic-ai/sdk`, which the server package brings.
- `openai()` takes `baseURL`, `headers`, `structured`, `reasoningEffort` and `prices`; `google()` takes `baseURL`, `structured`, `thinkingBudget` and `prices`. Both call `fetch`, with no SDK.
- `modelPlanner` takes `maxTokens`, 16000 by default. The [API reference](api/planner.md#models) has every option.

**Local models and other providers**: Ollama, vLLM, LM Studio, OpenRouter, Groq and most others speak OpenAI's API, so `openai()` reaches them through `baseURL`.

<!-- example: docs/examples/server/models.ts#local -->

```ts
// Any server that speaks OpenAI's API, such as Ollama on this machine: no key, and JSON mode for
// models without structured outputs.
export const local = modelPlanner({
  model: openai({ model: 'qwen3', baseURL: 'http://localhost:11434/v1', structured: 'json' }),
});
```

Models that can't constrain their answer to a schema still plan. With `structured: 'json'` or `'text'`, the schema goes in the prompt, and answers are checked and repaired once. Policy checks every operation either way, so a weaker model can make worse plans, never unsafe ones.

**Any other model**: implement `Model`, one `generate` call that returns the answer's text, how it stopped and the tokens it used.

<!-- example: docs/examples/server/models.ts#custom -->

```ts
// Any other provider: one call that returns the answer's text, how it stopped and what it used.
export const acme: Model = {
  provider: 'acme',
  name: 'acme-large',
  structured: 'json',
  async generate(call) {
    const response = await fetch('https://llm.acme.example/v1/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.ACME_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
        system: `${call.rules}\n\n${call.contract}`,
        messages: call.messages,
        maxTokens: call.maxTokens,
      }),
    });
    const answer = (await response.json()) as {
      text: string;
      truncated: boolean;
      tokens: { read: number; written: number };
    };
    return {
      text: answer.text,
      stop: answer.truncated ? 'cut' : 'done',
      model: 'acme-large',
      usage: {
        input: answer.tokens.read,
        output: answer.tokens.written,
        cacheRead: 0,
        cacheWrite: 0,
      },
    };
  },
};
```

- **Keys** stay on the server. In development, keep them in a gitignored `.env.local`; never put one in client code or in a variable the bundler exposes, such as `VITE_` or `NEXT_PUBLIC_`.
- **Caching**: the rules and the contract lead every call unchanged, so providers' prompt caches serve them; Anthropic's is marked explicitly. One schema per contract, or per part of a large one, keeps compiled grammars warm.
- **Schemas too big** for a provider are planned again over a smaller part of the contract.
- **Cost**: Claude models report what each plan cost; for others, give `prices`. Plans haven't been measured with live keys yet.

[ADR 0008](adr/0008-any-model-plans.md) records why planning works this way.

## Statuses

The handler answers with these statuses; on any but 200, `remotePlanner` falls back. Failures from the model say only what the status means; the details go to `onError`:

| Status | When                                                                                                                                                                                                                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | A plan, or with `Accept: application/x-ndjson`, progress lines, then the result or an error                                                                                                                                                                                                                          |
| 400    | The body isn't JSON or a plan request, or a command is over 500 characters                                                                                                                                                                                                                                           |
| 401    | `authorize` said no: "Not allowed"                                                                                                                                                                                                                                                                                   |
| 403    | The browser marked the request cross-site                                                                                                                                                                                                                                                                            |
| 404    | Anything but `POST …/plan` or `POST …/command`                                                                                                                                                                                                                                                                       |
| 409    | The client's contract isn't the server's: "The application changed; reload the page"                                                                                                                                                                                                                                 |
| 413    | The body is over `maxBody`                                                                                                                                                                                                                                                                                           |
| 415    | The body isn't sent as `application/json`                                                                                                                                                                                                                                                                            |
| 429    | Over `perMinute`, or the provider's rate limit: "The model is busy; try again shortly"                                                                                                                                                                                                                               |
| 499    | The client went away while the model planned: "Canceled"                                                                                                                                                                                                                                                             |
| 500    | Anything else went wrong: "Planning failed"                                                                                                                                                                                                                                                                          |
| 502    | "The model couldn't make a plan": it declined, its plan was cut short, its answer didn't follow the schema even when asked again, or the provider failed or timed out. When only the repair fails, after a first answer that policy partly accepted, that part is kept instead, with the reason in `meta.unrepaired` |
| 503    | "Planning is unavailable": no credentials for the model's provider, or the provider rejected them                                                                                                                                                                                                                    |

## Large contracts

A request about a large contract is planned over a subset of it: the **areas** on screen and the few most relevant to the words, where an area is one source with the actions that act on it and the routes that show it. A contract with few sources is scoped the same way when one of its enums would pass 400 values, such as hundreds of actions. Past 40 sources or 200 actions, plans get worse, and `uitive check` says so: curate what the interface needs, as [Coding agents](coding-agents.md#curation) shows. [ADR 0005](adr/0005-planning-at-scale.md) has the details.

## Goals and autonomy

A **goal** is what the person wants from the application, in their words, such as "I watch costs". `client.ask(text, { goal: true })` keeps it and applies what serves it at once, like any command; `setGoal` changes it, up to 500 characters, and a blank one clears it. Planners read it whenever they plan.

**Autonomy** says how far planned changes may go without the person, who can change it in "Your interface":

| Autonomy  | What planned changes do                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `suggest` | Wait for the person's yes                                                                                                         |
| `mixed`   | Apply at a safe moment; a model's changes wait for a plan in a later session to agree, unless the evidence is strong. The default |
| `auto`    | Apply at the next safe moment; suggested items join the interface at once                                                         |

In every mode, a redesign stays a suggestion until the person accepts it, and **freeze** stops planned changes while the person's own still apply.

## What the planner sees

`client.request('plan')`, or `client.request('command', words)`, returns exactly what a planner receives: the contract's hash, usage as numbers, the current state of each surface, the route and the words of a request. Never rows, never params, never text typed into the application. [Privacy and security](privacy-and-security.md) has the full list.
