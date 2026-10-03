// @vitest-environment happy-dom
import { action, createAptuitive, defineApp, list } from '@plurid/aptuitive-core';
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

const client = () => createAptuitive({ contract: sheet });

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
    `<div class="menu" data-apt-list="addNew">
      <button data-apt-item="add-table">Add empty table</button>
      <button data-apt-item="add-page">Add page</button>
      <button data-apt-item="add-widget">Add widget</button>
      <button data-apt-item="import">Import from file</button>
    </div>`,
  );
  return document.body.lastElementChild as HTMLElement;
}

function toolbar() {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="toolbar" style="display: flex" data-apt-list="tools">
      <span class="logo">Logo</span>
      <button data-apt-item="sort">Sort</button>
      <span class="separator"></span>
      <button data-apt-item="filter">Filter</button>
      <button data-apt-item="search">Search</button>
      <apt-more list="tools"></apt-more>
    </div>`,
  );
  return document.body.lastElementChild as HTMLElement;
}

const order = (container: Element) =>
  [...container.children]
    .map((child) => [Number(child.getAttribute('data-apt-order') ?? 0), child] as const)
    .sort(([a], [b]) => a - b)
    .map(([, child]) => child.getAttribute('data-apt-item') ?? child.className ?? child.localName)
    .map((name) => name || 'apt-more');

let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  document.body.replaceChildren();
});

describe('adaptMarkup', () => {
  it('leaves markup alone for someone who changes nothing', () => {
    const container = toolbar();
    const aptuitive = client();
    stops.push(adaptMarkup(aptuitive));
    expect(hidden(container.querySelector('[data-apt-item="sort"]'))).toBe(false);
    expect(container.querySelector('[data-apt-order]')).toBeNull();
  });

  it('hides an item the person moved out, in markup rendered later too, and brings it back', () => {
    const aptuitive = client();
    stops.push(adaptMarkup(aptuitive));
    aptuitive.hide('addNew', 'import');
    // A menu rendered only when opened, after the change.
    const opened = menu();
    expect(getComputedStyle(opened.querySelector('[data-apt-item="import"]')!).display).toBe(
      'none',
    );
    expect(hidden(opened.querySelector('[data-apt-item="add-page"]'))).toBe(false);
    aptuitive.reset();
    expect(hidden(opened.querySelector('[data-apt-item="import"]'))).toBe(false);
  });

  it('orders a reordered list by CSS, keeping what isn’t an item where it was', () => {
    const container = toolbar();
    const aptuitive = client();
    stops.push(adaptMarkup(aptuitive));
    aptuitive.move('tools', 'search', 0);
    expect(order(container)).toEqual(['logo', 'search', 'sort', 'separator', 'filter', 'apt-more']);
    aptuitive.reset();
    expect(container.querySelector('[data-apt-order]')).toBeNull();
  });

  it('orders children added later, and says when a container can’t be ordered', async () => {
    const onProblem = vi.fn();
    const aptuitive = client();
    stops.push(adaptMarkup(aptuitive, { onProblem }));
    aptuitive.move('tools', 'search', 0);
    const container = toolbar();
    await Promise.resolve();
    expect(order(container)).toEqual(['logo', 'search', 'sort', 'separator', 'filter', 'apt-more']);
    container.style.display = 'block';
    aptuitive.move('tools', 'filter', 0);
    expect(onProblem).toHaveBeenCalledWith(
      'the list "tools" can\'t be reordered: its container isn\'t a flex or grid box',
    );
  });

  it('records usage from the application’s own controls', () => {
    const container = menu();
    const aptuitive = client();
    stops.push(adaptMarkup(aptuitive));
    container.querySelector<HTMLElement>('[data-apt-item="add-page"]')?.click();
    expect(aptuitive.events().map((event) => [event.action, event.via, event.surface])).toEqual([
      ['add-page', 'region', 'addNew'],
    ]);
  });

  it('undoes everything when stopped', () => {
    const container = toolbar();
    const aptuitive = client();
    const stop = adaptMarkup(aptuitive);
    aptuitive.hide('tools', 'filter');
    aptuitive.move('tools', 'search', 0);
    stop();
    expect(hidden(container.querySelector('[data-apt-item="filter"]'))).toBe(false);
    expect(container.querySelector('[data-apt-order]')).toBeNull();
    container.querySelector<HTMLElement>('[data-apt-item="sort"]')?.click();
    expect(aptuitive.events()).toEqual([]);
  });
});

describe('<apt-more>', () => {
  it('offers what moved out, and runs the hidden original once, recorded as overflow', () => {
    const container = toolbar();
    const aptuitive = client();
    stops.push(adaptMarkup(aptuitive));
    const more = container.querySelector('apt-more');
    if (!more) throw new Error('No apt-more');
    more.client = aptuitive;
    const root = () => more.shadowRoot?.querySelector('[part="content"]') as HTMLElement;
    expect(root().textContent?.trim()).toBe('');
    aptuitive.hide('tools', 'filter');
    root().querySelector<HTMLElement>('[data-act="toggle"]')?.click();
    const items = [...root().querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(['Filter']);
    const ran = vi.fn();
    container.querySelector('[data-apt-item="filter"]')?.addEventListener('click', ran);
    (items[0] as HTMLElement).click();
    expect(ran).toHaveBeenCalledTimes(1);
    expect(aptuitive.events().map((event) => [event.action, event.via])).toEqual([
      ['filter', 'overflow'],
    ]);
    expect(root().querySelector('[role="menu"]')).toBeNull();
  });
});

describe('<apt-ask>', () => {
  it('runs a plain command and says what happened', async () => {
    const container = menu();
    const aptuitive = client();
    stops.push(adaptMarkup(aptuitive));
    const ask = document.createElement('apt-ask');
    document.body.append(ask);
    ask.client = aptuitive;
    const root = ask.shadowRoot?.querySelector('[part="content"]') as HTMLElement;
    const asked = new Promise<CustomEvent>((resolve) =>
      ask.addEventListener('apt-asked', (event) => resolve(event as CustomEvent), { once: true }),
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
    expect(hidden(container.querySelector('[data-apt-item="import"]'))).toBe(true);
  });
});

describe('orders', () => {
  it('keeps leading and trailing children in place, and others after their item', () => {
    // logo, C, separator, A, B, More: C moves after A and B.
    expect(orders([-1, 2, -1, 0, 1, -1])).toEqual([-1000, 200, 201, 0, 100, 1_000_005]);
    expect(orders([-1, -1])).toEqual([0, 0]);
  });
});
