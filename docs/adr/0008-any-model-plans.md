# ADR 0008: Any model plans

- Status: accepted
- Date: 2026-10-03

## Context

The model planner was written for Claude: `anthropicPlanner` made the call with Anthropic's SDK, and the planner's entry point imported that SDK even for applications that never used it. Applications choose their model provider for reasons of their own, such as price, a contract with a vendor, data residency or a model running on their own machines, and an SDK that plans with one provider only is one they can't adopt. Everything else about planning was already provider-neutral: the request and result formats, the server's handler, `remotePlanner`, scoping large contracts, the schema compiled from the contract, the prompt, policy and the repair round.

## Decision

Planning is one provider-neutral loop, `modelPlanner({ model })`, over a small `Model` interface: one `generate` call that takes the rules, the contract as text, the conversation and the JSON Schema, and returns the answer's text, how it stopped and the tokens it used. Built-in models cover the main providers with no extra dependencies where possible: `anthropic()` loads Anthropic's SDK only when it plans; `openai()` and `google()` call `fetch`. `openai()` speaks OpenAI's Chat Completions API, so its `baseURL` reaches every server that speaks it too, such as Ollama, vLLM, LM Studio, OpenRouter and Groq. Applications implement `Model` for anything else. `environmentModel()` picks whichever provider the environment has a key for, and the examples, `init`'s server template and the demonstrations use it.

The schema stays the boundary. Each built-in model passes it in its provider's dialect: Anthropic's structured outputs take it as compiled; OpenAI's strict mode and Gemini's `responseJsonSchema` take each `const` as a one-value `enum`. Models that can't constrain their output to a schema still plan, on a best-effort basis: the schema goes in the prompt, and the answer is checked against it. Every answer is checked, whatever the model, and one that strays, or that policy would partly reject, goes back once for repair. Policy then checks every operation as before, so a weaker model can make worse plans, never unsafe ones. A provider that finds a schema too big gets the request again over a smaller part of the contract.

Whoever pays still holds the key (ADR 0006). In applications, each provider's key stays in the server's environment; in the extension, the person's own key, for Claude, OpenAI or Gemini, stays with its service worker.

## Consequences

Applications plan with the provider they already use, or with a model on their own machines. Answers are validated against the schema on every call, which costs little and also catches servers that accept a schema and ignore it. Prices are known only for Claude models; other models report cost when given `prices`. Each built-in model follows its provider's API, so a provider's changes reach one adapter, not the loop. Plan quality differs between models and hasn't been measured with live keys; the findings will compare providers once keys are available.
