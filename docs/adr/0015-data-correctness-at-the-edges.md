# ADR 0015: Data correctness at the edges

- Status: accepted
- Date: 2026-10-09
- Refines ADR 0002; its decision stands.

## Context

ADR 0002 made queries plain data that core runs within a scan cap, with money compared and summed in major units per currency. At the edges, the results could be quietly wrong. Minor units came from the runtime's display rules, which differ from ISO 4217 for some currencies (Indonesian rupiah, Colombian peso, Hungarian forint, Iraqi dinar) and from one runtime to another. A sum over an amount one relation away checked the wrong row's currency. A source without paging was read as one page of 100 rows and called complete. The contract's hash ignored standard pages, so the server and stored definitions missed changes to them. JSON contracts could carry regular expressions, which a hostile adapter could make run for seconds. `$me` was documented and refused.

## Decision

- Minor units follow ISO 4217, from a table in core; a money field may override them per currency (`digits`) for an API whose minor units differ.
- Amounts one relation away are read, filtered and summed in their own row's currency, and a summary of them must fix that currency, as it must for amounts on the row itself.
- A source without paging returns one page, and a full page marks the result partial; so does a relation left unresolved.
- The contract's hash covers the standard pages as `toJson` writes them.
- JSON contracts carry no regular expressions: `pattern` is refused when written and when read.
- `$me` is accepted in page queries and resolved from `bindings.context().me` when the query runs; the query fails when no one is signed in.
- Keys and references compare exactly; text and enum values ignore case.

## Consequences

Every contract with page surfaces gets a new hash once, and stored definitions migrate on load, keeping what is still valid. Amounts in the corrected currencies display and compare at their true size. Summaries over sources that can't page say so more often, which is the truth. Item and block schemas that rely on patterns can't travel as JSON.
