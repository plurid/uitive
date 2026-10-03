import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAriaSnapshot, textOf } from './aria.js';
import { discoverApp, factsOf, matchAction, templateOf } from './discover.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../../tools/fixtures/aria/${name}.yml`, import.meta.url), 'utf8');
const page = (name: string, url: string) => factsOf(parseAriaSnapshot(fixture(name)), url);

describe('parseAriaSnapshot', () => {
  it('reads roles, names, flags, inline text, properties and nesting', () => {
    const [banner, nav] = parseAriaSnapshot(
      [
        '- banner:',
        '  - heading "Say \\"hi\\"" [level=1]',
        '  - textbox "Search":',
        '    - /placeholder: "Find anything"',
        '  - radio "Yours" [checked]',
        '  - paragraph: Plain words here',
        '  - strong: "10"',
        '- navigation "Main":',
        '  - link "Orders":',
        '    - /url: /app/orders',
        '  - cell',
      ].join('\n'),
    );
    expect(banner?.children.map((node) => node.role)).toEqual([
      'heading',
      'textbox',
      'radio',
      'paragraph',
      'strong',
    ]);
    expect(banner?.children[0]).toMatchObject({ name: 'Say "hi"', attributes: { level: '1' } });
    expect(banner?.children[1]?.properties).toEqual({ placeholder: 'Find anything' });
    expect(banner?.children[2]?.attributes).toEqual({ checked: 'true' });
    expect(banner?.children[3]?.text).toBe('Plain words here');
    expect(banner?.children[4]?.text).toBe('10');
    expect(nav?.children[0]).toMatchObject({ role: 'link', properties: { url: '/app/orders' } });
    expect(nav?.children[1]).toMatchObject({ role: 'cell', name: '', children: [] });
    expect(textOf(banner?.children[3] ?? nav!)).toBe('Plain words here');
  });
});

describe('factsOf', () => {
  it('reads a real page: its title, toolbar, table and navigation', () => {
    const facts = page('console-service', 'http://localhost:5171/');
    expect(facts.title).toBe('Container service');
    expect(facts.toolbars).toEqual([
      {
        name: '',
        landmark: 'main',
        items: ['Create', 'Deploy', 'Start', 'Stop', 'Restart', 'Scale'],
      },
    ]);
    expect(facts.tables).toEqual([
      {
        name: '',
        columns: ['Id', 'State', 'Region', 'Last change', 'Actions'],
        rowActions: ['Stop resource', 'Start resource'],
      },
    ]);
    expect(facts.navigation.map((nav) => nav.name)).toEqual(['Services', 'Breadcrumb']);
    expect(facts.navigation[0]?.items.length).toBeGreaterThan(100);
    // Row content is never read: no cell text appears among buttons or links.
    expect(JSON.stringify(facts)).not.toContain('containers-877');
  });
});

describe('templateOf', () => {
  it('collapses row keys in paths', () => {
    expect(templateOf('/app/orders/order_01J9ZK2V7Q8N4X3C5B6M1A0P9R')).toBe('/app/orders/:id');
    expect(templateOf('/projects/42/issues/1093')).toBe('/projects/:project/issues/:issue');
    expect(templateOf('/settings/regions')).toBe('/settings/regions');
    expect(templateOf('/c/0e4f8a52-1f0c-4a3e-9d7b-2f9d1c0b7a61')).toBe('/c/:id');
    // Ids that mix letters and digits, as a spreadsheet's documents and their slugs.
    expect(templateOf('/o/docs/6Arp2j6Nig9e/p/12')).toBe('/o/docs/:doc/p/:p');
    expect(templateOf('/6-arp2j6-nig9e.project-tracker')).toBe('/:id');
    expect(templateOf('/auth/oauth2-callback')).toBe('/auth/oauth2-callback');
  });
});

describe('matchAction', () => {
  it('matches a button only when the action explains every word of it', () => {
    const fulfil = { id: 'orders.fulfillments.create', label: 'Create an order fulfillment' };
    expect(matchAction('Create fulfillment', fulfil, ['orders'])).toBeGreaterThan(0);
    expect(matchAction('Create draft order', fulfil, ['orders'])).toBe(0);
    expect(
      matchAction('Add customer', { id: 'customers.create', label: 'Create a customer' }),
    ).toBe(1);
    expect(matchAction('Hand (panning tool)', { id: 'tool.hand', label: 'Hand' })).toBe(1);
    // Words the page supplies count half.
    expect(
      matchAction('Archive', { id: 'orders.archive', label: 'Archive an order' }, ['orders']),
    ).toBeCloseTo(2 / 3);
    expect(matchAction('Refund', { id: 'payments.refund', label: 'Refund payment' })).toBe(0.5);
  });

  it('needs the page to say what a generic verb acts on, and never reads a dismissal as an action', () => {
    const create = { id: 'customers.create', label: 'Create a customer' };
    expect(matchAction('Create', create)).toBe(0);
    expect(matchAction('Created', create, ['products'])).toBe(0);
    expect(matchAction('Create', create, ['customers'])).toBeCloseTo(2 / 3);
    const cancel = { id: 'orders.cancel', label: 'Cancel order' };
    expect(matchAction('Cancel', cancel, ['orders'])).toBe(0);
    expect(matchAction('Cancel order', cancel)).toBe(1);
  });
});

describe('factsOf', () => {
  it('leaves dialogs and sorting out, cleans names, and marks what opens a menu', () => {
    const facts = factsOf(
      parseAriaSnapshot(
        [
          '- navigation "Main":',
          '  - link "Orders":',
          '    - /url: /orders',
          '  - link "Orders":',
          '    - /url: /orders',
          '  - button "Search \u2318K"',
          '  - button "Accessibility F4"',
          '- main:',
          '  - button "Add new" [expanded=false]',
          '  - button "Export"',
          '  - table "Orders":',
          '    - row:',
          '      - columnheader "Created":',
          '        - button "Created"',
          '    - row:',
          '      - cell:',
          '        - button "Refund"',
          '  - dialog "Export orders":',
          '    - button "Cancel"',
          '    - button "Export"',
          '    - button "Back"',
        ].join('\n'),
      ),
      'http://localhost/orders',
    );
    expect(facts.navigation[0]?.items.map((item) => item.name)).toEqual([
      'Orders',
      'Search',
      'Accessibility',
    ]);
    expect(facts.buttons).toEqual([
      { name: 'Add new', landmark: 'main', opens: true },
      { name: 'Export', landmark: 'main' },
    ]);
    expect(facts.tables[0]?.rowActions).toEqual(['Refund']);
    expect(facts.toolbars).toEqual([]);
  });
});

describe('discoverApp', () => {
  const pages = [
    page('shop-orders', 'http://localhost:9000/app/orders'),
    page('shop-order-1042', 'http://localhost:9000/app/orders/order_01J9ZK2V7Q8N4X3C5B6M1A0P9R'),
    page('shop-order-1041', 'http://localhost:9000/app/orders/order_01J9ZK1T5R7M3W2B4A5N0Z8Q7P'),
    page('shop-customers', 'http://localhost:9000/app/customers'),
  ];
  const label = (id: string, text: string) => [id, { label: text, description: '' }] as const;
  const actions = Object.fromEntries([
    label('orders.export', 'Export orders'),
    label('orders.cancel', 'Cancel order'),
    label('orders.archive', 'Archive an order'),
    label('orders.fulfillments.create', 'Create an order fulfillment'),
    label('payments.capture', 'Capture payment'),
    label('payments.refund', 'Refund payment'),
    label('products.archive', 'Archive a product'),
    label('customers.create', 'Create a customer'),
    label('customers.delete', 'Delete a customer'),
  ]);
  const discovery = discoverApp(pages, {
    actions,
    actionIds: Object.keys(actions),
    sourceIds: ['orders', 'customers', 'products', 'payments'],
  });

  it('proposes routes without the shared base path, with entities for row pages', () => {
    expect(discovery.routes).toEqual([
      { id: 'orders', path: '/app/orders', examples: ['/app/orders'], title: 'Orders' },
      {
        id: 'orders.detail',
        path: '/app/orders/:id',
        examples: [
          '/app/orders/order_01J9ZK2V7Q8N4X3C5B6M1A0P9R',
          '/app/orders/order_01J9ZK1T5R7M3W2B4A5N0Z8Q7P',
        ],
        // Titled by its path: the page's heading names one row, such as "Order #1042".
        title: 'Order',
        entity: 'orders',
        key: 'id',
      },
      { id: 'customers', path: '/app/customers', examples: ['/app/customers'], title: 'Customers' },
    ]);
    expect(discovery.regions[1]).toEqual({
      name: 'orders.detail',
      label: 'Order',
      description: 'The Order page as it is',
      route: 'orders.detail',
      entity: 'orders',
    });
  });

  it('proposes lists from navigation and toolbars, once each', () => {
    expect(discovery.lists).toEqual([
      {
        name: 'main',
        label: 'Main',
        route: null,
        items: ['Orders', 'Products', 'Customers', 'Settings'],
      },
      {
        name: 'ordersOrderActions',
        label: 'Order actions',
        route: 'orders',
        items: ['Export', 'Create draft order'],
      },
      {
        name: 'ordersDetailToolbar',
        label: 'Order toolbar',
        route: 'orders.detail',
        items: ['Cancel order', 'Archive', 'Create fulfillment'],
      },
    ]);
  });

  it('matches buttons to actions in the context of their page', () => {
    expect(
      discovery.actions.map((entry) => `${entry.route}: ${entry.button} -> ${entry.action}`),
    ).toEqual([
      'orders: Export -> orders.export',
      'orders.detail: Cancel order -> orders.cancel',
      'orders.detail: Archive -> orders.archive',
      'orders.detail: Create fulfillment -> orders.fulfillments.create',
      'orders.detail: Capture payment -> payments.capture',
      'orders.detail: Refund -> payments.refund',
      'customers: Add customer -> customers.create',
      'customers: Delete -> customers.delete',
    ]);
    expect(discovery.unmapped).toEqual([{ route: 'orders', buttons: ['Create draft order'] }]);
  });

  it('keeps one navigation list when pages show it a little differently', () => {
    const nav = (items: string[]) =>
      factsOf(
        parseAriaSnapshot(
          ['- navigation "Main":', ...items.map((item) => `  - link "${item}"`)].join('\n'),
        ),
        `http://localhost/${items.length}`,
      );
    const merged = discoverApp([
      nav(['Orders', 'Products', 'Customers']),
      nav(['Orders', 'Products', 'Customers', 'Settings']),
    ]);
    expect(merged.lists).toEqual([
      {
        name: 'main',
        label: 'Main',
        route: null,
        items: ['Orders', 'Products', 'Customers', 'Settings'],
      },
    ]);
  });
});
