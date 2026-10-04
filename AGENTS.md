# Repository guidance

## Domain docs

This is a single-context repository: `CONTEXT.md` holds the vocabulary, invariants and module map, and `docs/adr/` records durable decisions. ADRs are immutable: supersede one with a new record rather than rewriting it. When behavior changes, update code, tests and the affected domain documentation in the same change.

## Working here

- `pnpm check` must pass: lint, format, typecheck (which builds the packages) and tests.
- Documentation: guides in `docs/`, linked from the README. The API reference in `docs/api/` is generated from JSDoc, so every public export has JSDoc, and TypeScript in Markdown is embedded from `docs/examples/`, where it is typechecked and tested. After changing public types, JSDoc or examples, run `pnpm run docs`: `pnpm check` fails while the docs are stale.
- Packages live in `packages/`, demonstrations in `apps/`, shared tooling in `tools/`. `legacy/` is the archived 2019 code: never edit or build it.
- Writing: no em dashes, in code, copy or docs.
- Conventions: kebab-case files, named exports through `index.ts`, `.js` extensions on relative imports, `import type`, JSDoc with `@default` on public options, US spelling, few comments, and those explain why.
- `@plurid/uitive-core` stays isomorphic (no DOM or Node APIs); its tsconfig enforces this.
- Whoever pays holds the key (ADR 0006): in applications, keys never reach client code and the planner runs on the server; in the extension, the user's own key stays with its service worker. No planner ever receives a third-party page's text.
- Never commit or sign work: the person working here commits.
