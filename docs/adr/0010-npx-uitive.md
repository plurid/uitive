# ADR 0010: npx uitive

- Status: accepted
- Date: 2026-10-04

## Context

Setting Uitive up starts with the CLI's `init`, which the README and Getting started lead with. Under the CLI's package name the command is `npx @plurid/uitive-cli init`: long to read and to type, for the first thing anyone runs. The unscoped name `uitive` is free on npm, and the CLI's binary is already called `uitive`.

## Decision

The CLI is also published as `uitive`, a package with no code of its own: its binary imports `@plurid/uitive-cli/bin`, which runs the CLI. The docs say `npx uitive init`, `npx uitive check` and so on.

`@plurid/uitive-cli` stays the CLI's package: the one `init` adds to a project, the one the MCP server builds on, under the scope every package shares. The alias lives beside it, in `packages/cli/uitive`, so the conventions every folder in `packages/` keeps don't bend for a package without code.

## Consequences

The two are published together, at the same version, which a test holds. The alias needs no fix of its own, since it holds nothing to fix. Renaming the CLI's package instead would have touched every project `init` set up, the MCP server and the docs, for a shorter command alone.
