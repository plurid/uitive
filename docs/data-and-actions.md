# Data and actions

Sources are the data pages can show; actions are what people can do, some of which change data. Both are declared on the contract, and both run through the application's own code, its **bindings**, with the person's own permissions. Planners see sources' schemas, never their rows, and nothing changes data without the person's yes.

## Sources

A source is a typed read model: a flat row schema, the field that identifies a row, the field that names it, and what the binding can do by itself.

<!-- example: docs/examples/shop/contract.ts#sources -->

```ts
export const sources = {
  orders: source({
    label: 'Orders',
    description: 'Orders customers placed, with their total and where they are in fulfillment',
    keywords: ['sales', 'purchases'],
    row: z.object({
      id: z.string(),
      number: z.number(),
      total: field.money({ currency: 'currency' }),
      currency: z.string(),
      status: field.enum(['pending', 'paid', 'shipped', 'canceled']),
      placed: field.time(),
      customer: field.ref('customers'),
    }),
    key: 'id',
    title: 'number',
    summary: ['total', 'status'],
    // What the API does itself; Uitive does the rest on the client.
    capabilities: {
      filter: { status: ['eq', 'in'], placed: ['gte', 'lt'], customer: ['eq'] },
      sort: ['placed'],
      pagination: 'offset',
    },
  }),
  customers: source({
    label: 'Customers',
    description: 'People who order from the shop',
    row: z.object({ id: z.string(), name: z.string(), email: z.string() }),
    key: 'id',
    title: 'name',
    capabilities: { search: true },
  }),
};
```

Field helpers say what a value means, so it shows and filters correctly. Plain zod types work too, with their meaning inferred: a string is text, a number is a number, a boolean is yes or no, an enum is an enum.

| Helper                                   | What it holds                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `field.text()`                           | Text, such as a name                                                                                  |
| `field.number()`                         | A number that isn't money, such as a count                                                            |
| `field.money({ currency, code, minor })` | An amount: `currency` names the field with each row's currency, `code` fixes one, `minor` means cents |
| `field.time({ unit })`                   | A moment: an ISO string, or seconds or milliseconds with `unit: 's'` or `'ms'`                        |
| `field.enum([...])`                      | One of a fixed set, such as a status                                                                  |
| `field.ref('customers')`                 | Another source's key, which makes a relation queries can follow one hop                               |
| `field.bool()`                           | Yes or no                                                                                             |

Every helper takes a `label`, shown as a column's header, and a `description`.

- `title` names a row, and `summary` lists the fields that sum it up; a relation one hop away can show only those.
- `capabilities` declares what the binding does itself: which filters, which sorts, text search and paging. Uitive pushes those down and does the rest on the client, over at most `scan` rows (500 by default). A result cut short by the cap says it is partial.
- `maxLimit` caps the rows one query may ask for (100 by default), and `ttl` how many seconds a result stays fresh (30 by default).

## Sources from an API description

With an OpenAPI description, sources and actions are generated rather than written: `uitive survey` lists what the description holds, a `curation.json` keeps what the interface shows, and `uitive generate sources` writes a module of `sources`, `actions` and `endpoints` to spread into the contract. [Coding agents](coding-agents.md#curation) has the steps and every curation key.

## Bindings

Bindings are the application's code behind the contract: `fetch` reads sources, `perform` runs actions, and `navigate` follows links. For REST APIs, `restFetch` and `restPerform` take each endpoint as data, and read and write with the application's own session.

<!-- example: docs/examples/shop/bindings.ts#bindings -->

```ts
// Reads and writes as the signed-in person, with the application's own session cookie.
export const bindings: Bindings<typeof shop> = {
  fetch: restFetch({
    base: '/api',
    credentials: 'include',
    sources: {
      orders: {
        path: '/orders',
        rows: '/orders',
        filters: {
          'status:eq': 'status',
          'status:in': 'status',
          'placed:gte': 'placed_after',
          'placed:lt': 'placed_before',
          'customer:eq': 'customer',
        },
        sort: { param: 'order', format: '-field' },
        pagination: { kind: 'offset', param: 'offset' },
        item: { path: '/orders/{id}', row: '/order' },
      },
      customers: { path: '/customers', rows: '/customers', search: 'q' },
    },
  }),
  perform: restPerform({
    base: '/api',
    credentials: 'include',
    actions: {
      'orders.note': { method: 'POST', path: '/orders/{order}/notes' },
      'orders.cancel': { method: 'POST', path: '/orders/{order}/cancel' },
    },
  }),
};
```

- `filters` maps a field and operator to a query parameter, such as `placed:gte` to `placed_after`. Declare only what the endpoint applies, and declare the same in the source's `capabilities`.
- `rows` is a JSON pointer to the rows in a response; `pick` lifts nested values into fields, and `query` adds parameters every request needs.
- `pagination` is `cursor`, `offset`, `page` or `none`, and `item` reads one row by key.
- In `restPerform`, params fill the `{placeholders}` of the path and the rest go in the body, as JSON or a form.

For anything else, write the binding: a `Fetch` takes a request (the source, fields, filters, sort, limit, cursor and search it may apply) and returns rows; a `Perform` takes params and returns a message or where to go next. `fromRows` serves rows held in memory, for demonstrations and tests.

## Queries

A query is a question about one source, as plain data: fields, filters, sorts, a limit, search text and an optional summary. Pages use them, and so can your own components.

<!-- example: docs/examples/shop/unshipped.tsx#query -->

```tsx
const unshipped = query('orders', {
  fields: ['orders.number', 'orders.total', 'orders.currency', 'orders.customer.name'],
  filter: [
    { field: 'orders.status', op: 'eq', values: ['paid'] },
    { field: 'orders.placed', op: 'lt', values: ['-2d'] },
  ],
  sort: [{ field: 'orders.placed', direction: 'asc' }],
  limit: 10,
});
```

Fields are qualified by source (`orders.total`) and may follow one relation (`orders.customer.name`). Values are text, parsed by each field's type when the query runs, so a saved "last two days" stays relative.

| Field type | Operators                                                                        |
| ---------- | -------------------------------------------------------------------------------- |
| text       | `eq`, `ne`, `in`, `nin`, `contains`, `prefix`, `empty`, `present`                |
| number     | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `nin`, `empty`, `present` |
| money      | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`, `empty`, `present`              |
| time       | `gt`, `gte`, `lt`, `lte`, `between`, `empty`, `present`                          |
| enum, ref  | `eq`, `ne`, `in`, `nin`, `empty`, `present`                                      |
| bool       | `eq`, `empty`, `present`                                                         |

- **Times** take ISO dates and times, or values relative to now: `now`, `today`, `yesterday`, `tomorrow`, `-7d` or `+3h` (with `m`, `h`, `d`, `w`, `mo`, `q` and `y`), and `start:month` or `start:week-1w`, in the person's time zone.
- **Money** is in major units, such as `25.50`, and enums ignore case.
- **Tokens**: `$current` is the row the page is about, and `$me` the signed-in person.
- **Summaries** count, sum, average, take the minimum or maximum, or count distinct values, grouped by a field or a time bucket and optionally split by another. Money in different currencies is never added together.
- A query reads at most 12 fields, with 8 filters and 3 sorts; a page runs at most 8 queries.

`useQuery` reads a query's result in a component, shared and cached with every other reader:

<!-- example: docs/examples/shop/unshipped.tsx#component -->

```tsx
/** Orders paid more than two days ago and not shipped, read with the person's own session. */
export function Unshipped() {
  const entry = useQuery(uitive, unshipped);
  if (!entry.result) return <p role="status">{entry.error ?? 'Loading'}</p>;
  return (
    <ul>
      {entry.result.rows.map((row) => (
        <li key={String(row['orders.number'])}>
          Order {String(row['orders.number'])} for {String(row['orders.customer.name'])}
        </li>
      ))}
    </ul>
  );
}
```

Outside React, `client.data.load(query)` returns the result.

## Running actions

An action with an `effect` runs through `perform`.

| Effect        | What happens                                                                      |
| ------------- | --------------------------------------------------------------------------------- |
| `read`        | It runs at once, such as an export.                                               |
| `write`       | From a generated page, it waits for one yes, shown with its params.               |
| `destructive` | It waits for a typed phrase: the action's label, unless `confirm` says otherwise. |

A run ends `done`, `canceled` by the person, `failed` in the binding or for want of one, or `refused` before it starts: when its params don't fit the action's schema, when no interface can ask for confirmation, when another run is already waiting, or while a redesign is being previewed. A run that succeeds is recorded as use, without its params, and `invalidates` refreshes results that read the sources it changed. Each run carries an idempotency key the binding may use to refuse doing it twice; `restPerform` sends it in the header its `idempotency` option names.

Generated pages ask through the confirmation interface you mount once: `<Confirmations />` in React, `<uitive-confirm>` elsewhere. The application's own controls ask in their own way; send them through `useAction`, so their runs count as use:

<!-- example: docs/examples/shop/cancel-button.tsx#action -->

```tsx
/** The application's own button: it asks in its own way, and each run counts as use. */
export function CancelButton({ order }: { order: string }) {
  const cancel = useAction(uitive, 'orders.cancel');
  return (
    <button
      type="button"
      onClick={() => {
        if (window.confirm(`Cancel order ${order}?`)) void cancel({ order });
      }}
    >
      Cancel order
    </button>
  );
}
```

Actions without an effect belong to the interface, such as opening a page or choosing a tool. Record their use with `client.record`, or let `perform` call the binding for them too.
