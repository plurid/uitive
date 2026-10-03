import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { NOW, payments, rows } from './__fixtures__/payments.js';
import type { ParamsOf, Perform, PerformContext } from './action.js';
import { createUitive } from './client.js';
import { action, defineApp } from './contract.js';
import { fromRows } from './data.js';
import { field } from './field.js';
import { query } from './query.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options: { perform?: Record<string, Perform>; withUi?: boolean } = {}) {
  const runs: { action: string; params: unknown; context: PerformContext }[] = [];
  const recorder =
    (name: string): Perform =>
    (params, context) => {
      runs.push({ action: name, params, context });
      return { message: `${name} done` };
    };
  const navigate = vi.fn();
  const onError = vi.fn();
  const client = createUitive({
    contract: payments,
    now: () => NOW * 1000,
    onError,
    bindings: {
      fetch: fromRows(rows),
      perform: {
        refund: recorder('refund'),
        'note.add': recorder('note.add'),
        export: recorder('export'),
        ...options.perform,
      },
      context: () => ({ me: 'usr_1', timeZone: 'Europe/Paris' }),
      navigate,
    },
  });
  if (options.withUi !== false) client.confirmations();
  return { client, runs, navigate, onError };
}

const refund = { payment: 'ch_001', reason: 'duplicate' } as const;

describe('perform', () => {
  it('runs reads at once and records them without their params', async () => {
    const { client, runs } = setup();
    const result = await client.perform(
      'export',
      {},
      { via: 'palette', surface: 'home', element: 'tools' },
    );
    expect(result).toEqual({ status: 'done', message: 'export done' });
    expect(runs[0]?.context).toMatchObject({
      action: 'export',
      me: 'usr_1',
      timeZone: 'Europe/Paris',
    });
    expect(runs[0]?.context.idempotencyKey).toMatch(/\w+/);
    expect(client.events(1)[0]).toMatchObject({
      action: 'export',
      via: 'palette',
      surface: 'home',
      element: 'tools',
    });
  });

  it('records interface-only actions, which need no binding', async () => {
    const { client } = setup();
    expect(await client.perform('go.payments')).toEqual({ status: 'done' });
    expect(client.events(1)[0]?.action).toBe('go.payments');
  });

  it('waits for a yes before a write from a generated interface', async () => {
    const { client, runs } = setup();
    const pending = client.perform('note.add', { payment: 'ch_001', text: 'Called the bank' });
    await settle();
    const confirmation = client.getSnapshot().confirmation;
    expect(confirmation).toMatchObject({
      action: 'note.add',
      label: 'Add note',
      effect: 'write',
      params: { payment: 'ch_001', text: 'Called the bank' },
    });
    expect(confirmation?.fields.map((entry) => entry.name)).toEqual(['payment', 'text']);
    expect(confirmation?.phrase).toBeUndefined();
    expect(runs).toHaveLength(0);
    expect(client.confirm(confirmation!.id)).toBe(true);
    expect(await pending).toEqual({ status: 'done', message: 'note.add done' });
    expect(client.getSnapshot().confirmation).toBeUndefined();
    expect(runs).toHaveLength(1);
  });

  it('takes a submitted form as the yes for a write', async () => {
    const { client, runs } = setup();
    const result = await client.perform(
      'note.add',
      { payment: 'ch_001', text: 'Done' },
      { confirmed: true },
    );
    expect(result.status).toBe('done');
    expect(runs).toHaveLength(1);
  });

  it('needs the typed phrase for a destructive run, ignoring case and spacing', async () => {
    const { client, runs } = setup();
    const pending = client.perform('refund', refund);
    await settle();
    const confirmation = client.getSnapshot().confirmation!;
    expect(confirmation).toMatchObject({ effect: 'destructive', phrase: 'Refund payment' });
    expect(client.confirm(confirmation.id)).toBe(false);
    expect(client.confirm(confirmation.id, 'refund')).toBe(false);
    expect(client.confirm(confirmation.id, '  REFUND   payment ')).toBe(true);
    expect((await pending).status).toBe('done');
    expect(runs[0]?.params).toEqual(refund);
  });

  it('records nothing when the user says no', async () => {
    const { client, runs } = setup();
    const pending = client.perform('refund', refund);
    await settle();
    client.cancel(client.getSnapshot().confirmation!.id);
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(runs).toHaveLength(0);
    expect(client.events()).toHaveLength(0);
  });

  it('refuses what nobody can confirm, a second wait, previews and bad params', async () => {
    const lonely = setup({ withUi: false }).client;
    expect(await lonely.perform('refund', refund)).toMatchObject({ status: 'refused' });

    const { client } = setup();
    const first = client.perform('refund', refund);
    await settle();
    expect(await client.perform('note.add', { payment: 'ch_002', text: 'x' })).toEqual({
      status: 'refused',
      message: 'Another change is waiting for your yes',
    });
    client.cancel(client.getSnapshot().confirmation!.id);
    await first;

    client.preview('some-suggestion');
    expect((await client.perform('refund', refund)).message).toMatch(/wait until you accept/);
    expect((await client.perform('export', {})).status).toBe('done');
    client.preview(undefined);

    const bad = await client.perform('refund', { payment: 'ch_001', reason: 'bored' } as never);
    expect(bad.status).toBe('refused');
    expect(bad.message).toMatch(/^Refund payment: /);
    expect(await client.perform('nope' as never)).toEqual({
      status: 'refused',
      message: 'No action "nope"',
    });
  });

  it('cancels a waiting run when the last confirming interface goes', async () => {
    const { client } = setup({ withUi: false });
    const remove = client.confirmations();
    const pending = client.perform('refund', refund);
    await settle();
    remove();
    expect(await pending).toEqual({ status: 'cancelled' });
  });

  it('lets the application confirm its own controls', async () => {
    const { client, runs } = setup({ withUi: false });
    expect((await client.perform('refund', refund, { origin: 'native' })).status).toBe('done');
    expect(runs).toHaveLength(1);
  });

  it('reports failures, and records nothing for them', async () => {
    const { client, onError } = setup({
      perform: {
        export: () => {
          throw new Error('Quota exceeded');
        },
      },
    });
    expect(await client.perform('export', {})).toEqual({
      status: 'failed',
      message: 'Quota exceeded',
    });
    expect(onError).toHaveBeenCalled();
    expect(client.events()).toHaveLength(0);
  });

  it('fails effectful actions without a binding', async () => {
    const client = createUitive({ contract: payments });
    expect(await client.perform('export', {})).toEqual({
      status: 'failed',
      message: 'Nothing runs Export payments here',
    });
  });

  it('refreshes what a run changed, and follows where it leads', async () => {
    const { client, navigate } = setup({
      perform: { export: () => ({ navigate: { href: '/payments?exported=1' } }) },
    });
    const failed = query('payments', {
      fields: ['payments.id'],
      filter: [{ field: 'payments.status', op: 'eq', values: ['failed'] }],
    });
    await client.data!.load(failed);
    expect(client.data!.read(failed).stale).toBe(false);
    const pending = client.perform('refund', refund);
    await settle();
    client.confirm(client.getSnapshot().confirmation!.id, 'Refund payment');
    await pending;
    expect(client.data!.read(failed).stale).toBe(true);
    await client.perform('export', {});
    expect(navigate).toHaveBeenCalledWith('/payments?exported=1');
  });

  it('types params from the action schema', () => {
    expectTypeOf<ParamsOf<typeof payments, 'refund'>>().toEqualTypeOf<{
      payment: string;
      reason: 'duplicate' | 'fraudulent' | 'requested_by_customer';
    }>();
    expectTypeOf<ParamsOf<typeof payments, 'export'>>().toEqualTypeOf<Record<string, never>>();
  });
});

describe('actions in contracts', () => {
  const base = {
    id: 'app',
    description: 'An app',
    sources: {
      orders: {
        label: 'Orders',
        description: 'Orders',
        row: z.object({ id: z.string(), state: field.enum(['open', 'closed']) }),
        key: 'id' as const,
      },
    },
    surfaces: {},
  };
  const attempt = (spec: Record<string, unknown>) => () =>
    defineApp({
      ...base,
      actions: { go: action({ label: 'Go', description: 'Go', ...spec } as never) },
    });

  it('describes params as fields', () => {
    expect(payments.params('refund').map((entry) => [entry.name, entry.type])).toEqual([
      ['payment', 'ref'],
      ['reason', 'enum'],
    ]);
    expect(payments.params('go.home')).toEqual([]);
  });

  it('rejects broken actions', () => {
    expect(attempt({ params: z.object({ tags: z.array(z.string()) }) })).toThrow(/flatten/);
    expect(attempt({ params: z.object({ order: field.ref('carts') }) })).toThrow(
      /unknown source "carts"/,
    );
    expect(attempt({ effect: 'explode' })).toThrow(/effect must be one of/);
    expect(attempt({ confirm: ' ' })).toThrow(/confirm needs/);
    expect(attempt({ invalidates: ['carts'] })).toThrow(/invalidates unknown source/);
    expect(attempt({ when: [{ field: 'orders.state', op: 'eq', values: ['open'] }] })).toThrow(
      /needs a param that refers to a row/,
    );
    expect(
      attempt({
        params: z.object({ order: field.ref('orders') }),
        when: [{ field: 'orders.state', op: 'eq', values: ['lost'] }],
      }),
    ).toThrow(/when: State can't be "lost"/);
  });

  it('keeps the hash of actions without params, and changes it with them', () => {
    const plain = defineApp({
      ...base,
      actions: { go: action({ label: 'Go', description: 'Go' }) },
    });
    const same = defineApp({
      ...base,
      actions: { go: action({ label: 'Go', description: 'Go' }) },
    });
    const ran = defineApp({
      ...base,
      actions: {
        go: action({
          label: 'Go',
          description: 'Go',
          params: z.object({ order: field.ref('orders') }),
          effect: 'write',
        }),
      },
    });
    expect(same.hash).toBe(plain.hash);
    expect(ran.hash).not.toBe(plain.hash);
  });
});
