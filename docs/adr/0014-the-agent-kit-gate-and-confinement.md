# ADR 0014: The agent kit's gate, and what confines it

- Status: accepted
- Date: 2026-10-09
- Supersedes ADR 0007's list of what `check` gates on, and makes its confinement precise; ADR 0007's other decisions stand.

## Context

ADR 0007 made `check` the gate and listed labels among what it checks, but shared labels only ever warned: generated labels collide often, and whether a source is found by its own label is a ranking heuristic. `check` measured each source's schema alone, while a request can plan over eight sources at once, so a contract could pass and still compile to a schema too large. The MCP server compared paths as text, so a symbolic link, an absolute component path or a folder named `..` in package.json reached outside the project, and `init` configured agents at the git repository's root even when that lay above the root it was given. Writes whose required parameters a run could never send were generated as actions all the same.

## Decision

- `check` fails on the contract, the JSON round trip, the request schemas, including the largest a request can reach (the eight sources with the most fields together, with the 24 actions that take the most params), and the bindings. Shared labels, and sources not found by their own label, are warnings.
- Writes whose required parameters a run can't send are skipped, as list endpoints that need parameters already were, and the survey says what each needs.
- The MCP server confines every path it reads or writes to its root with symbolic links resolved, resolves every path against the tool's `cwd`, and accepts generated output only as Uitive's own files in the Uitive folder. `detect` and `init` stop at the root: agents are configured at the nearest repository root inside it, and anything that would be written above it is reported instead.

## Consequences

A contract that passes `check` can be planned whatever a request puts in view. Fewer actions are generated from an API description, and each one can run. Confinement covers the files tools are asked to read and write, not Node's module resolution: the project's Prettier, the contract's own imports and TypeScript's configuration lookup can still read above the root, as `docs/coding-agents.md` says.
