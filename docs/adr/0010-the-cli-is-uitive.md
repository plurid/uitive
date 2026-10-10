# ADR 0010: The CLI is published as `uitive`

- Status: accepted
- Date: 2026-10-09
- Supersedes the CLI's package name in ADR 0007 and ADR 0009; their other decisions stand.

## Context

ADR 0007 made the agent kit's CLI a scoped package under the product's former name, and ADR 0009 renamed it with the rest to `@plurid/uitive-cli`. The package was published as `uitive` instead, so that `npx uitive init` runs it: a scoped name would make every command `npx @plurid/uitive-cli init`, which people and coding agents mistype and which reads worse in every guide.

## Decision

The CLI's package is `uitive`, the one unscoped package. Its command is `uitive`, as before. The libraries stay scoped (`@plurid/uitive-core` and its siblings), and so does the MCP server (`@plurid/uitive-mcp`), which agents' configurations name in full.

## Consequences

Guides, `init`'s output and the coding agents' skills say `npx uitive`. The unscoped name is this project's on npm, and losing it would break every guide, so it is published with each release like the scoped packages. Nothing else about ADRs 0007 and 0009 changes.
