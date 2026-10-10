/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultKit, type ChartSeries } from './kit.js';

afterEach(cleanup);

const { Chart, Dialog, Tabs } = defaultKit;

const titles = (container: HTMLElement) =>
  [...container.querySelectorAll('svg title')].map((node) => node.textContent);

describe('the default chart', () => {
  it('keeps apart buckets that share a label, in time order', () => {
    const hours = [1, 0].flatMap((day) =>
      [10, 9].map((hour) => ({
        x: Date.UTC(2026, 9, 1 + day, hour),
        label: `${hour}:00`,
        y: day === 0 ? 1 : 100,
      })),
    );
    const { container } = render(<Chart kind="bar" series={[{ name: '', points: hours }]} />);
    expect(container.querySelectorAll('rect')).toHaveLength(4);
    expect(titles(container)).toEqual(['9:00: 1', '10:00: 1', '9:00: 100', '10:00: 100']);
  });

  it('never stacks or totals amounts in different currencies', () => {
    const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
    const series: ChartSeries[] = [
      { name: 'usd', points: [{ x: 'a', label: 'A', y: 10, currency: 'usd' }] },
      { name: 'jpy', points: [{ x: 'a', label: 'A', y: 5000, currency: 'jpy' }] },
    ];
    const { container } = render(<Chart kind="bar" series={series} stacked />);
    const [dollars, yen] = [...container.querySelectorAll('rect')];
    // Side by side, each from the axis, rather than one on top of the other.
    expect(dollars?.getAttribute('x')).not.toBe(yen?.getAttribute('x'));
    expect(Number(dollars?.getAttribute('y')) + Number(dollars?.getAttribute('height'))).toBe(
      Number(yen?.getAttribute('y')) + Number(yen?.getAttribute('height')),
    );
    expect(titles(container)[0]).toBe(`usd, A: ${money.format(10)}`);

    const pie = render(
      <Chart
        kind="pie"
        series={[
          {
            name: '',
            points: [
              { x: 'usd', label: 'usd', y: 10, currency: 'usd' },
              { x: 'jpy', label: 'jpy', y: 5000, currency: 'jpy' },
            ],
          },
        ]}
      />,
    );
    expect(pie.container.querySelector('[data-kind="pie"]')).toBeNull();
    expect(pie.container.querySelectorAll('rect')).toHaveLength(2);
  });

  it('offers its figures as a table, for assistive technology', () => {
    render(
      <Chart
        kind="line"
        label="Revenue"
        series={[{ name: 'Paid', points: [{ x: 1, label: 'Oct 1', y: 1200, currency: 'eur' }] }]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Revenue' });
    expect(table.className).toBe('uitive-hidden');
    expect(screen.getByRole('columnheader', { name: 'Paid' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Oct 1' })).toBeTruthy();
    const euros = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' });
    expect(screen.getByRole('cell', { name: euros.format(1200) })).toBeTruthy();
  });
});

describe('the default tabs', () => {
  it('move with the arrow keys, keeping one tab stop for the list', () => {
    render(
      <Tabs
        label="Views"
        tabs={[
          { id: 'a', title: 'First', content: 'One' },
          { id: 'b', title: 'Second', content: 'Two' },
          { id: 'c', title: 'Third', content: 'Three' },
        ]}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    const panel = screen.getByRole('tabpanel');
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel').textContent).toBe('Two');
    expect(document.activeElement).toBe(screen.getAllByRole('tab')[1]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(screen.getByRole('tabpanel').textContent).toBe('Three');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel').textContent).toBe('One');
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });
});

describe('the default dialog', () => {
  it('opens modal with focus inside, closes on Escape and gives focus back', () => {
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <Dialog
              title="Refund"
              onClose={() => {
                onClose();
                setOpen(false);
              }}
            >
              <input aria-label="Reason" />
            </Dialog>
          )}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    act(() => opener.click());
    const dialog = screen.getByRole('dialog', { name: 'Refund' }) as HTMLDialogElement;
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Reason'));
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
