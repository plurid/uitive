# Pages

A page is a surface people can redesign completely: "make the orders page a morning check of what needs attention", or "put each customer's lifetime value beside their failed payments". The redesign is built from the contract's parts, checked by policy, drawn with your design system, and reverted in one step.

## Start from the page as it is

A page's standard is what everyone sees until they ask for a change. Start each page as the page it already is: one **region**, which renders your existing component, untouched.

<!-- example: docs/examples/shop/orders-page.tsx#page -->

```tsx
export function OrdersPage() {
  const value = useSurface(uitive, 'orders');
  return <Page value={value} blocks={{}} regions={{ orders: OrdersList }} />;
}
```

The contract declares the region and the page, and the route that shows it, as in [Contracts](contracts.md#declare-the-application). Finer regions can come later, such as the orders table alone, so a redesign can keep part of the page and replace the rest.

A page can be about one row of a source: give it an `entity`, and the route's key names the row, which queries reach as `$current`. A page keyed by a context, such as the service on screen, can be redesigned for one value or for all of them at once.

## How a page is built

A page is a flat list of elements forming one tree from a root, plus the named queries its blocks show. Each element is a placed block: a `section` or `tabs` that arranges its children, a `region`, one of the application's own blocks, or a generic block. The `ui` builder writes the tree and flattens it:

<!-- example: docs/examples/shop/redesign.ts#redesign -->

```ts
const fields = [
  'orders.number',
  'orders.total',
  'orders.currency',
  'orders.customer.name',
  'orders.placed',
];

export const needsAttention = ui.page(
  ui.section('Needs attention', 'stack', [
    ui.block('metric', { data: 'waiting', label: 'Paid, not shipped', compare: 'none' }),
    ui.block('table', {
      data: 'oldest',
      columns: ['orders.number', 'orders.total', 'orders.customer.name', 'orders.placed'],
      lookups: [],
      rowActions: [{ action: 'orders.cancel', set: [] }],
      density: 'compact',
      link: 'entity',
    }),
  ]),
  [
    {
      name: 'waiting',
      query: query('orders', {
        filter: [{ field: 'orders.status', op: 'eq', values: ['paid'] }],
        aggregate: { measure: 'count' },
      }),
    },
    {
      name: 'oldest',
      query: query('orders', {
        fields,
        filter: [{ field: 'orders.status', op: 'eq', values: ['paid'] }],
        sort: [{ field: 'orders.placed', direction: 'asc' }],
        limit: 10,
      }),
    },
  ],
);
```

A page holds at most 40 elements, nests at most 4 deep and runs at most 8 queries, unless its spec says otherwise. Element IDs are short names of letters, digits, dashes and underscores, and queries are named in camelCase; every query is checked field by field before it runs.

## Generic blocks

Generic blocks are drawn by Uitive from the contract's sources and actions, with the kit you map to your design system, so a redesign isn't limited to blocks someone anticipated.

| Block      | What it shows                                      | Key props                                                          |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `table`    | A query's rows                                     | `data`, `columns`, `lookups`, `rowActions`, `density`, `link`      |
| `list`     | A query's rows as a list                           | `data`, `title`, `subtitle`, `meta`, `badge`, `rowActions`, `link` |
| `detail`   | One row's fields                                   | `data` (a query of one row), `fields`, `columns`                   |
| `metric`   | One figure, against the period before when asked   | `data` (an ungrouped summary), `label`, `compare`                  |
| `chart`    | A grouped summary as lines, bars, areas or a pie   | `data`, `kind`, `stacked`                                          |
| `timeline` | Rows in time order                                 | `data`, `time`, `title`, `detail`                                  |
| `board`    | Rows in columns by an enum field, read only        | `data`, `column`, `title`, `meta`                                  |
| `form`     | A form that runs one action                        | `action`, `set`                                                    |
| `actions`  | Buttons: a list's visible items, or chosen actions | `list`, `items`, `size`                                            |
| `note`     | A short note                                       | `title`, `text`                                                    |
| `links`    | Links to routes                                    | `items`                                                            |

- A table's `lookups` join figures from other queries to each row, such as each customer's lifetime value from a summary grouped by customer.
- Row actions fill a `ref` param naming the table's source with the row's key; `set` fills others, with literals, `$current` or `$row.<field>`. A row action shows only on rows its action's `when` allows, judged as queries filter.
- Literals are parsed as policy checks them: `yes` is true, `$5` and `1,000` are numbers, and money is written in major units. A form shows them as it will send them; one that shows every value counts as the yes, and anything else waits for [`<Confirmations />`](react.md#confirmations).
- `link: 'entity'` opens each row's own page, through the route about that source.
- A metric with `compare: 'previous'` compares with the period of the same length just before its time filter: `-30d` with the 30 days before, `start:month` (this month so far) with the same part of last month, a fixed range with the range just before it. It never compares sums in different currencies.
- A pie by currency, or bars stacked by currency, would add amounts in different currencies, so a chart of money refuses them; bars side by side show each currency apart.
- A link with an empty label reads as its route: the route's `label`, else its page's label, else its ID. A link to one row names it by key, or as `$current` on a page about that source; a planner, who never sees rows, may name it only as `$current`.

The API reference has every prop: [table](api/core.md#tableprops), [list](api/core.md#listprops), [detail](api/core.md#detailprops), [metric](api/core.md#metricprops), [chart](api/core.md#chartprops), [timeline](api/core.md#timelineprops), [board](api/core.md#boardprops), [form](api/core.md#formprops), [actions](api/core.md#actionsprops), [note](api/core.md#noteprops) and [links](api/core.md#linksprops). A page offers every generic block the contract can feed, unless its `generic` option narrows that.

## Your own blocks

A block can also be one of your components, with typed props, such as a fulfillment tracker. Declare it on the contract and give the page its blocks:

<!-- example: docs/examples/shop/contract.ts#block -->

```ts
// One of the application's own components, offered to redesigns with typed props.
export const orderBlocks = {
  fulfillment: block({
    label: 'Fulfillment',
    description: "Where an order is in fulfillment, and what's next",
    props: z.object({ detailed: z.boolean() }),
  }),
};
```

Then pass the components to `Page`, typed by the blocks' props:

<!-- example: docs/examples/shop/order-page.tsx#blocks -->

```tsx
/** The application's components behind the order page's blocks, typed by their props. */
const blocks: BlockComponents<typeof orderBlocks> = {
  fulfillment: ({ props }) => (
    <p>{props.detailed ? 'Picked and packed, not yet shipped' : 'Not yet shipped'}</p>
  ),
};

export function OrderPage() {
  const value = useSurface(uitive, 'order');
  return <Page value={value} blocks={blocks} regions={{ order: OrderDetail }} />;
}
```

A block's props are what a model writes, so keep them to objects, strings, numbers, booleans, enums and arrays: structured outputs take no records, unions or nullable values, and `uitive check` names any prop that holds one. Use an enum, an empty string or `'none'` for no value, and an array of objects for a record. Bounds such as `.max(3)` aren't sent to models; policy enforces them when it checks the page.

`uitive generate blocks src/fulfillment.tsx#Fulfillment` writes block specs from components' TypeScript props: literal unions become enums, optional props become required with their defaults described, and props that can't be data, such as callbacks, are reported.

## Redesigns

A redesign replaces a page's value, for this person only.

- **The person's own**: a command planned by a model, or your code on their behalf, applies at once on their own layer. Policy checks it like any plan.
- **A planner's suggestion**: a redesign the person didn't ask for is only ever a suggestion. They preview it in place, then accept or dismiss it.
- **Back to standard**: Revert undoes a redesign, `resetPage` and the command "reset this page" put a page back, and the standard view shows the application as shipped.

Applying a redesign on the person's behalf is one call, checked like any plan:

<!-- example: docs/examples/shop/redesign.ts#apply -->

```ts
/** The person's own redesign: policy checks it like any plan, and Revert brings the page back. */
export function redesignOrders() {
  return uitive.setPage('orders', needsAttention);
}
```

A planner may not place destructive actions on a page it suggests unasked, or fill in a write's params.

## Pages people make

People can make pages of their own, up to twenty each, from generic blocks and regions not tied to a row. They live at `/uitive/<slug>`. `createPage`, `renamePage`, `setUserPage` and `deletePage` manage them, `useUserPages` lists them, and planners never create, rename, redesign or delete them unasked.
