# @plurid/aptuitive-mcp

The agent kit as Model Context Protocol tools, for coding agents that prefer tools to a shell: detect, init, survey, generate sources and blocks, discover, check and a plan preview.

```json
{ "mcpServers": { "aptuitive": { "command": "npx", "args": ["-y", "@plurid/aptuitive-mcp"] } } }
```

Aptuitive is a preview and not yet published: until it is, start the server built in the repository, with `node <repository>/packages/mcp/dist/bin.js` as the command, which `aptuitive init --mcp` also takes.

| Tool                         | What it does                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `aptuitive_detect`           | What the application uses. Start here                                                        |
| `aptuitive_init`             | Sets Aptuitive up; installs packages only when `install` is true                             |
| `aptuitive_openapi_survey`   | One line per source an OpenAPI description yields, to curate from                            |
| `aptuitive_generate_sources` | Sources, actions and endpoints from the description and the curation                         |
| `aptuitive_generate_blocks`  | Block specs from components' props; with `check`, reports drift                              |
| `aptuitive_discover`         | Crawls the running application and proposes routes, regions, lists and actions               |
| `aptuitive_check`            | The gate: contract, JSON, request schemas, labels and bindings, with coverage                |
| `aptuitive_preview_plan`     | Which sources and actions a request would plan over, and how large its schema and prompt are |

No tool reads or writes outside the project's root: `--root`, or the directory the server starts in. API descriptions come from files, and discovery crawls only local hosts, unless the server starts with `--allow-network`.

It needs Node 22 or later. Read [Coding agents](https://github.com/plurid/aptuitive/blob/master/docs/coding-agents.md#mcp) and the [API reference](https://github.com/plurid/aptuitive/blob/master/docs/api/mcp.md). MIT licensed.
