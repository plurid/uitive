# ADR 0001: The model proposes, the contract constrains, policy disposes

- Status: accepted
- Date: 2026-10-03

## Context

The 2019 attempt planned to count clicks and hide what went unused. That is the mechanism of adaptive menus that users rejected: the interface moved under them, unpredictably, and they lost control. Research on adaptive interfaces is consistent that adaptation helps only when it is accurate, stable, additive and under the user's control.

Language models add what was missing: they can reason about what actions mean, start from a stated goal before any usage exists, take requests in plain language, and compose new items such as macros or saved views. They do not make an interface stable, cheap, private or deterministic.

## Decision

A model never writes interface code. Each application declares a typed contract of adaptable surfaces. A planner (the model on a server, or a deterministic heuristic in the core) proposes operations over contract IDs; for the model, the contract compiles to structured-output schemas, so out-of-contract output cannot be expressed. Policy checks every operation, a stabilizer decides when checked operations apply, and every applied operation can be reverted by the user. The heuristic planner is always available, so applications work offline and without a key.

## Consequences

Out-of-contract interface changes are unrepresentable rather than filtered. The model's contribution is bounded to choosing, composing and naming within the contract, which makes it testable. Every contract change is a schema change, so it recompiles grammars and misses the prompt cache once.
