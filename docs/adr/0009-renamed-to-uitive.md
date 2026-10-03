# ADR 0009: Renamed to Uitive

- Status: accepted
- Date: 2026-10-03

## Context

The product was called Aptuitive, from 2019 on. Before its packages are first published, it is renamed to Uitive, with its repository at `github.com/plurid/uitive` and its site at `uitive.dev`. A name ships in many places at once: package names, functions and types, custom elements, data attributes, CSS custom properties, events, data formats, storage keys, the CLI, the MCP tools and the coding agents' skills. Changing them after publication would break every integration, so the rename happens now, everywhere at once.

## Decision

Everything the product ships takes the new name:

- Packages are `@plurid/uitive-core`, `-react`, `-dom`, `-planner`, `-server`, `-adapter`, `-cli` and `-mcp`; the CLI is `uitive`, and the MCP tools are `uitive_detect` and its siblings.
- Code reads `createUitive`, `Uitive`, `UitiveProvider`, `useUitiveRouter`, `startUitive` and `createUitiveHandler`.
- The `apt-` prefix becomes `uitive-`: elements (`<uitive-banner>`), data attributes (`data-uitive-list`), CSS custom properties (`--uitive-accent`), classes and events. A bare `ui-` would collide with other libraries.
- Data formats, the folder `init` writes (`src/uitive/`), its package.json key (`uitive.dir`), the handler's path (`/api/uitive`), people's own pages (`/uitive/<slug>`), storage keys and `UITIVE_MODEL` follow.

ADRs 0001 to 0008 stay as written, under the old name, since decision records are immutable; this record maps their names to today's. The findings keep their runs and say which name they used. `legacy/` keeps the 2019 code as it was.

## Consequences

Nothing published breaks, since nothing was published. State stored under the old name, such as a browser's interface definitions, the extension's keys or exported definitions, isn't read under the new one. The logo combines an A with "UI" and may change with the name.
