# React

`@plurid/uitive-react` connects a client to React 18.3 or 19: a provider, hooks that re-render only when what they read changes, a page renderer, the generic blocks, and the kit they are drawn with. [Getting started](getting-started.md) builds a first integration; this page covers the whole package. The API reference is [api/react.md](api/react.md).

## The provider

`UitiveProvider` makes the client and the kit available to pages, generic blocks and confirmations below it. Mount it once, near the root, with `Confirmations` inside it.

<!-- example: docs/examples/shop/admin.tsx#provider -->

```tsx
export function Admin() {
  return (
    <UitiveProvider client={uitive} kit={kit}>
      {/* Asks before anything changes data; without it, generated pages can't write at all. */}
      <Confirmations />
      <OrdersPage />
    </UitiveProvider>
  );
}
```

- `kit` is what generic blocks are drawn with; it defaults to semantic HTML. See [The kit](#the-kit).
- `styles` adds the default kit's styles, which kits built with `createKit` still use for layout. Turn it off when your design system styles everything.
- The provider keeps the person's state across tab switches and visits: usage is saved whenever the page is hidden, and a new session starts when they come back after a while, which is when planned changes may apply.

## Hooks

Every hook takes the client first.

| Hook                                                                           | What it gives                                                                                                     |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [`useSurface`](api/react.md#usesurface)                                        | A surface as this person has it: a list's visible and overflow actions, a choice's value, a collection, or a page |
| [`useStandard`](api/react.md#usestandard)                                      | A surface as the application ships it                                                                             |
| [`useCommand`](api/react.md#usecommand)                                        | `ask(text)`, with its pending state, result and error                                                             |
| [`usePlan`](api/react.md#useplan)                                              | `plan()`, with its pending state                                                                                  |
| [`useAction`](api/react.md#useaction)                                          | Runs one action from the application's own control, counted as use                                                |
| [`usePerform`](api/react.md#useperform)                                        | Runs any action; writes wait for the person's yes                                                                 |
| [`useConfirmation`](api/react.md#useconfirmation)                              | The run waiting for a yes, with `confirm` and `cancel`, for a confirmation of your own                            |
| [`useQuery`](api/react.md#usequery), [`useQueries`](api/react.md#usequeries)   | Query results, shared and cached                                                                                  |
| [`useUitiveRouter`](api/react.md#useuitiverouter)                              | Connects your router: location in, links out                                                                      |
| [`useLocation`](api/react.md#uselocation)                                      | Where the person is, as the router last reported it                                                               |
| [`useRanked`](api/react.md#useranked)                                          | Every action, ranked by use, for a command palette                                                                |
| [`useView`](api/react.md#useview)                                              | Whether the person sees their own interface or the standard one                                                   |
| [`useLatest`](api/react.md#uselatest), [`usePending`](api/react.md#usepending) | The latest adaptation, and changes waiting for a safe moment                                                      |
| [`useUserPages`](api/react.md#useuserpages)                                    | The pages the person made                                                                                         |
| [`useSnapshot`](api/react.md#usesnapshot)                                      | Everything the client holds, for panels; it changes with every use                                                |
| [`useLifecycle`](api/react.md#uselifecycle)                                    | What the provider does for state across visits, for a client used without it                                      |

Server rendering draws the standard layout, so hydration never mismatches; the person's own interface follows on the client.

## Lists and choices

Draw a list from `useSurface` with your own components: its `visible` actions, then its `overflow` under a More menu or in a palette. Record each use with how it was reached, `region` or `overflow`, as the quick start's toolbar does: [Getting started](getting-started.md#draw-the-toolbar). An action with an effect can go through `useAction` instead, which records it.

A choice's value is a string; `client.set` changes it, as does a command naming a value. A collection gives `items` the person accepted and `suggestions` waiting, which `client.accept(entry.operation)` and `client.dismiss(entry.operation)` answer.

## Pages

`Page` draws a page: sections, tabs, regions, the application's own blocks and the generic blocks.

<!-- example: docs/examples/shop/orders-page.tsx#page -->

```tsx
export function OrdersPage() {
  const value = useSurface(uitive, 'orders');
  return <Page value={value} blocks={{}} regions={{ orders: OrdersList }} />;
}
```

- `regions` gives each region its component: usually the existing page.
- `blocks` gives each of the application's own blocks its component, typed by the block's props with `BlockComponents`: see [Pages](pages.md#your-own-blocks).
- `context` is the page's context value, and `current` the row it is about; by default, the row the location names.
- Each block sits in a wrapper with `data-block` and `data-element` attributes, and the page and its sections carry `data-layout`, for styling; `className` replaces the page's `uitive-page` class.

## Routers

Tell the client where the person is on every route change, and let it follow links through your router. With React Router:

<!-- not-typechecked -->

```tsx
const location = useLocation();
const navigate = useNavigate();
useUitiveRouter(uitive, { path: location.pathname + location.search, navigate });
```

With Next.js, `useUitiveRouter(uitive, { path: usePathname(), navigate: useRouter().push })`. Visiting a route records its action, and generated links and row links follow your routes.

## Confirmations

`<Confirmations />` asks before a generated page changes data: what the action does and to what, and for a destructive one, the phrase to type. Mount it once inside the provider; without it, generated pages can't write at all. For a confirmation of your own, `useConfirmation` gives the waiting run and the means to answer it.

## The kit

Generic blocks draw only with the kit's parts, so mapping a part to your design system restyles every block that uses it. Start from the default and replace parts one at a time:

<!-- example: docs/examples/shop/kit.tsx#kit -->

```tsx
// The design system's parts, mapped one at a time; the rest of the default kit stays.
export const kit = createKit({
  Title: ({ children }) => <h1 className="page-title">{children}</h1>,
  Section: ({ title, children }) => (
    <section className="card">
      {title && <h2 className="card-title">{title}</h2>}
      <div className="card-body">{children}</div>
    </section>
  ),
  Button: ({ children, onClick, tone = 'plain', disabled, type = 'button' }) => (
    <button type={type} className={`button button-${tone}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Notice: ({ tone, children }) => (
    <p className={`notice notice-${tone}`} role="status">
      {children}
    </p>
  ),
});
```

| Block                    | Parts                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- |
| page, section, tabs      | `Title` (a page's own heading), `Section` (a container and its title), `Tabs` |
| table                    | `Table`, `Value` for each cell, `Button` for row actions                      |
| list, timeline           | `List`, `Badge`                                                               |
| detail                   | `Grid`, `Text`                                                                |
| metric                   | `Stat`, `Value`                                                               |
| chart                    | `Chart`                                                                       |
| board                    | `Grid`, `Card`, `List`                                                        |
| form, actions            | `Stack`, `Field`, `Button`, `Text`                                            |
| note, links              | `Card`, `Text`, `Link`                                                        |
| every block              | `Status` (empty, loading, error, partial data), `Notice` after a run          |
| confirmations, run forms | `Dialog`, `Field`, `Button`, `Value`                                          |

- Blocks have no container of their own: map `Section` to your card or panel when tables and lists should sit inside one.
- `Notice` says how a run ended. Map it to your toast: each run mounts a new one, so it can show itself when it mounts and render nothing.
- `values` changes how one kind of value shows everywhere, such as `money`, or one source's references, such as `'ref:customers'`.
- The default kit reads `--uitive-accent`, `--uitive-on-accent`, `--uitive-surface`, `--uitive-text`, `--uitive-border`, `--uitive-radius`, `--uitive-gap`, `--uitive-good`, `--uitive-bad`, `--uitive-badge` and `--uitive-dialog`, so a theme can restyle it without replacing parts.

Every part and its props are in [api/react.md](api/react.md#kit).

## The meta-interface

`UitiveBanner` says what just changed and why, with Revert, and Keep for changes the person didn't make, and answers commands, refusals included. `UitiveYourInterface` lists every change the person owns, with export, import, freeze and reset. `UitiveDebug` shows usage, requests and the planning loop, for development. Each takes the client, and registers its element the first time it renders.

- The banner floats at the bottom right; `docked` puts it in the page's flow, such as in your notification area. "Your interface" is a panel, for a settings page or a side panel.
- They render in shadow roots, styled with `--uitive-accent`, `--uitive-surface`, `--uitive-text`, `--uitive-muted`, `--uitive-border`, `--uitive-radius` and `--uitive-font`, with `::part(content)` and `::part(heading)` for more.
