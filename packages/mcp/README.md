# @plurid/uitive-mcp

The agent kit as Model Context Protocol tools, for coding agents that prefer tools to a shell: detect, init, survey, generate sources and blocks, discover, check and a plan preview.

```json
{ "mcpServers": { "uitive": { "command": "npx", "args": ["-y", "@plurid/uitive-mcp"] } } }
```

| Tool                      | What it does                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `uitive_detect`           | What the application uses. Start here                                                        |
| `uitive_init`             | Sets Uitive up; installs packages only when `install` is true                                |
| `uitive_openapi_survey`   | One line per source an OpenAPI description yields, to curate from                            |
| `uitive_generate_sources` | Sources, actions and endpoints from the description and the curation                         |
| `uitive_generate_blocks`  | Block specs from components' props; with `check`, reports drift                              |
| `uitive_discover`         | Crawls the running application and proposes routes, regions, lists and actions               |
| `uitive_check`            | The gate: contract, JSON, request schemas and bindings, with label warnings and coverage     |
| `uitive_preview_plan`     | Which sources and actions a request would plan over, and how large its schema and prompt are |

No tool reads or writes outside the project's root, `--root` or the directory the server starts in, with symbolic links resolved. A tool's paths are relative to its `cwd`, the application's package; `uitive_init` configures coding agents at the nearest repository root inside the project's root, else at the root, and says what it left alone. Generating writes only `*.generated.ts` files in the Uitive folder, and discovery only a `.json` file there. API descriptions come from files, and discovery crawls only this machine's hosts (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`), unless the server starts with `--allow-network`.

It needs Node 22 or later. Read [Coding agents](https://github.com/plurid/uitive/blob/master/docs/coding-agents.md#mcp) and the [API reference](https://github.com/plurid/uitive/blob/master/docs/api/mcp.md). MIT licensed.
