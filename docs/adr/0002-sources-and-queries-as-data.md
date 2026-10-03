# ADR 0002: Sources and queries as data

- Status: accepted
- Date: 2026-10-03

## Context

Pages could only be built from blocks the application wrote in advance, each with its own data access. A redesign was capped by what someone had anticipated ("failed payments beside each customer's lifetime value" was impossible), every block was written twice (a schema and a renderer), and integrating a large product meant hand-writing hundreds of blocks.

## Decision

Applications declare **sources**: typed read models with a flat zod row, a key, a title, summary fields, and what their binding can filter, sort, search and page by itself. Field helpers say what values mean (money in minor units, times in seconds, references to other sources).

Planners never see rows. They write **queries**: plain data naming a source, qualified fields (at most one hop through a reference), filters with lowercase operators and string values, sorting, a limit, search text and an aggregate, with nothing optional. Policy checks every part of a query against the contract, and only `$current` (the page's row) and `$me` may stand in for values.

A runtime **fetch binding** runs queries with the user's own permissions. Core pushes down what the binding declares and does the rest on the client within a scan cap, marking results partial when the cap stops short. Values are parsed per field type when the query runs, so relative times stay relative; money is compared and summed in major units per currency, and amounts in different currencies are never added together.

## Consequences

Generic blocks can show any combination of declared data, so integration shifts from writing blocks to declaring sources, which can be generated from API descriptions. The planner's schema stays flat: one enum of qualified field names per request instead of a union per source. Client-side work is bounded by the scan cap, so large accounts may see partial summaries, which say so. Bindings must declare their capabilities honestly; anything undeclared still works, only more slowly.
