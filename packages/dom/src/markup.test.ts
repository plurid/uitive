// @vitest-environment happy-dom
import { action, createUitive, defineApp, list } from '@plurid/uitive-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptMarkup, defineElements, orders } from './index.js';

defineElements();

const sheet = defineApp({
  id: 'sheet',
  description: 'A spreadsheet',
  actions: {
    'add-table': action({ label: 'Add empty table', description: 'Adds a table' }),
    'add-page': action({ label: 'Add page', description: 'Adds a page' }),
    'add-widget': action({ label: 'Add widget', description: 'Adds a widget to a page' }),
    import: action({ label: 'Import from file', description: 'Imports a file as a table' }),
    sort: action({ label: 'Sort', description: 'Sorts the table' }),
    filter: action({ label: 'Filter', description: 'Filters the table' }),
    search: action({ label: 'Search', description: 'Searches the table' }),
  },
  surfaces: {
    addNew: list({
      label: 'Add new',
      description: 'The Add new menu',
      items: ['add-table', 'add-page', 'add-widget', 'import'],
      capacity: 4,
    }),
    tools: list({
      label: 'Tools',
      description: 'The toolbar above the table',
      items: ['sort', 'filter', 'search'],
      capacity: 3,
      reorderable: true,
    }),
  },
});

const client = () => createUitive({ contract: sheet });

// happy-dom doesn't restyle elements when an adopted stylesheet changes, so this asks the rules.
const hidden = (element: Element | null) => {
  if (!element) throw new Error('No such element');
  return [...document.adoptedStyleSheets, ...[...document.styleSheets]].some((sheet) =>
    [...sheet.cssRules].some(
      (rule) =>
        'selectorText' in rule &&
        (rule as CSSStyleRule).style.display === 'none' &&
        element.matches((rule as CSSStyleRule).selectorText),
    ),
  );
};

function menu() {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="menu" data-uitive-list="addNew">
      <button data-uitive-item="add-table">Add empty table</button>
      <button data-uitive-item="add-page">Add page</button>
      <button data-uitive-item="add-widget">Add widget</button>
      <button data-uitive-item="import">Import from file</button>
    </div>`,
  );
  return document.body.lastElementChild as HTMLElement;
}

function toolbar() {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="toolbar" style="display: flex" data-uitive-list="tools">
      <span class="logo">Logo</span>
      <button data-uitive-item="sort">Sort</button>
      <span class="separator"></span>
      <button data-uitive-item="filter">Filter</button>
      <button data-uitive-item="search">Search</button>
      <uitive-more list="tools"></uitive-more>
    </div>`,
  );
  return document.body.lastElementChild as HTMLElement;
}

const order = (container: Element) =>
  [...container.children]
    .map((child) => [Number(child.getAttribute('data-uitive-order') ?? 0), child] as const)
    .sort(([a], [b]) => a - b)
    .map(
      ([, child]) => child.getAttribute('data-uitive-item') ?? child.className ?? child.localName,
    )
    .map((name) => name || 'uitive-more');

let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  document.body.replaceChildren();
});

describe('adaptMarkup', () => {
  it('leaves markup alone for someone who changes nothing', () => {
    const container = toolbar();
    const uitive = client();
    stops.push(adaptMarkup(uitive));
    expect(hidden(container.querySelector('[data-uitive-item="sort"]'))).toBe(false);
    expect(container.querySelector('[data-uitive-order]')).toBeNull();
  });

  it('hides an item the person moved out, in markup rendered later too, and brings it back', () => {
    const uitive = client();
    stops.push(adaptMarkup(uitive));
    uitive.hide('addNew', 'import');
    // A menu rendered only when opened, after the change.
    const opened = menu();
    expect(getComputedStyle(opened.querySelector('[data-uitive-item="import"]')!).display).toBe(
      'none',
    );
    expect(hidden(opened.querySelector('[data-uitive-item="add-page"]'))).toBe(false);
    uitive.reset();
    expect(hidden(opened.querySelector('[data-uitive-item="import"]'))).toBe(false);
  });

  it('orders a reordered list by CSS, keeping what isn’t an item where it was', () => {
    const container = toolbar();
    const uitive = client();
    stops.push(adaptMarkup(uitive));
    uitive.move('tools', 'search', 0);
    expect(order(container)).toEqual([
      'logo',
      'search',
      'sort',
      'separator',
      'filter',
      'uitive-more',
    ]);
    uitive.reset();
    expect(container.querySelector('[data-uitive-order]')).toBeNull();
  });

  it('orders children added later, and says when a container can’t be ordered', async () => {
    const onProblem = vi.fn();
    const uitive = client();
    stops.push(adaptMarkup(uitive, { onProblem }));
    uitive.move('tools', 'search', 0);
    const container = toolbar();
    await Promise.resolve();
    expect(order(container)).toEqual([
      'logo',
      'search',
      'sort',
      'separator',
      'filter',
      'uitive-more',
    ]);
    container.style.display = 'block';
    uitive.move('tools', 'filter', 0);
    expect(onProblem).toHaveBeenCalledWith(
      'the list "tools" can\'t be reordered: its container isn\'t a flex or grid box',
    );
  });

  it('records usage from the application’s own controls', () => {
    const container = menu();
    const uitive = client();
    stops.push(adaptMarkup(uitive));
    container.querySelector<HTMLElement>('[data-uitive-item="add-page"]')?.click();
    expect(uitive.events().map((event) => [event.action, event.via, event.surface])).toEqual([
      ['add-page', 'region', 'addNew'],
    ]);
  });

  it('undoes everything when stopped', () => {
    const container = toolbar();
    const uitive = client();
    const stop = adaptMarkup(uitive);
    uitive.hide('tools', 'filter');
    uitive.move('tools', 'search', 0);
    stop();
    expect(hidden(container.querySelector('[data-uitive-item="filter"]'))).toBe(false);
    expect(container.querySelector('[data-uitive-order]')).toBeNull();
    container.querySelector<HTMLElement>('[data-uitive-item="sort"]')?.click();
    expect(uitive.events()).toEqual([]);
  });
});

describe('<uitive-more>', () => {
  it('offers what moved out, and runs the hidden original once, recorded as overflow', () => {
    const container = toolbar();
    const uitive = client();
    stops.push(adaptMarkup(uitive));
    const more = container.querySelector('uitive-more');
    if (!more) throw new Error('No uitive-more');
    more.client = uitive;
    const root = () => more.shadowRoot?.querySelector('[part="content"]') as HTMLElement;
    expect(root().textContent?.trim()).toBe('');
    uitive.hide('tools', 'filter');
    root().querySelector<HTMLElement>('[data-act="toggle"]')?.click();
    const items = [...root().querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(['Filter']);
    const ran = vi.fn();
    container.querySelector('[data-uitive-item="filter"]')?.addEventListener('click', ran);
    (items[0] as HTMLElement).click();
    expect(ran).toHaveBeenCalledTimes(1);
    expect(uitive.events().map((event) => [event.action, event.via])).toEqual([
      ['filter', 'overflow'],
    ]);
    expect(root().querySelector('[role="menu"]')).toBeNull();
  });
});

describe('<uitive-ask>', () => {
  it('runs a plain command and says what happened', async () => {
    const container = menu();
    const uitive = client();
    stops.push(adaptMarkup(uitive));
    const ask = document.createElement('uitive-ask');
    document.body.append(ask);
    ask.client = uitive;
    const root = ask.shadowRoot?.querySelector('[part="content"]') as HTMLElement;
    const asked = new Promise<CustomEvent>((resolve) =>
      ask.addEventListener('uitive-asked', (event) => resolve(event as CustomEvent), {
        once: true,
      }),
    );
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'hide Import from file';
    root
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const event = await asked;
    expect(event.detail.adaptation.status).toBe('done');
    expect(root.querySelector('.status')?.textContent).toBe('Done');
    expect((root.querySelector('input') as HTMLInputElement).value).toBe('');
    expect(hidden(container.querySelector('[data-uitive-item="import"]'))).toBe(true);
  });
});

describe('orders', () => {
  it('keeps leading and trailing children in place, and others after their item', () => {
    // logo, C, separator, A, B, More: C moves after A and B.
    expect(orders([-1, 2, -1, 0, 1, -1])).toEqual([-1000, 200, 201, 0, 100, 1_000_005]);
    expect(orders([-1, -1])).toEqual([0, 0]);
  });
});
