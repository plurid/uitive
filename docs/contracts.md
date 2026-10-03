# Contracts

A contract declares what may adapt in an application: its actions, the surfaces people may reshape, the data pages may show, and the places it has. It is the single source of truth for TypeScript types, for the schema a model must answer in, for runtime validation and for the prompt. A planner can't name anything the contract doesn't.

## Declare the application

`defineApp` takes the application's ID, a description written for the model, its actions and its surfaces, and optionally its sources, regions, routes and contexts. It checks every ID and reference, and freezes the result.

<!-- example: docs/examples/shop/contract.ts#contract -->

```ts
export const shop = defineApp({
  id: 'shop-admin',
  description: 'The admin of an online shop: orders, customers and fulfilment',
  sources,
  actions,
  regions: {
    orders: { label: 'Orders', description: 'The orders list, as it is' },
    order: { label: 'Order', description: 'One order, as it is', entity: 'orders' },
  },
  routes: {
    orders: route({ path: '/orders', page: 'orders', action: 'go.orders' }),
    order: route({ path: '/orders/:id', entity: 'orders', page: 'order' }),
    customers: route({ path: '/customers', action: 'go.customers' }),
  },
  surfaces: {
    navigation: list({
      label: 'Navigation',
      description: 'The sidebar',
      items: ['go.orders', 'go.customers'],
      capacity: 2,
    }),
    // Every page starts as itself: one region, so the application looks exactly as before.
    orders: page({})({
      label: 'Orders',
      description: 'The orders to fulfil and follow up',
      standard: () => ui.page(ui.region('orders')),
    }),
    order: page(orderBlocks)({
      label: 'Order',
      description: 'One order, and what to do with it',
      entity: 'orders',
      standard: () => ui.page(ui.region('order')),
    }),
  },
});
```

This contract, for a shop's admin, starts every page as the page it already is: one region. The application looks exactly as before until someone asks for a change. [Pages](pages.md) covers redesigns, and [Data and actions](data-and-actions.md) the sources and actions it spreads in.

## Actions

An action is something people can do. One action may appear on several surfaces.

<!-- example: docs/examples/shop/contract.ts#actions -->

```ts
const actions = {
  'go.orders': action({ label: 'Orders', description: 'Every order' }),
  'go.customers': action({ label: 'Customers', description: 'Everyone who orders' }),
  'orders.note': action({
    label: 'Add note',
    description: 'Adds a note to an order, for the team',
    params: z.object({ order: field.ref('orders'), text: z.string() }),
    effect: 'write',
    invalidates: ['orders'],
  }),
  'orders.cancel': action({
    label: 'Cancel order',
    description: 'Cancels an order that has not shipped, and refunds the customer',
    params: z.object({ order: field.ref('orders') }),
    effect: 'destructive',
    when: [{ field: 'orders.status', op: 'in', values: ['pending', 'paid'] }],
    invalidates: ['orders'],
  }),
};
```

- `label` and `description` are read by people and by models alike: they are how "hide Customers" finds `go.customers`. Make each label distinct; `check` warns when two actions share one.
- `group` groups related actions, for display and for the model.
- An action **without an `effect`** belongs to the interface only, as a link or a tool does: the application handles it, and Uitive records its use.
- An action **with an `effect`** runs through the bindings' `perform`. `read` changes nothing; `write` changes data and waits for the person's yes; `destructive` can't be undone and waits for a typed phrase, the label unless `confirm` says otherwise.
- `params` is a flat zod object, like a source's row. A `ref` param makes it a row action, offered on each row of that source; `when` limits it to some rows, such as orders not yet shipped.
- `invalidates` names the sources a run changes, so results that read them refresh.

## Lists

A list is an ordered selection of actions, such as a toolbar, a menu or a sidebar: the first `capacity` show, and the rest wait in overflow.

- `items` lists every action the list can show, in standard order.
- `required` actions never leave the visible part, whoever asks.
- `reorderable` lets people move items, as in "move Table to the top".
- `context` keys the list by a context, such as the tool in hand; each value adapts on its own, and `available` says which items each value offers.

The quick start's toolbar is a list: [Getting started](getting-started.md#declare-a-contract).

## Choices

A choice is one value out of a fixed set, such as a theme or a density. People set it by naming a value: "compact", or "use the compact density".

<!-- example: docs/examples/contracts/surfaces.ts#choice -->

```ts
const density = choice({
  label: 'Density',
  description: 'How much space the interface leaves between things',
  values: ['comfortable', 'compact'],
  default: 'comfortable',
});
```

## Collections

A collection holds generated items people accept, edit or dismiss, such as saved views or macros. Each item is checked against `item` and the optional `validate`; planners only ever suggest items.

<!-- example: docs/examples/contracts/surfaces.ts#collection -->

```ts
const views = collection({
  label: 'Saved views',
  description: 'Filters people come back to, such as paid orders from this week',
  item: z.object({ title: z.string(), status: z.enum(['pending', 'paid', 'shipped']) }),
  max: 8,
  title: (view) => view.title,
});
```

## Contexts

A context names something that changes what a surface offers, such as the tool in hand or the service on screen. Declare its values on the contract, key surfaces by it, and tell the client which value is current with `setContext`.

<!-- example: docs/examples/contracts/surfaces.ts#context -->

```ts
export const drawing = defineApp({
  id: 'drawing',
  description: 'A drawing app whose tool options follow the tool in hand',
  contexts: { tool: ['pen', 'shape', 'text'] },
  actions: {
    'stroke.width': action({ label: 'Stroke width', description: 'How thick lines are' }),
    'stroke.colour': action({ label: 'Stroke colour', description: 'The colour of lines' }),
    'fill.colour': action({ label: 'Fill colour', description: 'The colour inside shapes' }),
    'text.size': action({ label: 'Text size', description: 'How large text is' }),
    'shape.duplicate': action({
      label: 'Duplicate',
      description: 'Copies the selected shapes',
      // It was `shape.copy`: usage and changes recorded under that ID still count.
      aliases: ['shape.copy'],
    }),
  },
  surfaces: {
    options: list({
      label: 'Tool options',
      description: 'Options for the tool in hand',
      items: ['stroke.width', 'stroke.colour', 'fill.colour', 'text.size', 'shape.duplicate'],
      capacity: 3,
      context: 'tool',
      available: (tool) =>
        tool === 'text'
          ? ['text.size', 'stroke.colour']
          : ['stroke.width', 'stroke.colour', 'fill.colour', 'shape.duplicate'],
    }),
    density,
    views,
  },
});
```

## Routes and regions

A route is a place in the application, such as `/orders/:id`. It may show a page, be about one row of a source (`entity`, with the param that holds its key), and record an action on each visit. The client learns where the person is through `setLocation`, which also tells pages which row `$current` names. Routes are how generated links and row links are built.

A region is part of the application as it already is, such as the original orders page. Pages embed regions, so a standard page can be the existing page, untouched, and a redesign can keep parts of it.

## IDs

| What                       | Rule                                                         | Such as                          |
| -------------------------- | ------------------------------------------------------------ | -------------------------------- |
| Actions, routes, regions   | Lowercase letters and digits, with dots, colons or dashes    | `orders.cancel`, `orders.detail` |
| Context and choice values  | The same                                                     | `pen`, `compact`                 |
| Surfaces, contexts, blocks | camelCase identifiers                                        | `addNew`, `tool`, `fulfilment`   |
| Sources                    | Lowercase letters, digits and dashes, starting with a letter | `balance-transactions`           |
| Fields                     | Letters, digits and underscores, starting with a letter      | `created_at`                     |

Planners emit IDs as enum values, whose casing structured outputs don't guarantee, so IDs that differ only in case are refused.

## The JSON contract

A contract also exists as data: `toJson` writes it, and `fromJson` reads it back with the same hash, so adapters, coding agents and planners on other machines can exchange it. Functions don't travel: a page's standard is written out, and validators are reattached when it loads. Schemas that wouldn't survive the trip, such as ones with transforms, are refused, and `check` says which.

## What `check` checks

`uitive check` loads the contract and the bindings and runs four checks:

- **contract**: it loads, compiles and validates.
- **json**: it reads back from JSON unchanged.
- **schemas**: every request schema keeps to what providers' structured outputs accept: no optional fields, one union, at most 60 KB, and enums of at most 400 values. A provider with tighter limits gets the request again over a smaller part of the contract.
- **bindings**: the bindings bind what the contract needs: `fetch` for sources, `perform` for actions with effects.

It also warns about actions that share a label, sources their own label doesn't find, sources over 40 fields, contracts over 40 sources or 200 actions, and two copies of zod.

## Changing a contract

Contracts change, and people's interfaces survive it.

- **Rename an action** with `aliases`: usage and changes recorded under its old ID still count.

  <!-- not-typechecked -->

  ```ts
  'shape.duplicate': action({ label: 'Duplicate', description: 'Copies the selected shapes', aliases: ['shape.copy'] }),
  ```

- **Remove an action, a surface or a block**, and the changes that named it are dropped when the person's interface next loads; everything else they changed stays.
- **The hash changes** whenever the contract does. A server refuses requests made with another hash (409, "The application changed; reload the page"), so deploy the client and the server's contract together.
- **Bump `version`** when behaviour the hash can't see changes, such as a validator.
