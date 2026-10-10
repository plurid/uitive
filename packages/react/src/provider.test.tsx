/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { action, createUitive, defineApp, field } from '@plurid/uitive-core';
import { sources } from '../../core/src/__fixtures__/payments.js';
import { Confirmations, UitiveBanner, UitiveProvider } from './provider.js';

afterEach(cleanup);

const shop = defineApp({
  id: 'shop',
  description: 'A shop',
  actions: {
    refund: action({
      label: 'Refund',
      description: 'Returns money',
      params: z.object({
        payment: field.ref('payments'),
        amount: field.money({ currency: 'currency', minor: true }),
        currency: z.string(),
      }),
      effect: 'destructive',
    }),
  },
  sources: { payments: sources.payments, customers: sources.customers },
  surfaces: {},
});

describe('<Confirmations />', () => {
  it('shows money in its own currency and units, and confirms on Enter', async () => {
    const runs: unknown[] = [];
    const client = createUitive({
      contract: shop,
      bindings: { perform: { refund: (params) => void runs.push(params) } },
    });
    render(
      <UitiveProvider client={client}>
        <Confirmations />
      </UitiveProvider>,
    );
    let running: Promise<{ status: string }> | undefined;
    await act(async () => {
      running = client.perform('refund', { payment: 'ch_1', amount: 5000, currency: 'jpy' });
    });
    const dialog = screen.getByRole('dialog', { name: 'Refund' });
    const yen = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'JPY' });
    expect(within(dialog).getByText(yen.format(5000))).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Type "Refund" to confirm'), {
      target: { value: 'refund' },
    });
    await act(async () => {
      fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    });
    expect((await running)?.status).toBe('done');
    expect(runs).toEqual([{ payment: 'ch_1', amount: 5000, currency: 'jpy' }]);
  });
});

describe('UitiveProvider', () => {
  it('puts the nonce of a strict style policy on the kit’s styles', () => {
    const client = createUitive({ contract: shop });
    const html = renderToString(<UitiveProvider client={client} nonce="r4nd0m" />);
    expect(html).toMatch(/^<style nonce="r4nd0m">/);
  });
});

describe('the meta-interface wrappers', () => {
  it('set flags and the class as React 19 would, whatever React renders them', () => {
    const client = createUitive({ contract: shop });
    const view = render(<UitiveBanner client={client} docked={false} className="toast" />);
    const element = view.container.querySelector('uitive-banner') as HTMLElement;
    expect(element.hasAttribute('docked')).toBe(false);
    expect(element.getAttribute('class')).toBe('toast');
    expect(element.hasAttribute('classname')).toBe(false);
    view.rerender(<UitiveBanner client={client} docked />);
    expect(element.hasAttribute('docked')).toBe(true);
    expect(element.hasAttribute('class')).toBe(false);
  });
});
