# ADR 0013: Planning at scale, revisited

- Status: accepted
- Date: 2026-10-09
- Amends ADR 0005; its two stages, its caching and its single repair round stand.

## Context

ADR 0005 scoped a request to areas only when a contract had more than eight sources, so a contract with few sources and hundreds of actions compiled to an enum past the limit providers accept. The retry for a schema too complex to compile could drop to no sources at all, and only some providers' messages for that case were recognized. A repair round that failed, from a cut answer, a refusal or a timeout, threw away a first plan that policy had mostly accepted. Prepared schemas were cached without the loose actions a request named, so one request could be planned with another's actions.

## Decision

- A request is also scoped when its whole schema's largest enum would exceed 400 values, and within a subset, forms and row actions offer only the runnable actions in scope.
- The retry for a schema too complex keeps what retrieval picked and fills up to half of the original sources, never fewer; any provider error that names the schema counts as too complex.
- A failed repair round keeps what policy accepted of the first answer, and says so in `meta.unrepaired`; a successful repair still replaces the first plan.
- Prepared schemas and prompts are cached by the contract's hash, the subset's sources and its actions.

## Consequences

Schemas stay within providers' limits for contracts of any shape, at the cost of scoping more requests. A partly rejected plan survives a provider's bad moment instead of failing the request. The cache holds a few more entries, one per set of loose actions requests name.
