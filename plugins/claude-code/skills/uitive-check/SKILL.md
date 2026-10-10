---
name: uitive-check
description: Checks a Uitive integration and says what to fix, from contract validation and the JSON round trip to request schema limits, labels and bindings. Use after changing files in the Uitive folder, or when asked whether the integration works.
---

# Check a Uitive integration

Run `npx uitive check` from the application's package, or the `uitive_check` tool. Fix failures first, then warnings.

## Failures

- **contract**: the contract didn't load or validate. The message names the action, surface, source or route and what's wrong; fix it in the Uitive folder's `contract.ts` (`src/uitive/` by default; package.json's `uitive.dir` says where), or in its `curation.json` and regenerate, for generated sources and actions.
- **json**: the contract changes when read back from JSON. Keep zod schemas to flat objects, scalars, enums, arrays and nullable fields, without transforms.
- **schemas**: a request's schema is too large for structured outputs, perhaps only for "the 8 largest sources together", the most a request can plan over. Curate: fewer fields and actions per source, shorter enums, fewer sources.
- **bindings**: `bindings.ts` in the Uitive folder must export `bindings` with `fetch` when there are sources, and `perform` when actions have effects.

## Warnings

- **Shared labels**: people and the planner can't tell those actions apart. Give each a distinct `label` in the curation.
- **Not found by their own labels**: give the source a distinct label, or `keywords` with the words people use.
- **Size**: past 40 sources or 200 actions, planning gets worse; keep what the frontend shows.

## Then

Preview requests people would make with `uitive_preview_plan`, such as "show failed payments first": the sources it plans over should include the ones the request is about. Coverage at the end of `npx uitive check` shows what's left to map: routes with pages, regions, lists and runnable actions.
