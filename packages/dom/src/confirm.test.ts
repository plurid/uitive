// @vitest-environment happy-dom
import {
  action,
  createUitive,
  defineApp,
  field,
  heuristicPlanner,
  list,
} from '@plurid/uitive-core';
import type { Perform } from '@plurid/uitive-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startUitive } from './index.js';

const store = defineApp({
  id: 'store',
  description: 'A store',
  actions: {
    'order.cancel': action({
      label: 'Cancel order',
      description: 'Cancels the order and refunds the customer',
      params: z.object({
        order: z.string(),
        reason: field.enum(['duplicate', 'requested_by_customer']),
      }),
      effect: 'destructive',
    }),
    'note.add': action({
      label: 'Add note',
      description: 'Adds a note to the order',
      params: z.object({ text: z.string() }),
      effect: 'write',
    }),
    print: action({ label: 'Print', description: 'Prints the order' }),
  },
  surfaces: {
    tools: list({
      label: 'Tools',
      description: 'The order’s toolbar',
      items: ['note.add', 'print'],
      capacity: 2,
    }),
  },
});

function setup() {
  const runs: unknown[] = [];
  const recorder: Perform = (params) => {
    runs.push(params);
  };
  const client = createUitive({
    contract: store,
    bindings: { perform: { 'order.cancel': recorder, 'note.add': recorder, print: recorder } },
  });
  const stop = startUitive(client);
  stops.push(stop);
  return { client, runs, stop };
}

function dialog() {
  const element = document.createElement('uitive-confirm');
  document.body.append(element);
  const root = element.shadowRoot?.querySelector('[part="content"]') as HTMLElement;
  return { element, root };
}

const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  document.body.replaceChildren();
});

describe('<uitive-confirm>', () => {
  it('asks before a destructive action, with what it does to what, and the phrase to type', async () => {
    const { client, runs } = setup();
    const { root } = dialog();
    const running = client.perform('order.cancel', { order: 'order_1', reason: 'duplicate' });
    await Promise.resolve();
    expect(root.querySelector('h2')?.textContent).toBe('Cancel order');
    const terms = [...(root.querySelectorAll('dt, dd') ?? [])].map((entry) => entry.textContent);
    expect(terms).toEqual(['Order', 'order_1', 'Reason', 'Duplicate']);
    const submit = root.querySelector('button[type="submit"]') as HTMLButtonElement;
    const input = root.querySelector('input[name="phrase"]') as HTMLInputElement;
    expect(submit.disabled).toBe(true);
    expect(submit.className).toBe('danger');
    type(input, 'wrong');
    expect(submit.disabled).toBe(true);
    type(input, ` ${client.getSnapshot().confirmation?.phrase?.toUpperCase()} `);
    expect(submit.disabled).toBe(false);
    root
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect((await running).status).toBe('done');
    expect(runs).toEqual([{ order: 'order_1', reason: 'duplicate' }]);
    expect(root.textContent?.trim()).toBe('');
  });

  it('cancels on Escape, and without it in the page, actions with effects are refused', async () => {
    const { client, runs } = setup();
    const { element, root } = dialog();
    const running = client.perform('note.add', { text: 'Called the customer' });
    await Promise.resolve();
    expect(root.querySelector('input')).toBeNull();
    expect((root.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect((await running).status).toBe('canceled');
    element.remove();
    expect((await client.perform('note.add', { text: 'Again' })).status).toBe('refused');
    expect(runs).toEqual([]);
  });
});

describe('<uitive-confirm> money and focus', () => {
  it('shows money in its own currency and units, in a modal that gives focus back', async () => {
    const shop = defineApp({
      id: 'shop',
      description: 'A shop',
      actions: {
        refund: action({
          label: 'Refund',
          description: 'Returns money',
          params: z.object({
            amount: field.money({ currency: 'currency', minor: true }),
            currency: z.string(),
          }),
          effect: 'write',
        }),
      },
      surfaces: {},
    });
    const client = createUitive({ contract: shop, bindings: { perform: { refund: () => {} } } });
    stops.push(startUitive(client));
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { element, root } = dialog();
    const running = client.perform('refund', { amount: 5000, currency: 'jpy' });
    await Promise.resolve();
    const yen = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'JPY' });
    expect(root.querySelector('dd')?.textContent).toBe(yen.format(5000));
    const modal = root.querySelector('dialog') as HTMLDialogElement;
    expect(modal.open).toBe(true);
    expect(element.shadowRoot?.activeElement).toBe(root.querySelector('button[type="submit"]'));
    modal.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect((await running).status).toBe('canceled');
    expect(root.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('startUitive', () => {
  it('gives elements rendered later the client, saves usage when hidden, and undoes it all', () => {
    const { client, stop } = setup();
    const flush = vi.spyOn(client, 'flush');
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div data-uitive-list="tools"><button data-uitive-item="note.add">Add note</button><button data-uitive-item="print">Print</button><uitive-more list="tools"></uitive-more></div>`,
    );
    const more = document.querySelector('uitive-more');
    expect(more?.client).toBe(client);
    client.hide('tools', 'print');
    const content = more?.shadowRoot?.querySelector('[part="content"]');
    expect(content?.querySelector('button')?.textContent).toBe('More');
    window.dispatchEvent(new Event('pagehide'));
    expect(flush).toHaveBeenCalled();
    stop();
    expect(more?.client).toBeUndefined();
    expect(content?.textContent?.trim()).toBe('');
  });

  it('plans each session from use once', async () => {
    let time = 0;
    const plan = vi.fn(heuristicPlanner().plan);
    const client = createUitive({
      contract: store,
      now: () => time,
      planner: { name: 'test', plan },
    });
    stops.push(startUitive(client));
    await Promise.resolve();
    expect(plan).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(plan).toHaveBeenCalledOnce();
    time += 31 * 60_000;
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(plan).toHaveBeenCalledTimes(2);
  });
});
