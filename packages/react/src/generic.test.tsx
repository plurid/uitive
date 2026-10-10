/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  action,
  createUitive,
  defineApp,
  field,
  fromRows,
  query,
  ui,
  type AnyPage,
  type Perform,
} from '@plurid/uitive-core';
import { NOW, payments, rows, sources } from '../../core/src/__fixtures__/payments.js';
import { NOW as SHOP_NOW, order, shop } from '../../core/src/__fixtures__/shop.js';
import { useUitiveRouter } from './hooks.js';
import { createKit } from './kit.js';
import { Page } from './page.js';
import { UitiveBanner, UitiveProvider, Confirmations } from './provider.js';

afterEach(cleanup);

function setup() {
  const performed: { action: string; params: unknown }[] = [];
  const recorder =
    (action: string): Perform =>
    (params) => {
      performed.push({ action, params });
      return { message: `${action} done` };
    };
  const navigate = vi.fn();
  const client = createUitive({
    contract: payments,
    now: () => NOW * 1000,
    bindings: {
      fetch: fromRows(rows),
      perform: {
        refund: recorder('refund'),
        'note.add': recorder('note.add'),
        export: recorder('export'),
      },
      navigate,
    },
  });
  return { client, performed, navigate };
}

function show(client: ReturnType<typeof setup>['client'], value: AnyPage, kit = createKit()) {
  return render(
    <UitiveProvider client={client} kit={kit}>
      <Confirmations />
      <Page value={value} blocks={{}} />
    </UitiveProvider>,
  );
}

const recent = query('payments', {
  fields: ['payments.id', 'payments.amount', 'payments.customer.name', 'payments.status'],
  sort: [{ field: 'payments.created', direction: 'desc' }],
  limit: 3,
});

describe('generic blocks', () => {
  it('draw a table from its query, with money, relations and links to each row', async () => {
    const { client, navigate } = setup();
    show(
      client,
      ui.page(
        ui.section('', 'stack', [
          ui.block('table', {
            data: 'recent',
            columns: ['payments.id', 'payments.amount', 'payments.customer.name'],
            lookups: [],
            rowActions: [],
            density: 'compact',
            link: 'entity',
          }),
        ]),
        [{ name: 'recent', query: recent }],
      ),
    );
    expect(await screen.findByText('ch_000')).toBeTruthy();
    expect(screen.getByText('$10.00')).toBeTruthy();
    expect(screen.getByText('Customer ada')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ch_001' }));
    expect(navigate).toHaveBeenCalledWith('/payments/ch_001');
  });

  it("show money one hop away in the related row's currency", async () => {
    const client = createUitive({
      contract: shop,
      now: () => SHOP_NOW,
      bindings: {
        fetch: fromRows({
          orders: [order('o1')],
          customers: [{ id: 'c1', name: 'Kenji', balance: 500_000, currency: 'jpy' }],
          accounts: [],
        }),
      },
    });
    const balances = query('orders', { fields: ['orders.id', 'orders.customer.balance'] });
    const page = ui.page(
      ui.section('', 'stack', [
        ui.block('table', {
          data: 'balances',
          columns: ['orders.id', 'orders.customer.balance'],
          lookups: [],
          rowActions: [],
          density: 'compact',
          link: 'none',
        }),
      ]),
      [{ name: 'balances', query: balances }],
    );
    render(
      <UitiveProvider client={client} kit={createKit()}>
        <Page value={page} blocks={{}} />
      </UitiveProvider>,
    );
    const yen = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'JPY' });
    expect(await screen.findByText(yen.format(500_000))).toBeTruthy();
  });

  it('join figures per row, so a customer sits beside their lifetime value', async () => {
    const { client } = setup();
    show(
      client,
      ui.page(
        ui.section('', 'stack', [
          ui.block('table', {
            data: 'customers',
            columns: ['customers.name'],
            lookups: [{ data: 'lifetime', label: 'Lifetime value' }],
            rowActions: [],
            density: 'comfortable',
            link: 'none',
          }),
        ]),
        [
          {
            name: 'customers',
            query: query('customers', { fields: ['customers.name'], limit: 2 }),
          },
          {
            name: 'lifetime',
            query: query('payments', {
              filter: [{ field: 'payments.currency', op: 'eq', values: ['usd'] }],
              aggregate: { measure: 'sum', of: 'payments.amount', by: 'payments.customer' },
            }),
          },
        ],
      ),
    );
    const ada = (await screen.findByText('Customer ada')).closest('tr') as HTMLElement;
    const expected = rows.payments
      .filter((row) => row.customer === 'cus_ada' && row.currency === 'usd')
      .reduce((total, row) => total + row.amount / 100, 0);
    expect(
      within(ada).getByText(
        new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(expected),
      ),
    ).toBeTruthy();
  });

  it('ask for missing params, then for the typed phrase, before a destructive row action', async () => {
    const { client, performed } = setup();
    show(
      client,
      ui.page(
        ui.section('', 'stack', [
          ui.block('table', {
            data: 'recent',
            columns: ['payments.id'],
            lookups: [],
            rowActions: [{ action: 'refund', set: [] }],
            density: 'compact',
            link: 'none',
          }),
        ]),
        [{ name: 'recent', query: query('payments', { fields: ['payments.id'], limit: 3 }) }],
      ),
    );
    // ch_000 failed, so only the succeeded payments offer a refund.
    const failed = (await screen.findByText('ch_000')).closest('tr') as HTMLElement;
    expect(within(failed).queryByRole('button', { name: 'Refund payment' })).toBeNull();
    const paid = screen.getByText('ch_001').closest('tr') as HTMLElement;
    fireEvent.click(within(paid).getByRole('button', { name: 'Refund payment' }));

    const form = await screen.findByRole('dialog', { name: 'Refund payment' });
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'duplicate' } });
    await act(async () => {
      fireEvent.submit(
        within(form)
          .getByRole('button', { name: 'Refund payment' })
          .closest('form') as HTMLFormElement,
      );
    });

    const confirm = await screen.findByRole('dialog', { name: 'Refund payment' });
    const button = within(confirm)
      .getAllByRole('button', { name: 'Refund payment' })
      .at(-1) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(confirm).getByLabelText('Type "Refund payment" to confirm'), {
      target: { value: 'refund payment' },
    });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(performed).toEqual([
      { action: 'refund', params: { payment: 'ch_001', reason: 'duplicate' } },
    ]);
  });

  it('show a metric against the period before, and a chart of a summary', async () => {
    const { client } = setup();
    const { container } = show(
      client,
      ui.page(
        ui.section('', 'grid', [
          ui.block('metric', {
            data: 'count',
            label: 'Payments this fortnight',
            compare: 'previous',
          }),
          ui.block('chart', { data: 'daily', kind: 'bar', stacked: true }),
        ]),
        [
          {
            name: 'count',
            query: query('payments', {
              filter: [{ field: 'payments.created', op: 'gte', values: ['-14d'] }],
              aggregate: { measure: 'count' },
            }),
          },
          {
            name: 'daily',
            query: query('payments', {
              aggregate: {
                measure: 'count',
                by: 'payments.created',
                bucket: 'week',
                split: 'payments.status',
              },
            }),
          },
        ],
      ),
    );
    expect(await screen.findByText('Payments this fortnight')).toBeTruthy();
    const fortnight = rows.payments.filter((row) => row.created >= NOW - 14 * 86_400).length;
    expect(await screen.findByText(String(fortnight))).toBeTruthy();
    expect(await screen.findByText(/on the period before/)).toBeTruthy();
    expect(container.querySelectorAll('.uitive-chart rect').length).toBeGreaterThan(0);
  });

  it('draw lists, timelines, boards and the page’s own row', async () => {
    const { client } = setup();
    client.setLocation('/payments/ch_002');
    show(
      client,
      ui.page(
        ui.section('', 'stack', [
          ui.block('detail', {
            data: 'self',
            fields: ['payments.description', 'payments.status'],
            columns: 2,
          }),
          ui.block('list', {
            data: 'recent',
            title: 'payments.id',
            subtitle: 'payments.customer.name',
            meta: 'none',
            badge: 'payments.status',
            rowActions: [],
            link: 'none',
          }),
          ui.block('timeline', {
            data: 'recent2',
            time: 'payments.created',
            title: 'payments.id',
            detail: 'none',
          }),
          ui.block('board', {
            data: 'recent3',
            column: 'payments.status',
            title: 'payments.id',
            meta: 'none',
          }),
        ]),
        [
          {
            name: 'self',
            query: query('payments', {
              fields: ['payments.description', 'payments.status'],
              filter: [{ field: 'payments.id', op: 'eq', values: ['$current'] }],
              limit: 1,
            }),
          },
          { name: 'recent', query: recent },
          { name: 'recent2', query: { ...recent, fields: ['payments.id', 'payments.created'] } },
          { name: 'recent3', query: { ...recent, fields: ['payments.id', 'payments.status'] } },
        ],
      ),
    );
    expect(await screen.findByText('Order 1002')).toBeTruthy();
    expect(screen.getAllByText('Succeeded').length).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { name: 'Failed (1)' })).toBeTruthy();
  });

  it('run forms, buttons and links', async () => {
    const { client, performed, navigate } = setup();
    client.setLocation('/payments/ch_004');
    show(
      client,
      ui.page(
        ui.section('', 'stack', [
          ui.block('form', { action: 'note.add', set: [{ param: 'payment', value: '$current' }] }),
          ui.block('actions', {
            list: 'nav',
            items: [{ action: 'export', set: [] }],
            size: 'regular',
          }),
          ui.block('links', { items: [{ label: 'Ada', route: 'customer', entity: 'cus_ada' }] }),
          ui.block('note', { title: 'Remember', text: 'Disputes need evidence within a week' }),
        ]),
      ),
    );
    expect(screen.getByText(/^Payment:/).textContent).toBe('Payment: ch_004');
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Called the bank' } });
    await act(async () => {
      fireEvent.submit(
        screen.getByRole('button', { name: 'Add note' }).closest('form') as HTMLFormElement,
      );
    });
    // The form showed every value, so submitting it was the yes.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(performed).toContainEqual({
      action: 'note.add',
      params: { payment: 'ch_004', text: 'Called the bank' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Payments' }));
    });
    expect(navigate).toHaveBeenLastCalledWith('/payments');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export payments' }));
    });
    expect(performed.at(-1)?.action).toBe('export');

    fireEvent.click(screen.getByRole('link', { name: 'Ada' }));
    expect(navigate).toHaveBeenLastCalledWith('/customers/cus_ada');
    expect(screen.getByText('Disputes need evidence within a week')).toBeTruthy();
  });

  it('say what happened when an action ran, through the kit’s notice, once per run', async () => {
    const shown: { tone: string; text: string }[] = [];
    const kit = createKit({
      Notice: ({ tone, children }) => {
        // A toast shows itself when it mounts; each run mounts a new one.
        useEffect(() => {
          shown.push({ tone, text: String(children) });
        }, [tone, children]);
        return null;
      },
    });
    let fail = false;
    const client = createUitive({
      contract: payments,
      now: () => NOW * 1000,
      bindings: {
        fetch: fromRows(rows),
        perform: {
          export: () => {
            if (fail) throw new Error('The export service is down');
          },
        },
      },
    });
    show(
      client,
      ui.page(
        ui.section('', 'stack', [
          ui.block('actions', {
            list: 'none',
            items: [{ action: 'export', set: [] }],
            size: 'regular',
          }),
        ]),
      ),
      kit,
    );
    const button = screen.getByRole('button', { name: 'Export payments' });
    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      fireEvent.click(button);
    });
    fail = true;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(shown.map((entry) => entry.tone)).toEqual(['success', 'success', 'error']);
    expect(shown[0]?.text).toBe('Export payments: done');
  });

  it('say so when there is no provider to fetch with', () => {
    const { client } = setup();
    render(
      <Page
        value={ui.page(ui.section('', 'stack', [ui.block('note', { title: '', text: 'x' })]))}
        blocks={{}}
      />,
    );
    expect(screen.getByText(/Wrap the page in <UitiveProvider>/)).toBeTruthy();
    expect(client).toBeTruthy();
  });

  it('take per-type overrides from a kit', async () => {
    const { client } = setup();
    const kit = createKit({
      values: { money: ({ value }) => <em>{`money:${String(value)}`}</em> },
    });
    show(
      client,
      ui.page(
        ui.section('', 'stack', [
          ui.block('table', {
            data: 'recent',
            columns: ['payments.amount'],
            lookups: [],
            rowActions: [],
            density: 'compact',
            link: 'none',
          }),
        ]),
        [{ name: 'recent', query: { ...recent, limit: 1 } }],
      ),
      kit,
    );
    expect(await screen.findByText('money:1000')).toBeTruthy();
  });
});

describe('integration helpers', () => {
  it('connect a router: location in, links out', () => {
    const { client } = setup();
    const push = vi.fn();
    function Router({ path }: { path: string }) {
      useUitiveRouter(client, { path, navigate: push });
      return null;
    }
    const view = render(<Router path="/payments/ch_003" />);
    expect(client.getSnapshot().location?.entity).toEqual({ source: 'payments', key: 'ch_003' });
    client.navigate({ route: 'customer', params: { id: 'cus_bo' } });
    expect(push).toHaveBeenCalledWith('/customers/cus_bo');
    view.rerender(<Router path="/payments" />);
    expect(client.getSnapshot().location?.route).toBe('payments');
  });

  it('give custom elements their client as a property, registering them on first use', () => {
    const { client } = setup();
    const { container } = render(<UitiveBanner client={client} id="banner" />);
    const element = container.querySelector('uitive-banner') as HTMLElement & { client?: unknown };
    expect(customElements.get('uitive-banner')).toBeDefined();
    expect(element.shadowRoot).not.toBeNull();
    expect(element.client).toBe(client);
    expect(element.id).toBe('banner');
    expect(element.getAttribute('client')).toBeNull();
  });
});

describe('runs from generated pages', () => {
  const news = defineApp({
    id: 'news',
    description: 'A newsletter',
    actions: {
      subscribe: action({
        label: 'Subscribe',
        description: 'Subscribes someone',
        params: z.object({
          email: z.string(),
          notify: field.bool(),
          donation: field.money({ code: 'usd' }),
          seats: field.number(),
        }),
        effect: 'write',
      }),
    },
    surfaces: {},
  });

  function newsletter(set: { param: string; value: string }[], perform: Perform) {
    const client = createUitive({ contract: news, bindings: { perform: { subscribe: perform } } });
    render(
      <UitiveProvider client={client}>
        <Confirmations />
        <Page
          value={ui.page(ui.section('', 'stack', [ui.block('form', { action: 'subscribe', set })]))}
          blocks={{}}
        />
      </UitiveProvider>,
    );
    return client;
  }

  const submit = async (button: string) => {
    await act(async () => {
      fireEvent.submit(
        screen.getByRole('button', { name: button }).closest('form') as HTMLFormElement,
      );
    });
  };

  const confirm = async (name: string) => {
    const dialog = await screen.findByRole('dialog', { name });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name }));
    });
  };

  it('show and send set values as validation parses them', async () => {
    const performed: unknown[] = [];
    newsletter(
      [
        { param: 'notify', value: 'yes' },
        { param: 'donation', value: '$5' },
        { param: 'seats', value: '1,000' },
      ],
      (params) => {
        performed.push(params);
      },
    );
    expect(screen.getByText(/^Notify:/).textContent).toBe('Notify: Yes');
    const dollars = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
    expect(screen.getByText(/^Donation:/).textContent).toBe(`Donation: ${dollars.format(5)}`);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    await submit('Subscribe');
    expect(performed).toEqual([{ email: 'a@b.c', notify: true, donation: 5, seats: 1000 }]);
  });

  it('send an unchecked flag as no, and label money with its currency', async () => {
    const performed: unknown[] = [];
    newsletter([], (params) => {
      performed.push(params);
    });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Donation (USD)'), { target: { value: '12.5' } });
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '2' } });
    await submit('Subscribe');
    expect(performed).toEqual([{ email: 'a@b.c', notify: false, donation: 12.5, seats: 2 }]);
  });

  it('run a form once however often it is submitted while the run is in flight', async () => {
    const performed: unknown[] = [];
    const client = createUitive({
      contract: payments,
      bindings: {
        fetch: fromRows(rows),
        perform: {
          'note.add': async (params) => {
            performed.push(params);
            await new Promise((resolve) => setTimeout(resolve, 20));
          },
        },
      },
    });
    render(
      <UitiveProvider client={client}>
        <Confirmations />
        <Page
          blocks={{}}
          value={ui.page(
            ui.section('', 'stack', [
              ui.block('form', {
                action: 'note.add',
                set: [{ param: 'payment', value: 'ch_001' }],
              }),
            ]),
          )}
        />
      </UitiveProvider>,
    );
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'hello' } });
    const form = screen
      .getByRole('button', { name: 'Add note' })
      .closest('form') as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      await new Promise((resolve) => setTimeout(resolve, 5));
      fireEvent.submit(form);
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(performed).toEqual([{ payment: 'ch_001', text: 'hello' }]);
  });

  it('run a form that shows every value on submit, with no confirmation interface', async () => {
    const performed: unknown[] = [];
    const client = createUitive({
      contract: payments,
      bindings: {
        fetch: fromRows(rows),
        perform: { 'note.add': (params) => void performed.push(params) },
      },
    });
    render(
      <UitiveProvider client={client}>
        <Page
          blocks={{}}
          value={ui.page(
            ui.section('', 'stack', [
              ui.block('form', {
                action: 'note.add',
                set: [{ param: 'payment', value: 'ch_001' }],
              }),
            ]),
          )}
        />
      </UitiveProvider>,
    );
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'hello' } });
    await submit('Add note');
    expect(performed).toEqual([{ payment: 'ch_001', text: 'hello' }]);
  });

  it('ask through <Confirmations /> when a form can’t show a value it sends', async () => {
    const notes = defineApp({
      id: 'notes',
      description: 'Notes on payments',
      actions: {
        note: action({
          label: 'Add note',
          description: 'Adds a note, to a payment when there is one',
          params: z.object({ payment: field.ref('payments').optional(), text: z.string() }),
          effect: 'write',
        }),
      },
      sources: { payments: sources.payments, customers: sources.customers },
      surfaces: {},
    });
    const performed: unknown[] = [];
    const client = createUitive({
      contract: notes,
      bindings: {
        fetch: fromRows(rows),
        perform: { note: (params) => void performed.push(params) },
      },
    });
    const value = ui.page(
      ui.section('', 'stack', [
        ui.block('form', { action: 'note', set: [{ param: 'payment', value: '$current' }] }),
      ]),
    );
    const view = render(
      <UitiveProvider client={client}>
        <Page blocks={{}} value={value} />
      </UitiveProvider>,
    );
    // No row is known here, so the form can't show which payment the note is for.
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'hello' } });
    await submit('Add note');
    expect(performed).toEqual([]);
    expect(screen.getByText('Nothing here can ask you to confirm this')).toBeTruthy();
    view.unmount();
    render(
      <UitiveProvider client={client}>
        <Confirmations />
        <Page blocks={{}} value={value} />
      </UitiveProvider>,
    );
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'hello' } });
    await submit('Add note');
    expect(performed).toEqual([]);
    await confirm('Add note');
    expect(performed).toEqual([{ text: 'hello' }]);
  });

  it('show every param a row action will run with in its form, which counts as the yes', async () => {
    const shop = defineApp({
      id: 'shop',
      description: 'A shop',
      actions: {
        adjust: action({
          label: 'Adjust payment',
          description: 'Changes a payment',
          params: z.object({
            payment: field.ref('payments'),
            amount: field.money({ code: 'usd' }),
            memo: z.string(),
          }),
          effect: 'write',
        }),
      },
      sources: { payments: sources.payments, customers: sources.customers },
      surfaces: {},
    });
    const performed: unknown[] = [];
    const client = createUitive({
      contract: shop,
      bindings: {
        fetch: fromRows(rows),
        perform: { adjust: (params) => void performed.push(params) },
      },
    });
    render(
      <UitiveProvider client={client}>
        <Confirmations />
        <Page
          blocks={{}}
          value={ui.page(
            ui.section('', 'stack', [
              ui.block('table', {
                data: 'recent',
                columns: ['payments.id'],
                lookups: [],
                rowActions: [{ action: 'adjust', set: [{ param: 'amount', value: '250000' }] }],
                density: 'compact',
                link: 'none',
              }),
            ]),
            [{ name: 'recent', query: query('payments', { fields: ['payments.id'], limit: 2 }) }],
          )}
        />
      </UitiveProvider>,
    );
    const row = (await screen.findByText('ch_001')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Adjust payment' }));
    const form = await screen.findByRole('dialog', { name: 'Adjust payment' });
    const amount = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
      250000,
    );
    expect(within(form).getByText(amount)).toBeTruthy();
    expect(within(form).getByText('ch_001')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('Memo'), { target: { value: 'ok' } });
    await act(async () => {
      fireEvent.submit(form.querySelector('form') as HTMLFormElement);
    });
    // The form showed every param, the row's and the page's too, so submitting it was the yes.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(performed).toEqual([{ payment: 'ch_001', amount: 250000, memo: 'ok' }]);
  });

  it('keep the notice when the rows it acted on are gone', async () => {
    const shop = defineApp({
      id: 'shop',
      description: 'A shop',
      actions: {
        archive: action({
          label: 'Archive',
          description: 'Archives a payment',
          params: z.object({ payment: field.ref('payments') }),
          effect: 'write',
          invalidates: ['payments'],
        }),
      },
      sources: { payments: sources.payments, customers: sources.customers },
      surfaces: {},
    });
    const held = { payments: rows.payments.slice(1, 2), customers: rows.customers };
    const client = createUitive({
      contract: shop,
      bindings: {
        fetch: fromRows(held),
        perform: {
          archive: () => {
            held.payments.length = 0;
            return { message: 'Archived' };
          },
        },
      },
    });
    render(
      <UitiveProvider client={client}>
        <Confirmations />
        <Page
          blocks={{}}
          value={ui.page(
            ui.section('', 'stack', [
              ui.block('list', {
                data: 'all',
                title: 'payments.id',
                subtitle: 'none',
                meta: 'none',
                badge: 'none',
                rowActions: [{ action: 'archive', set: [] }],
                link: 'none',
              }),
            ]),
            [{ name: 'all', query: query('payments', { fields: ['payments.id'] }) }],
          )}
        />
      </UitiveProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await confirm('Archive');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(screen.getByText('Archived')).toBeTruthy();
  });

  it('follow a route action without recording it twice', async () => {
    const client = createUitive({ contract: payments, bindings: { fetch: fromRows(rows) } });
    function App() {
      const [path, setPath] = useState('/');
      useUitiveRouter(client, { path, navigate: setPath });
      return (
        <Page
          blocks={{}}
          value={ui.page(
            ui.section('', 'stack', [
              ui.block('actions', {
                list: 'none',
                items: [{ action: 'go.payments', set: [] }],
                size: 'regular',
              }),
            ]),
          )}
        />
      );
    }
    render(
      <UitiveProvider client={client}>
        <App />
      </UitiveProvider>,
    );
    const uses = () => client.events().filter((event) => event.action === 'go.payments');
    const before = uses().length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Payments' }));
    });
    expect(uses().length - before).toBe(1);
    expect(client.getSnapshot().location?.route).toBe('payments');
  });
});

describe('row actions', () => {
  it('appear where `when` allows, judged as queries filter, money in major units', async () => {
    const shop = defineApp({
      id: 'shop',
      description: 'A shop',
      actions: {
        review: action({
          label: 'Review',
          description: 'Reviews a mid-sized payment',
          params: z.object({ payment: field.ref('payments') }),
          effect: 'write',
          when: [
            { field: 'payments.amount', op: 'between', values: ['20', '60'] },
            { field: 'payments.customer', op: 'eq', values: ['cus_ada'] },
            { field: 'payments.description', op: 'contains', values: ['10'] },
          ],
        }),
      },
      sources: { payments: sources.payments, customers: sources.customers },
      surfaces: {},
    });
    const client = createUitive({
      contract: shop,
      bindings: { fetch: fromRows(rows) },
    });
    render(
      <UitiveProvider client={client}>
        <Page
          blocks={{}}
          value={ui.page(
            ui.section('', 'stack', [
              ui.block('table', {
                data: 'all',
                columns: ['payments.id'],
                lookups: [],
                rowActions: [{ action: 'review', set: [] }],
                density: 'compact',
                link: 'none',
              }),
            ]),
            [{ name: 'all', query: query('payments', { fields: ['payments.id'], limit: 40 }) }],
          )}
        />
      </UitiveProvider>,
    );
    await screen.findByText('ch_000');
    const expected = rows.payments
      .filter((row) => {
        const major = row.amount / (row.currency === 'jpy' ? 1 : 100);
        return (
          major >= 20 && major <= 60 && row.customer === 'cus_ada' && row.description.includes('10')
        );
      })
      .map((row) => row.id);
    const offered = screen
      .queryAllByRole('button', { name: 'Review' })
      .map((button) => button.closest('tr')?.querySelector('td')?.textContent);
    expect(expected.length).toBeGreaterThan(0);
    expect(offered).toEqual(expected);
  });
});

describe('summaries', () => {
  it('compare a metric with the period before, on the client’s clock, fetching it once', async () => {
    const base = fromRows(rows);
    const requests: unknown[] = [];
    const client = createUitive({
      contract: payments,
      now: () => NOW * 1000,
      bindings: {
        fetch: (request, context) => {
          requests.push(request.filter);
          return base(request, context);
        },
      },
    });
    show(
      client,
      ui.page(
        ui.section('', 'stack', [
          ui.block('metric', {
            data: 'count',
            label: 'Payments this fortnight',
            compare: 'previous',
          }),
        ]),
        [
          {
            name: 'count',
            query: query('payments', {
              filter: [{ field: 'payments.created', op: 'gte', values: ['-14d'] }],
              aggregate: { measure: 'count' },
            }),
          },
        ],
      ),
    );
    const now = rows.payments.filter((row) => row.created >= NOW - 14 * 86_400).length;
    const before = rows.payments.filter(
      (row) => row.created >= NOW - 28 * 86_400 && row.created < NOW - 14 * 86_400,
    ).length;
    const change = Math.round(((now - before) / before) * 100);
    expect(
      await screen.findByText(`${change > 0 ? '+' : ''}${change}% on the period before`),
    ).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(requests.length).toBe(2);
  });

  it('chart amounts with their currencies, never adding different ones together', async () => {
    const { client } = setup();
    const { container } = show(
      client,
      ui.page(
        ui.section('', 'stack', [
          ui.block('chart', { data: 'byCurrency', kind: 'pie', stacked: false }),
        ]),
        [
          {
            name: 'byCurrency',
            query: query('payments', {
              aggregate: { measure: 'sum', of: 'payments.amount', by: 'payments.currency' },
            }),
          },
        ],
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    // Three currencies can't be shares of one whole, so they show side by side.
    expect(container.querySelector('.uitive-chart[data-kind="pie"]')).toBeNull();
    const titles = [...container.querySelectorAll('.uitive-chart rect title')].map(
      (node) => node.textContent,
    );
    const yen = rows.payments
      .filter((row) => row.currency === 'jpy')
      .reduce((total, row) => total + row.amount, 0);
    const format = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'JPY' });
    expect(titles).toContain(`jpy: ${format.format(yen)}`);
  });

  it('say when a scan cap cut a chart, timeline, board or detail short', async () => {
    const capped = defineApp({
      id: 'capped',
      description: 'A small scan',
      actions: {},
      sources: { payments: { ...sources.payments, scan: 10 }, customers: sources.customers },
      surfaces: {},
    });
    const client = createUitive({
      contract: capped,
      now: () => NOW * 1000,
      bindings: { fetch: fromRows(rows) },
    });
    const all = query('payments', {
      fields: ['payments.id', 'payments.status', 'payments.created'],
      search: 'Order',
    });
    render(
      <UitiveProvider client={client}>
        <Page
          blocks={{}}
          value={ui.page(
            ui.section('', 'stack', [
              ui.block('chart', { data: 'byStatus', kind: 'bar', stacked: false }),
              ui.block('timeline', {
                data: 'all',
                time: 'payments.created',
                title: 'payments.id',
                detail: 'none',
              }),
              ui.block('board', {
                data: 'all',
                column: 'payments.status',
                title: 'payments.id',
                meta: 'none',
              }),
              ui.block('detail', { data: 'all', fields: ['payments.id'], columns: 1 }),
            ]),
            [
              { name: 'all', query: all },
              {
                name: 'byStatus',
                query: query('payments', {
                  aggregate: { measure: 'count', by: 'payments.status' },
                }),
              },
            ],
          )}
        />
      </UitiveProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getAllByText('Showing what loaded so far')).toHaveLength(4);
  });
});

describe('links', () => {
  it('open the page’s own row for $current, and leave out a link to no row', () => {
    const { client, navigate } = setup();
    const value = ui.page(
      ui.section('', 'stack', [
        ui.block('links', {
          items: [
            { label: 'This payment', route: 'payment', entity: '$current' },
            { label: 'All payments', route: 'payments', entity: '' },
          ],
        }),
      ]),
    );
    const view = show(client, value);
    expect(screen.queryByRole('link', { name: 'This payment' })).toBeNull();
    expect(screen.getByRole('link', { name: 'All payments' }).getAttribute('href')).toBe(
      '/payments',
    );
    view.unmount();
    act(() => client.setLocation('/payments/ch_004'));
    show(client, value);
    const link = screen.getByRole('link', { name: 'This payment' });
    expect(link.getAttribute('href')).toBe('/payments/ch_004');
    fireEvent.click(link);
    expect(navigate).toHaveBeenLastCalledWith('/payments/ch_004');
  });
});
