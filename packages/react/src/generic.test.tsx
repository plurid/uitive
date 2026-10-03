/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUitive, fromRows, query, ui, type AnyPage, type Perform } from '@plurid/uitive-core';
import { NOW, payments, rows } from '../../core/src/__fixtures__/payments.js';
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
    expect(screen.getByText('Payment: ch_004')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Called the bank' } });
    await act(async () => {
      fireEvent.submit(
        screen.getByRole('button', { name: 'Add note' }).closest('form') as HTMLFormElement,
      );
    });
    expect(performed).toContainEqual({
      action: 'note.add',
      params: { payment: 'ch_004', text: 'Called the bank' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Payments' }));
    });
    expect(client.events().at(-1)?.action).toBe('go.payments');
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
