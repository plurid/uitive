# @plurid/uitive-planner

Uitive's model planner, for any provider. It compiles a contract into the JSON Schema a model must answer in and a prompt, plans with a language model, and repairs an answer once when it strays from the schema or policy rejects part of it. Large contracts are planned over the part a request needs. It uses no Node or DOM APIs, so it runs on servers and in browser extensions alike.

```sh
pnpm add @plurid/uitive-planner zod
```

Applications use it through [`@plurid/uitive-server`](https://github.com/plurid/uitive/blob/master/packages/server/README.md), which re-exports it, with the model the server has a key for:

<!-- example: docs/examples/server/handler.ts#handler -->

```ts
// Whichever model the server has a key for: Anthropic, OpenAI or Gemini.
const model = environmentModel();

export const handler = createUitiveHandler({
  contract: shop,
  // Without a key, as in development, the deterministic planner answers plain commands.
  planner: model ? modelPlanner({ model }) : heuristicPlanner(),
  // Planning spends money: only signed-in people may ask. The default allows localhost only.
  authorize: (request) => /(^|;\s*)session=/.test(request.headers.get('cookie') ?? ''),
});
```

Or choose the model yourself:

<!-- example: docs/examples/server/models.ts#providers -->

```ts
// Claude: reads ANTHROPIC_API_KEY, or an `ant auth login` profile.
export const claude = modelPlanner({ model: anthropic({ model: 'claude-sonnet-5-5' }) });

// OpenAI: reads OPENAI_API_KEY.
export const gpt = modelPlanner({ model: openai({ model: 'gpt-6.1-sol' }) });

// Gemini: reads GEMINI_API_KEY.
export const gemini = modelPlanner({ model: google({ model: 'gemini-3.8-flash' }) });
```

- `anthropic()` plans with Claude through structured outputs. It needs `@anthropic-ai/sdk`, an optional peer loaded only when it plans.
- `openai({ model })` reaches OpenAI and, through `baseURL`, every server that speaks its API, such as Ollama, vLLM, LM Studio, OpenRouter and Groq. `google({ model })` reaches Gemini. Both call `fetch`.
- Models without structured output plan too, with `structured: 'json'` or `'text'`: answers are checked against the schema and repaired once.
- `Model` is one `generate` call, for any other provider; `environmentModel()` picks whichever provider the environment has a key for.
- `@plurid/uitive-planner/schema` and `@plurid/uitive-planner/prompt` need no SDK: tools use them to measure schemas and prompts.

Keys stay with whoever pays: on the application's server, or in the person's own extension, never in a page's code. zod 4.2 or later is shared with the application. Read [Planning](https://github.com/plurid/uitive/blob/master/docs/planning.md) and the [API reference](https://github.com/plurid/uitive/blob/master/docs/api/planner.md). MIT licensed.
