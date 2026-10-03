---
name: aptuitive-check
description: Checks an Aptuitive integration and says what to fix, from contract validation and the JSON round trip to request schema limits, labels and bindings. Use after changing files in the Aptuitive folder, or when asked whether the integration works.
---

# Check an Aptuitive integration

Run `aptuitive check` from the application's package, or the `aptuitive_check` tool. Fix failures first, then warnings.

## Failures

- **contract**: the contract didn't load or validate. The message names the action, surface, source or route and what's wrong; fix it in the Aptuitive folder's `contract.ts` (`src/aptuitive/` by default; package.json's `aptuitive.dir` says where), or in its `curation.json` and regenerate, for generated sources and actions.
- **json**: the contract changes when read back from JSON. Keep zod schemas to flat objects, scalars, enums, arrays and nullable fields, without transforms.
- **schemas**: a request's schema is too large for structured outputs. Curate: fewer actions per source, shorter enums, fewer sources.
- **bindings**: `bindings.ts` in the Aptuitive folder must export `bindings` with `fetch` when there are sources, and `perform` when actions have effects.

## Warnings

- **Shared labels**: people and the planner can't tell those actions apart. Give each a distinct `label` in the curation.
- **Not found by their own labels**: give the source a distinct label, or `keywords` with the words people use.
- **Size**: past 40 sources or 200 actions, planning gets worse; keep what the frontend shows.

## Then

Preview requests people would make with `aptuitive_preview_plan`, such as "show failed payments first": the sources it plans over should include the ones the request is about. Coverage at the end of `aptuitive check` shows what's left to map: routes with pages, regions, lists and runnable actions.
