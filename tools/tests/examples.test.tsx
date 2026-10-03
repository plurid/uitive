/** @vitest-environment happy-dom */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { movedOut } from '@plurid/aptuitive-dom';
import { Editor } from '../../docs/examples/quick-start/app.tsx';
import { aptuitive as notes } from '../../docs/examples/quick-start/client.ts';
import { Admin } from '../../docs/examples/shop/admin.tsx';
import { aptuitive as shop } from '../../docs/examples/shop/client.ts';
import { redesignOrders } from '../../docs/examples/shop/redesign.ts';

// happy-dom replaces URL, so paths are built from this file's own.
const examples = join(dirname(fileURLToPath(import.meta.url)), '../../docs/examples');
const example = (path: string) => readFileSync(join(examples, path), 'utf8');

beforeEach(() => {
  localStorage.clear();
  notes.clearData();
  shop.clearData();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the quick start', () => {
  const toolbar = () =>
    [...screen.getByRole('toolbar').querySelectorAll(':scope > button:not([aria-expanded])')].map(
      (button) => button.textContent,
    );

  it('brings what someone keeps reaching for in More onto the toolbar', async () => {
    render(<Editor run={() => {}} />);
    expect(toolbar()).toEqual(['Bold', 'Italic', 'Link', 'Heading', 'Share']);
    for (let session = 0; session < 3; session++) {
      for (let use = 0; use < 2; use++) {
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Table' }));
      }
      act(() => {
        notes.nextSession();
      });
    }
    await act(async () => {
      await notes.plan();
    });
    expect(toolbar()).not.toContain('Table');
    act(() => {
      notes.nextSession();
    });
    expect(toolbar()).toContain('Table');
    expect(toolbar()).toContain('Share');
  });

  it('changes when asked, and says what changed', async () => {
    render(<Editor run={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask for a change' }), {
      target: { value: 'hide Bold' },
    });
    await act(async () => {
      fireEvent.submit(
        screen.getByRole('button', { name: 'Ask' }).closest('form') as HTMLFormElement,
      );
    });
    expect(toolbar()).not.toContain('Bold');
    const banner = document.querySelector('apt-banner');
    expect(banner?.shadowRoot?.textContent).toContain('Bold hidden from Toolbar');
  });
});

describe('without React', () => {
  it('adapts the markup the page already has', async () => {
    document.body.innerHTML = example('without-react/menu.html');
    await import('../../docs/examples/without-react/start.ts');
    const { aptuitive } = await import('../../docs/examples/without-react/client.ts');
    await aptuitive.ask('hide Chart');
    expect(movedOut(aptuitive, 'insert').map((item) => item.id)).toEqual(['chart']);
    // happy-dom doesn't restyle on a stylesheet change, so this asks the rules.
    const chart = document.querySelector('[data-apt-item="chart"]') as Element;
    const rules = document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules]);
    expect(
      rules.some(
        (rule) =>
          'selectorText' in rule &&
          chart.matches((rule as CSSStyleRule).selectorText) &&
          (rule as CSSStyleRule).style.display === 'none',
      ),
    ).toBe(true);
    const more = document.querySelector('apt-more')?.shadowRoot;
    expect(more?.textContent).toContain('More');
  });
});

/** The shop's API as the example bindings call it, over a few orders. */
function shopApi() {
  const customers = [
    { id: 'cus_ada', name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: 'cus_bo', name: 'Bo Diddley', email: 'bo@example.com' },
  ];
  const orders = [41, 42, 43, 44].map((number, index) => ({
    id: `ord_${number}`,
    number,
    total: 20 + index * 15,
    currency: 'eur',
    status: index === 3 ? 'shipped' : 'paid',
    placed: `2026-09-${String(10 + index).padStart(2, '0')}T09:00:00Z`,
    customer: customers[index % 2]?.id,
  }));
  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input), 'https://shop.example');
    if (url.pathname === '/api/customers') return respond({ customers });
    const status = url.searchParams.get('status');
    const rows = orders.filter((order) => !status || status.split(',').includes(order.status));
    return respond({ orders: rows });
  });
}

describe('the shop', () => {
  it('starts as the page it was, then shows a redesign on the shop API, with the mapped kit', async () => {
    vi.stubGlobal('fetch', shopApi());
    render(<Admin />);
    expect(screen.getByText('The orders list the application already has.')).toBeTruthy();
    let redesign: ReturnType<typeof redesignOrders> | undefined;
    act(() => {
      redesign = redesignOrders();
    });
    expect(redesign?.rejected).toEqual([]);
    expect((await screen.findByRole('heading', { name: 'Needs attention' })).className).toBe(
      'page-title',
    );
    const [first] = await screen.findAllByText('Ada Lovelace');
    const row = first?.closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Cancel order' }).className).toBe(
      'button button-danger',
    );
    act(() => {
      shop.revertAdaptation(redesign?.id ?? '');
    });
    expect(screen.getByText('The orders list the application already has.')).toBeTruthy();
  });
});
