# @plurid/uitive-cli

The agent kit: every step of integrating Uitive is a command a coding agent can run and check, and every page starts as the page it already is, so the application works unchanged from the first minute. Every command takes `--json`.

```sh
npx uitive detect                         # what the project uses; at a monorepo root, where to set up
npx uitive init                           # its folder, with every page as a region; never replaces a file
npx uitive survey --openapi openapi.yaml  # one line per source, to curate from
npx uitive generate sources --openapi openapi.yaml
npx uitive generate blocks src/order-summary.tsx#OrderSummary
npx uitive discover --url http://localhost:5173/
npx uitive check                          # the gate: contract, JSON, schemas, labels, bindings
```

[`uitive`](https://www.npmjs.com/package/uitive) on npm is this package under its short name, so `npx uitive` runs it.

The files go in `src/uitive/` when the project has a `src` folder, else in `uitive/`; `init --dir app/uitive` puts them elsewhere, for a build that compiles only `app`. The folder is recorded in package.json as `uitive.dir`, where every command finds it. The playbook for agents is the `integrate-uitive` skill that `init` installs.

## Curation

Choices about an API description live in `curation.json`, in that folder, keyed by the IDs `survey` prints, and survive every regeneration:

<!-- example: docs/examples/agents/curation.json -->

```json
{
  "default": "exclude",
  "sources": {
    "orders": {
      "include": true,
      "label": "Orders",
      "description": "Orders placed by customers, with their payment and fulfillment status",
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
      "reason": "Fulfillments can be canceled until they ship"
    },
    "orders.archive": { "include": false }
  }
}
```

- `default`: whether sources the file doesn't name are kept. Actions follow their source unless named. `"readOnly": true` keeps no actions at all.
- Sources: `fields` keeps exactly those (besides the key and picks); `labels` names fields whose names don't say what they are; `pick` lifts nested values by JSON pointer; `query` adds parameters to every list request, such as what the API needs to include them; `title` and `summary` name the fields that stand for a row; `scan` caps how many rows are filtered on the client, and `ttl` how many seconds results stay fresh.
- Actions: `label`, `description`, `params` (exactly these, besides the path's), `when` (the rows it applies to, as filters), and `confirm`, the phrase a destructive action asks for. An `effect` can be raised freely, and lowered only with a `reason`.

It needs Node 22 or later; `discover` also needs `playwright`, or `playwright-core` with `--chrome`. Read [Coding agents](https://github.com/plurid/uitive/blob/master/docs/coding-agents.md) and the [API reference](https://github.com/plurid/uitive/blob/master/docs/api/cli.md). MIT licensed.
