import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { payments } from './__fixtures__/payments.js';
import { action, block, defineApp, list, page, type AnyPageSpec } from './contract.js';
import { emptyDefinition } from './definition.js';
import { GENERIC, genericFor } from './generic.js';
import { PageProblem, ui, validatePage, type AnyPage, type Element } from './page.js';
import { check } from './policy.js';
import { query, type Query } from './query.js';
import { summarize } from './usage.js';

const home = payments.surfaces.home as AnyPageSpec;
const paymentPage = payments.surfaces.payment as AnyPageSpec;

const failedRecently = query('payments', {
  fields: [
    'payments.id',
    'payments.amount',
    'payments.status',
    'payments.customer.name',
    'payments.created',
  ],
  filter: [
    { field: 'payments.status', op: 'eq', values: ['failed'] },
    { field: 'payments.created', op: 'gte', values: ['-30d'] },
  ],
  sort: [{ field: 'payments.created', direction: 'desc' }],
});
const customers = query('customers', { fields: ['customers.name', 'customers.email'] });
const lifetime = query('payments', {
  filter: [{ field: 'payments.currency', op: 'eq', values: ['usd'] }],
  aggregate: { measure: 'sum', of: 'payments.amount', by: 'payments.customer' },
});
const failedCount = query('payments', {
  filter: [
    { field: 'payments.status', op: 'eq', values: ['failed'] },
    { field: 'payments.created', op: 'gte', values: ['-7d'] },
  ],
  aggregate: { measure: 'count' },
});
const perDay = query('payments', {
  aggregate: { measure: 'count', by: 'payments.created', bucket: 'day', split: 'payments.status' },
});

/** A page of one section holding the given blocks, with the given queries. */
function pageOf(
  blocks: { block: string; props: unknown }[],
  data: Record<string, Query> = {},
): AnyPage {
  const elements: Element[] = [
    {
      id: 'top',
      block: 'section',
      props: { title: '', layout: 'stack' },
      children: blocks.map((_, index) => `b${index}`),
    },
    ...blocks.map((entry, index) => ({
      id: `b${index}`,
      block: entry.block,
      props: entry.props,
      children: [],
    })),
  ];
  return {
    root: 'top',
    elements,
    data: Object.entries(data).map(([name, q]) => ({ name, query: q })),
  };
}

const problemOf = (
  value: AnyPage,
  spec: AnyPageSpec = home,
  planned = false,
): { rule: string; message: string } | undefined => {
  try {
    validatePage(payments, spec, value, undefined, { planned });
    return undefined;
  } catch (error) {
    if (!(error instanceof PageProblem)) throw error;
    return { rule: error.rule, message: error.message };
  }
};
const messageOf = (value: AnyPage, spec?: AnyPageSpec, planned?: boolean) =>
  problemOf(value, spec, planned)?.message;

const table = (props: Record<string, unknown> = {}) => ({
  block: 'table',
  props: {
    data: 'failed',
    columns: ['payments.id', 'payments.amount', 'payments.customer.name'],
    lookups: [],
    rowActions: [],
    density: 'compact',
    link: 'entity',
    ...props,
  },
});

describe('genericFor', () => {
  it('offers every generic block a contract can feed', () => {
    expect(genericFor(payments, home)).toEqual([...GENERIC]);
  });

  it('lets a page’s own blocks replace generic ones, and skips what has nothing to show', () => {
    const plain = defineApp({
      id: 'plain',
      description: 'No data',
      actions: { open: action({ label: 'Open', description: 'Open' }) },
      surfaces: {
        bar: list({ label: 'Bar', description: 'Bar', items: ['open'], capacity: 1 }),
        home: page({
          note: block({
            label: 'Note',
            description: 'Mine',
            props: z.object({ body: z.string() }),
          }),
        })({
          label: 'Home',
          description: 'Home',
          standard: () => ui.page(ui.section('', 'stack', [])),
        }),
        other: page({})({
          label: 'Other',
          description: 'Other',
          generic: ['note'],
          standard: () => ui.page(ui.section('', 'stack', [])),
        }),
      },
    });
    expect(genericFor(plain, plain.surfaces.home as AnyPageSpec)).toEqual(['actions']);
    expect(genericFor(plain, plain.surfaces.other as AnyPageSpec)).toEqual(['note']);
  });
});

describe('generic blocks', () => {
  it('accept a dashboard built from queries, in canonical form', () => {
    const value = pageOf(
      [
        table({
          columns: ['PAYMENTS.amount', 'payments.id'],
          lookups: [],
          rowActions: [
            { action: 'note.add', set: [{ param: 'note.add:text', value: 'Called them' }] },
          ],
        }),
        {
          block: 'metric',
          props: { data: 'failedCount', label: ' Failed this week ', compare: 'previous' },
        },
        { block: 'chart', props: { data: 'perDay', kind: 'bar', stacked: true } },
        {
          block: 'list',
          props: {
            data: 'failed',
            title: 'payments.id',
            subtitle: 'payments.customer.name',
            meta: 'none',
            badge: 'payments.status',
            rowActions: [],
            link: 'none',
          },
        },
        {
          block: 'timeline',
          props: { data: 'failed', time: 'payments.created', title: 'payments.id', detail: '' },
        },
        {
          block: 'board',
          props: { data: 'failed', column: 'payments.status', title: 'payments.id', meta: 'none' },
        },
        { block: 'form', props: { action: 'refund', set: [] } },
        {
          block: 'actions',
          props: { list: 'nav', items: [{ action: 'export', set: [] }], size: 'large' },
        },
        {
          block: 'note',
          props: { title: 'Remember', text: 'Disputes need evidence within a week' },
        },
        {
          block: 'links',
          props: { items: [{ label: 'All payments', route: 'PAYMENTS', entity: '' }] },
        },
      ],
      { failed: failedRecently, failedCount, perDay },
    );
    const checked = validatePage(payments, home, value);
    const props = (id: string) => checked.elements.find((element) => element.id === id)?.props;
    expect(props('b0')).toMatchObject({
      columns: ['payments.amount', 'payments.id'],
      rowActions: [{ action: 'note.add', set: [{ param: 'text', value: 'Called them' }] }],
    });
    expect(props('b1')).toMatchObject({ label: 'Failed this week' });
    expect(props('b3')).toMatchObject({ meta: 'none', badge: 'payments.status' });
    expect(props('b4')).toMatchObject({ detail: 'none' });
    expect(props('b7')).toMatchObject({ list: 'nav' });
    expect(props('b9')).toEqual({
      items: [{ label: 'All payments', route: 'payments', entity: '' }],
    });
    expect(checked.data.map((entry) => entry.name)).toEqual(['failed', 'failedCount', 'perDay']);
  });

  it('join figures from other queries into a table, one per row', () => {
    const value = pageOf(
      [
        {
          block: 'table',
          props: {
            data: 'customers',
            columns: ['customers.name'],
            lookups: [{ data: 'lifetime', label: 'Lifetime value' }],
            rowActions: [],
            density: 'comfortable',
            link: 'entity',
          },
        },
      ],
      { customers, lifetime },
    );
    expect(problemOf(value)).toBeUndefined();
    const ungrouped = pageOf(
      [
        table({
          data: 'customers',
          columns: ['customers.name'],
          link: 'none',
          lookups: [{ data: 'total', label: 'Total' }],
        }),
      ],
      {
        customers,
        total: query('payments', {
          filter: lifetime.filter,
          aggregate: { measure: 'sum', of: 'payments.amount', by: 'payments.currency' },
        }),
      },
    );
    expect(messageOf(ungrouped)).toBe('Table: a lookup groups its query by a ref to customers');
  });

  it('show $current on pages about one row', () => {
    const own = pageOf(
      [
        {
          block: 'detail',
          props: { data: 'self', fields: ['payments.amount', 'payments.status'], columns: 2 },
        },
      ],
      {
        self: query('payments', {
          fields: ['payments.amount', 'payments.status'],
          filter: [{ field: 'payments.id', op: 'eq', values: ['$current'] }],
          limit: 1,
        }),
      },
    );
    expect(problemOf(own, paymentPage)).toBeUndefined();
    expect(messageOf(own, home)).toBe('self: $current only works on pages about one row');
  });

  it('reject blocks that don’t fit their queries', () => {
    const cases: [AnyPage, string][] = [
      [pageOf([table({ data: 'nope' })]), 'Table: no query is called "nope"'],
      [
        pageOf([table({ columns: ['payments.refunded'] })], { failed: failedRecently }),
        "Table: add payments.refunded to the query's fields to show it",
      ],
      [
        pageOf([table({ columns: ['customers.name'] })], { failed: failedRecently }),
        'Table: column "customers.name" is not a field of payments',
      ],
      [
        pageOf([table({ data: 'count', columns: ['payments.id'] })], { count: failedCount }),
        'Table: needs rows; its query sums them up',
      ],
      [
        pageOf([{ block: 'metric', props: { data: 'failed', label: 'x', compare: 'none' } }], {
          failed: failedRecently,
        }),
        'Metric: needs a summary: give its query a measure',
      ],
      [
        pageOf([{ block: 'metric', props: { data: 'perDay', label: 'x', compare: 'none' } }], {
          perDay,
        }),
        'Metric: shows one number: leave its query ungrouped',
      ],
      [
        pageOf([{ block: 'metric', props: { data: 'all', label: 'x', compare: 'previous' } }], {
          all: query('payments', { aggregate: { measure: 'count' } }),
        }),
        'Metric: compares periods only when its query starts at a time, such as created gte -30d',
      ],
      [
        pageOf([{ block: 'chart', props: { data: 'count', kind: 'line', stacked: false } }], {
          count: failedCount,
        }),
        'Chart: needs groups: group its query by a time or a category',
      ],
      [
        pageOf([{ block: 'chart', props: { data: 'perDay', kind: 'pie', stacked: false } }], {
          perDay,
        }),
        'Chart: pies show categories, without a split',
      ],
      [
        pageOf(
          [
            {
              block: 'timeline',
              props: {
                data: 'failed',
                time: 'payments.amount',
                title: 'payments.id',
                detail: 'none',
              },
            },
          ],
          { failed: failedRecently },
        ),
        'Timeline: payments.amount is not a time',
      ],
      [
        pageOf(
          [
            {
              block: 'board',
              props: { data: 'failed', column: 'payments.id', title: 'payments.id', meta: 'none' },
            },
          ],
          { failed: failedRecently },
        ),
        'Board: columns come from an enum field, not payments.id',
      ],
      [
        pageOf(
          [{ block: 'detail', props: { data: 'failed', fields: ['payments.id'], columns: 1 } }],
          { failed: failedRecently },
        ),
        "Detail: shows one row: set its query's limit to 1",
      ],
      [
        pageOf(
          [
            table({
              data: 'customers',
              columns: ['customers.name'],
              link: 'none',
              rowActions: [{ action: 'refund', set: [] }],
            }),
          ],
          { customers },
        ),
        "Table: Refund payment doesn't act on customers rows",
      ],
      [
        pageOf([{ block: 'form', props: { action: 'export', set: [] } }]),
        'Form: Export payments takes nothing to fill in',
      ],
      [
        pageOf([{ block: 'form', props: { action: 'go.home', set: [] } }]),
        "Form: Home doesn't run anything",
      ],
      [
        pageOf([
          { block: 'form', props: { action: 'note.add', set: [{ param: 'mood', value: 'x' }] } },
        ]),
        'Form: Add note has no param "mood"',
      ],
      [
        pageOf([
          {
            block: 'form',
            props: { action: 'note.add', set: [{ param: 'text', value: '$row.id' }] },
          },
        ]),
        'Form: $row only works in row actions',
      ],
      [
        pageOf([
          {
            block: 'form',
            props: { action: 'refund', set: [{ param: 'reason', value: 'bored' }] },
          },
        ]),
        'Form: Reason can\'t be "bored"',
      ],
      [
        pageOf([{ block: 'actions', props: { list: 'sidebar', items: [], size: 'small' } }]),
        'Actions: no list "sidebar"',
      ],
      [
        pageOf([
          { block: 'links', props: { items: [{ label: 'x', route: 'reports', entity: '' }] } },
        ]),
        'Links: no route "reports"',
      ],
      [
        pageOf([
          { block: 'links', props: { items: [{ label: 'x', route: 'customer', entity: '' }] } },
        ]),
        'Links: customer needs the customers to open',
      ],
      [
        pageOf([table({ data: 'disputes', columns: ['disputes.id'] })], {
          disputes: query('disputes', { fields: ['disputes.id'] }),
        }),
        'Table: no page shows one disputes row',
      ],
      [
        pageOf([{ block: 'note', props: { title: '', text: 'hi' } }], { failed: failedRecently }),
        'Nothing shows the query "failed"',
      ],
    ];
    for (const [value, expected] of cases) expect(messageOf(value)).toBe(expected);
  });

  it('keep destructive actions and filled-in writes out of pages a planner made unasked', () => {
    const refund = pageOf([table({ rowActions: [{ action: 'refund', set: [] }] })], {
      failed: failedRecently,
    });
    expect(problemOf(refund)).toBeUndefined();
    expect(problemOf(refund, home, true)).toEqual({
      rule: 'kind',
      message: 'Only you can put Refund payment on a page',
    });
    const prefilled = pageOf([
      { block: 'form', props: { action: 'note.add', set: [{ param: 'text', value: 'hi' }] } },
    ]);
    expect(problemOf(prefilled, home, true)).toEqual({
      rule: 'kind',
      message: 'Only you can fill in Add note',
    });
    const blank = pageOf([{ block: 'form', props: { action: 'note.add', set: [] } }]);
    expect(problemOf(blank, home, true)).toBeUndefined();

    const result = check(
      [
        {
          id: 'x',
          change: { kind: 'page', surface: 'home', op: 'set', value: refund },
          origin: 'model',
          layer: 'model',
          evidence: [{ intent: '' }],
          basedOn: { version: 0, summary: '', session: 0 },
        },
      ],
      {
        contract: payments,
        definition: emptyDefinition(payments),
        summary: summarize(payments, emptyDefinition(payments), [], [], 0),
        session: 0,
        intent: 'show failed payments',
      },
    );
    expect(result.rejected[0]?.rule).toBe('kind');
  });
});

describe('charts of money', () => {
  const chart = (kind: string, stacked: boolean, aggregate: Partial<Query['aggregate']>) =>
    messageOf(
      pageOf([{ block: 'chart', props: { data: 'sums', kind, stacked } }], {
        sums: query('payments', {
          aggregate: { measure: 'sum', of: 'payments.amount', ...aggregate },
        }),
      }),
      home,
      true,
    );

  it('never add amounts in different currencies into one pie or stack', () => {
    expect(chart('pie', false, { by: 'payments.currency' })).toBe(
      'Chart: would add amounts in different currencies: show them as bars',
    );
    expect(
      chart('bar', true, { by: 'payments.created', bucket: 'month', split: 'payments.currency' }),
    ).toBe('Chart: would stack amounts in different currencies: leave them side by side');
    expect(chart('bar', false, { by: 'payments.currency' })).toBeUndefined();
    expect(
      chart('line', false, { by: 'payments.created', bucket: 'month', split: 'payments.currency' }),
    ).toBeUndefined();
    const counted = pageOf(
      [{ block: 'chart', props: { data: 'n', kind: 'pie', stacked: false } }],
      {
        n: query('payments', { aggregate: { measure: 'count', by: 'payments.currency' } }),
      },
    );
    expect(messageOf(counted)).toBeUndefined();
  });
});

describe('links', () => {
  it("fall back to the route's own label", () => {
    const value = validatePage(
      payments,
      home,
      pageOf([{ block: 'links', props: { items: [{ label: ' ', route: 'home', entity: '' }] } }]),
    );
    expect(value.elements[1]?.props).toEqual({
      items: [{ label: 'Home', route: 'home', entity: '' }],
    });
    expect(
      messageOf(
        pageOf([
          { block: 'links', props: { items: [{ label: 'x', route: 'customer', entity: '..' }] } },
        ]),
      ),
    ).toBe('Links: ".." can\'t name a row');
  });

  it('let a planner name a row only as $current, the page its own', () => {
    const link = (route: string, entity: string) =>
      pageOf([{ block: 'links', props: { items: [{ label: 'Open', route, entity }] } }]);
    expect(messageOf(link('payment', '$current'), paymentPage, true)).toBeUndefined();
    expect(messageOf(link('payment', '$CURRENT'), paymentPage, true)).toBeUndefined();
    expect(messageOf(link('payment', 'ch_001'), paymentPage, true)).toBe(
      "Links: names a row only as $current, the page's own row",
    );
    expect(messageOf(link('home', 'ch_001'), home, true)).toBe(
      "Links: names a row only as $current, the page's own row",
    );
    // The person may link to any row they know.
    expect(messageOf(link('payment', 'ch_001'), paymentPage)).toBeUndefined();
    expect(messageOf(link('customer', '$current'), paymentPage)).toBe(
      "Links: $current is the page's own row, and customer shows customers",
    );
    expect(messageOf(link('payment', '$current'), home)).toBe(
      "Links: $current is the page's own row, and payment shows payments",
    );
  });
});
