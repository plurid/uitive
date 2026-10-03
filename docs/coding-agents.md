# Coding agents

Uitive is built to be integrated by a coding agent: every step is a command the agent can run and check, a playbook says in what order, and `uitive check` is the gate. Every page starts as a region, so the application works unchanged from the first minute. Three coding agents integrated Excalidraw, Medusa Admin and Grist this way, in 37 to 54 minutes each: see [Findings](findings.md).

## Start

In the application's package:

```sh
npx @plurid/uitive-cli detect   # what the project uses; at a monorepo root, where to set up
npx @plurid/uitive-cli init     # packages, the Uitive folder and the agents' configuration
```

Then ask the agent to integrate Uitive. `init` installs the playbook, a skill named `integrate-uitive`, which takes the agent from the contract to bindings, pages, the kit and checks, one checked step at a time.

## What `init` writes

`init` never overwrites a file. In the **Uitive folder**, `src/uitive/` when there is a `src` folder and `uitive/` otherwise:

| File               | What it holds                                                                   |
| ------------------ | ------------------------------------------------------------------------------- |
| `contract.ts`      | The contract, with the home page as one region                                  |
| `bindings.ts`      | The bindings, typed by the contract, reading with the application's own session |
| `client.ts`        | The client and its store                                                        |
| `kit.tsx`          | The kit, mapped to the design system it found (React only)                      |
| `server.ts`        | The planner's handler, when the project has a server                            |
| `api.generated.ts` | Sources, actions and endpoints from a small API description                     |
| `curation.json`    | What to keep from a large API description, for you or the agent to fill in      |

`init --dir app/uitive` puts the folder elsewhere, such as inside the only folder the build compiles; package.json records it as `uitive.dir`, where every command finds it. With Next.js, `init` also writes `app/api/uitive/[kind]/route.ts`.

At the repository's root, it configures the coding agents it finds: Claude Code (`.mcp.json` and the skill), Cursor (`.cursor/mcp.json`) and VS Code (`.vscode/mcp.json`). With none found, it configures Claude Code and says so; `--no-agents` leaves them alone.

## The commands

Every command takes `--json` for agents, `--cwd <dir>` for the project's root, and `--help`. Each exits with 0 when it worked, and with 1 when a required option is missing, when something goes wrong, or as below.

| Command                             | What it does                                                                                                                           | Also exits with 1 when                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `detect`                            | Lists what the project uses: package manager, UI library, framework, router, design system, server, API descriptions and coding agents |                                              |
| `init`                              | Sets Uitive up. `--dir`, `--openapi`, `--packages`, `--no-install`, `--no-agents`, `--mcp <command>`                                   | installing failed                            |
| `survey --openapi <spec>`           | One line per source an OpenAPI 2.0, 3.0 or 3.1 description yields, to curate from. `--curation`                                        | the description has problems                 |
| `generate sources --openapi <spec>` | Writes `api.generated.ts` from the description and `curation.json`. `--curation`, `--out`, `--dry-run`                                 | generating failed                            |
| `generate blocks <file#Component>…` | Writes `blocks.generated.ts` from components' props. `--out`, `--check`                                                                | there are problems, or with `--check`, drift |
| `discover --url <url>`              | Crawls the running application and writes `discovery.json`. `--pages`, `--per-route`, `--storage-state`, `--chrome`, `--out`           |                                              |
| `check`                             | The gate: contract, JSON, request schemas, labels and bindings, with coverage. `--contract`, `--bindings`                              | anything fails                               |

## Curation

An API description describes everything; an interface shows a part. Past 40 sources or 200 actions, planning gets worse, so `generate sources` asks for a curation first. Curating is three steps:

1. `uitive survey --openapi <spec>` prints one line per source: the fields kept and left out, its filters, search, sorting and paging, and its actions, then what was skipped and why.
2. `curation.json` in the Uitive folder keeps what the frontend shows, names things the way its people do, and lifts nested values people look at.
3. `uitive generate sources --openapi <spec>` writes the sources and actions, which the contract spreads in. Rerun it after every change to the curation, and never edit the generated file.

<!-- example: docs/examples/agents/curation.json -->

```json
{
  "default": "exclude",
  "sources": {
    "orders": {
      "include": true,
      "label": "Orders",
      "description": "Orders placed by customers, with their payment and fulfilment status",
      "keywords": ["purchase", "sale"],
      "fields": ["display_id", "email", "total", "currency_code", "payment_status", "created_at"],
      "labels": { "display_id": "Order", "created_at": "Placed" },
      "pick": { "customer_name": "/customer/first_name" },
      "query": { "fields": "*customer" },
      "title": "display_id",
      "summary": ["total", "payment_status"],
      "scan": 500,
      "ttl": 30
    }
  },
  "actions": {
    "orders.cancel": { "confirm": "cancel order" },
    "fulfillments.create": {
      "effect": "write",
      "reason": "Fulfilments can be cancelled until they ship"
    },
    "orders.archive": { "include": false }
  }
}
```

Choices survive every regeneration. An action's effect can be raised freely, and lowered only with a `reason`: destructive stays destructive unless the backend makes it safe. The CLI's README has every key: [Curation](../packages/cli/README.md#curation). In Claude Code, the plugin's `curator` agent does this step: it reads the survey and the frontend's API calls, and writes the curation.

## Discovery

`uitive discover --url http://localhost:5173/` crawls the running application with Playwright, following same-origin links and never pressing anything. It proposes routes, with row keys turned into parameters, a region per route, lists from navigation and toolbars, which buttons match the contract's actions, and the buttons that open menus it doesn't open. Buttons in dialogs and sort buttons are never actions, and a generic verb or a dismissal alone, such as "Create" or "Cancel", never matches a longer action.

- It needs `playwright`, or `playwright-core` with `--chrome` to use the installed Chrome.
- `--storage-state <file>` gives it a signed-in session, saved with Playwright.
- It writes `discovery.json` in the Uitive folder, for the agent to turn into routes, regions and lists.

## Native blocks

`uitive generate blocks src/order-summary.tsx#OrderSummary` writes block specs from components' TypeScript props, so redesigns can place the application's own components: literal unions become enums, optional props become required with their defaults described, and functions, content and objects are left out and reported. Run it with `--check` in CI. [Pages](pages.md#your-own-blocks) shows how to render them.

## The check

`uitive check` loads the contract and the bindings in Node, through the project's tsconfig paths, and checks that they hold: see [Contracts](contracts.md#what-check-checks). It prints what the integration covers, such as "10 actions, 1 route, 1 page, 1 region, 2 lists", so an agent can report it. Keep the contract importable on its own: aliases only the bundler knows don't resolve in Node.

## MCP

`@plurid/uitive-mcp` offers the same steps as Model Context Protocol tools, for agents that prefer tools to a shell:

```json
{ "mcpServers": { "uitive": { "command": "npx", "args": ["-y", "@plurid/uitive-mcp"] } } }
```

| Tool                      | What it does                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `uitive_detect`           | What the application uses. Start here                                                                                   |
| `uitive_init`             | Sets Uitive up; installs packages only when `install` is true                                                           |
| `uitive_openapi_survey`   | The survey of an API description                                                                                        |
| `uitive_generate_sources` | Sources, actions and endpoints from the description and the curation                                                    |
| `uitive_generate_blocks`  | Block specs from components' props; with `check`, reports drift                                                         |
| `uitive_discover`         | Crawls the running application                                                                                          |
| `uitive_check`            | The gate, with coverage                                                                                                 |
| `uitive_preview_plan`     | Which sources and actions a request would plan over, and how large its schema and prompt are, without calling the model |

No tool reads or writes outside the project's root. API descriptions come from files, and discovery crawls only local hosts, unless the server starts with `--allow-network`.

## Claude Code

The plugin bundles the playbook, a skill that checks an integration and says what to fix, the `curator` agent and the MCP server. Add this repository as a marketplace, then install it:

```text
/plugin marketplace add plurid/uitive
/plugin install uitive@plurid-uitive
```

`init` already configures Claude Code in a project; the plugin brings the same to every project.
