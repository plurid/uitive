// @vitest-environment happy-dom
import {
  action,
  createAptuitive,
  defineApp,
  field,
  heuristicPlanner,
  list,
} from '@plurid/aptuitive-core';
import type { Perform } from '@plurid/aptuitive-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startAptuitive } from './index.js';

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
  const client = createAptuitive({
    contract: store,
    bindings: { perform: { 'order.cancel': recorder, 'note.add': recorder, print: recorder } },
  });
  const stop = startAptuitive(client);
  stops.push(stop);
  return { client, runs, stop };
}

function dialog() {
  const element = document.createElement('apt-confirm');
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

describe('<apt-confirm>', () => {
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
    expect((await running).status).toBe('cancelled');
    element.remove();
    expect((await client.perform('note.add', { text: 'Again' })).status).toBe('refused');
    expect(runs).toEqual([]);
  });
});

describe('startAptuitive', () => {
  it('gives elements rendered later the client, saves usage when hidden, and undoes it all', () => {
    const { client, stop } = setup();
    const flush = vi.spyOn(client, 'flush');
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div data-apt-list="tools"><button data-apt-item="note.add">Add note</button><button data-apt-item="print">Print</button><apt-more list="tools"></apt-more></div>`,
    );
    const more = document.querySelector('apt-more');
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
    const client = createAptuitive({
      contract: store,
      now: () => time,
      planner: { name: 'test', plan },
    });
    stops.push(startAptuitive(client));
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
