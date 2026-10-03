# ADR 0005: Planning at scale: areas, repair and streaming

- Status: accepted
- Date: 2026-10-03
- Extends ADR 0001, whose decision stands; this record changes how its consequences play out.

## Context

ADR 0001 compiles each contract into one structured-output schema, so every contract change recompiles a grammar and misses the prompt cache once. That holds for a cloud console with a few hundred actions. A product the size of a payments dashboard has hundreds of resources, thousands of fields and hundreds of actions: one schema would break the grammar limits (enum sizes, total size, compile time), and one prompt would cost tens of thousands of tokens on every request. A plan the model got partly wrong was also simply partly rejected, with no chance to fix it.

## Decision

Large contracts (more than eight sources) are planned in two stages.

1. **Retrieval** picks the request's **areas**, each a source with the actions that act on it and the routes that show it: the areas on screen, plus the two that rank best by BM25 over labels, descriptions, keywords, field names and enum values, at most eight sources. Actions that belong to no area come in when the request names them, at most twenty-four actions in all, besides the items lists hold. Retrieval lives in core, without dependencies, so the browser extension shares it.
2. **Planning** uses a schema and prompt compiled for that subset, cached by the contract's hash and the subset. Areas keep the number of distinct subsets small, so compiled grammars and prompt caches stay warm. If the API reports a grammar too complex to compile, the planner retries once with half the sources and without the application's own blocks.

The server runs the half of policy that needs no user state (`validateOutput`: contract names, what planners may do, page and query rules, item schemas). If it rejects part of a plan, the rejections go back to the model once, with the same schema, and the repaired plan replaces the first; the client still runs all of policy. Model calls stream where the SDK allows, and the handler answers clients that accept `application/x-ndjson` with progress lines, then the result or an error.

## Consequences

Schemas stay within the limits however large the contract: one union, no optional fields, enums of at most a few hundred values. The first request for a new subset waits for its grammar to compile; few distinct subsets and warming at deploy keep that rare. Lexical retrieval can miss synonyms, which keywords on sources soften. A repair round costs a second call, but only when the first plan broke the rules.
