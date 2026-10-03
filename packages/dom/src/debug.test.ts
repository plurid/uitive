// @vitest-environment happy-dom
import type { Persona } from '@plurid/aptuitive-core';
import { afterEach, describe, expect, it } from 'vitest';
import { client, notes } from './__fixtures__/notes.js';
import { defineDebugElement } from './debug.js';

defineDebugElement();

function mount(aptuitive = client()) {
  const panel = document.createElement('apt-debug');
  document.body.append(panel);
  panel.client = aptuitive;
  const root = panel.shadowRoot?.querySelector('[part="content"]') as HTMLElement;
  const button = (label: string) =>
    [...root.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === label);
  return { panel, aptuitive, root, button };
}

afterEach(() => document.body.replaceChildren());

const writer: Persona = {
  name: 'Writer',
  description: 'Inserts tables and prints',
  weights: { table: 5, print: 3, bold: 1 },
};

describe('<apt-debug>', () => {
  it('shows usage events as they happen', () => {
    const { aptuitive, root } = mount();
    aptuitive.record('table', { via: 'overflow' });
    expect(root.querySelector('tbody')?.textContent).toContain('table');
    expect(root.querySelector('tbody')?.textContent).toContain('overflow');
  });

  it('shows exactly what a planner would receive', () => {
    const { root, button } = mount();
    button('Request')?.click();
    expect(root.textContent).toContain('Everything a planner receives: all that leaves the device');
    expect(root.querySelector('pre')?.textContent).toContain(notes.hash);
  });

  it('simulates a week as a persona', async () => {
    const { panel, aptuitive, root, button } = mount();
    panel.personas = [writer];
    button('Controls')?.click();
    const done = new Promise((resolve) => panel.addEventListener('apt-simulated', resolve));
    button('Simulate a week as Writer')?.click();
    await done;
    expect(aptuitive.getSnapshot().session).toBe(7);
    expect(root.textContent).toContain('Simulated 7 sessions as Writer');
  });

  it('plans and moves to the next session', async () => {
    const { aptuitive, root, button } = mount();
    button('Controls')?.click();
    button('Next session')?.click();
    await Promise.resolve();
    expect(aptuitive.getSnapshot().session).toBe(1);
    button('Plan now')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('Plan by heuristic');
  });

  it('collapses to a bar', () => {
    const { root, button } = mount();
    button('▾ Aptuitive')?.click();
    expect(root.querySelector('nav')).toBeNull();
    expect(root.textContent).toContain('session 0');
  });
});
