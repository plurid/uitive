import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { createUitive } from './client.js';
import { action, block, defineApp, page } from './contract.js';
import {
  emptyDefinition,
  resolvePage,
  type AppliedOperation,
  type Definition,
} from './definition.js';
import { field } from './field.js';
import { fromSections, ui, walk, type AnyPage, type ElementOf } from './page.js';
import type { Planner } from './planner.js';
import { check } from './policy.js';
import { source } from './source.js';
import { memoryStore } from './storage.js';
import { summarise } from './usage.js';

const metric = block({
  label: 'Metric',
  description: 'A chart of one metric',
  props: z.object({ metric: z.enum(['cpu', 'memory']), range: z.enum(['1h', '24h']) }),
});
const table = block({
  label: 'Table',
  description: 'Resources as rows',
  props: z.object({ columns: z.array(z.enum(['name', 'state'])), limit: z.number().int() }),
  validate: (props) =>
    props.limit < 1 || props.limit > 50 ? 'show between 1 and 50 rows' : undefined,
});
const note = block({
  label: 'Note',
  description: 'Your own text',
  props: z.object({ text: z.string() }),
});

const v1Service = (title: string) => ({
  sections: [
    {
      title,
      layout: 'stack' as const,
      blocks: [{ block: 'table' as const, props: { columns: ['name' as const], limit: 10 } }],
    },
  ],
});

const ops = defineApp({
  id: 'ops',
  description: 'An operations console',
  actions: { start: action({ label: 'Start', description: 'Start it' }) },
  contexts: { service: ['vm', 'db'] },
  regions: {
    original: { label: 'Original page', description: 'The page as the application ships it' },
  },
  surfaces: {
    home: page({ metric, note })({
      label: 'Home',
      description: 'The first page',
      standard: () => ({
        sections: [
          {
            title: 'Overview',
            layout: 'grid',
            blocks: [{ block: 'metric', props: { metric: 'cpu', range: '24h' } }],
          },
        ],
      }),
    }),
    service: page({ table, metric })({
      label: 'Service page',
      description: 'One service',
      context: 'service',
      maxElements: 6,
      standard: (service) =>
        ui.page(
          ui.section(service ?? '', 'stack', [ui.block('table', { columns: ['name'], limit: 10 })]),
        ),
    }),
  },
});

const compact = ui.page(
  ui.section('Running', 'columns', [ui.block('table', { columns: ['name', 'state'], limit: 5 })]),
);
const charts = ui.page(
  ui.section('Charts', 'grid', [ui.block('metric', { metric: 'memory', range: '1h' })]),
);

/** Every section title, in tree order. */
const titles = (value: AnyPage) =>
  walk(value)
    .filter((entry) => entry.element.block === 'section')
    .map((entry) => (entry.element.props as { title: string }).title);

let counter = 0;
const applied = (
  change: AppliedOperation['change'],
  status: AppliedOperation['status'] = 'active',
): AppliedOperation => ({
  id: `p${++counter}`,
  change,
  origin: 'user',
  layer: 'user',
  evidence: [],
  basedOn: { version: 0, summary: '', session: 0 },
  status,
  session: 0,
  adaptation: 'a',
});
const definition = (...operations: AppliedOperation[]): Definition => ({
  ...emptyDefinition(ops),
  operations,
});

describe('page format', () => {
  it('converts sections of blocks into a tree under a root section', () => {
    expect(fromSections(v1Service('vm'))).toEqual({
      root: 'page',
      elements: [
        { id: 'page', block: 'section', props: { title: '', layout: 'stack' }, children: ['s1'] },
        { id: 's1', block: 'section', props: { title: 'vm', layout: 'stack' }, children: ['s1b1'] },
        { id: 's1b1', block: 'table', props: { columns: ['name'], limit: 10 }, children: [] },
      ],
      data: [],
    });
  });

  it('flattens trees, naming elements after their blocks', () => {
    const value = ui.page(
      ui.section('', 'stack', [
        ui.tabs('Views', [ui.section('One', 'stack', [ui.region('original')])]),
        ui.block('note', { text: 'hi' }, 'mine'),
      ]),
    );
    expect(value.root).toBe('section-1');
    expect(walk(value).map((entry) => [entry.element.id, entry.depth])).toEqual([
      ['section-1', 1],
      ['tabs-1', 2],
      ['section-2', 3],
      ['region-1', 4],
      ['mine', 2],
    ]);
  });
});

describe('resolvePage', () => {
  it('prefers a redesign for this value, then one for every value, then the standard page', () => {
    const one = applied({
      kind: 'page',
      surface: 'service',
      context: 'vm',
      op: 'set',
      value: compact,
    });
    const every = applied({
      kind: 'page',
      surface: 'service',
      context: '*',
      op: 'set',
      value: charts,
    });
    const both = definition(one, every);
    expect(resolvePage(ops, both, 'service', 'vm')).toEqual(compact);
    expect(resolvePage(ops, both, 'service', 'db')).toEqual(charts);
    expect(titles(resolvePage(ops, undefined, 'service', 'db'))).toEqual(['db']);

    const reset = applied({ kind: 'page', surface: 'service', context: 'vm', op: 'reset' });
    expect(resolvePage(ops, definition(one, every, reset), 'service', 'vm')).toEqual(charts);
  });

  it('converts standard pages written as sections', () => {
    expect(titles(resolvePage(ops, undefined, 'home'))).toEqual(['', 'Overview']);
  });

  it('previews a suggested redesign without applying it', () => {
    const suggested = applied(
      { kind: 'page', surface: 'home', op: 'set', value: charts },
      'suggested',
    );
    const pending = definition(suggested);
    expect(titles(resolvePage(ops, pending, 'home'))).toEqual(['', 'Overview']);
    expect(resolvePage(ops, pending, 'home', undefined, suggested.id)).toEqual(charts);
  });
});

describe('page policy', () => {
  const run = (
    value: unknown,
    options: {
      context?: string;
      origin?: 'user' | 'model';
      intent?: string;
      surface?: string;
    } = {},
  ) => {
    const origin = options.origin ?? 'user';
    return check(
      [
        {
          id: 'x',
          change: {
            kind: 'page',
            surface: options.surface ?? 'service',
            context: options.context ?? 'vm',
            op: 'set',
            value: value as AnyPage,
          },
          origin,
          layer: origin === 'user' ? 'user' : 'model',
          evidence: origin === 'user' ? [] : [{ intent: '' }],
          basedOn: { version: 0, summary: '', session: 0 },
        },
      ],
      {
        contract: ops,
        definition: emptyDefinition(ops),
        summary: summarise(ops, emptyDefinition(ops), [], [], 0),
        session: 0,
        ...(options.intent === undefined ? {} : { intent: options.intent }),
      },
    );
  };
  const message = (value: unknown, options = {}) => run(value, options).rejected[0]?.message;
  const element = (id: string, blockName: string, props: unknown, children: string[] = []) => ({
    id,
    block: blockName,
    props,
    children,
  });
  const section = (id: string, children: string[], title = '') =>
    element(id, 'section', { title, layout: 'stack' }, children);
  const rows = (id: string) => element(id, 'table', { columns: ['name'], limit: 5 });

  it('accepts redesigns in canonical form: names, titles and tree order', () => {
    const result = run({
      root: ' top ',
      elements: [
        element('t', 'TABLE', { columns: ['name'], limit: 5 }),
        element('top', 'Section', { title: ' Mine ', layout: 'grid' }, ['t']),
      ],
      data: [],
    });
    const change = result.accepted[0]?.change;
    expect(change?.kind === 'page' && change.value).toEqual({
      root: 'top',
      elements: [
        { id: 'top', block: 'section', props: { title: 'Mine', layout: 'grid' }, children: ['t'] },
        { id: 't', block: 'table', props: { columns: ['name'], limit: 5 }, children: [] },
      ],
      data: [],
    });
  });

  it('accepts pages written as sections, converted', () => {
    const change = run(v1Service('Mine')).accepted[0]?.change;
    expect(change?.kind === 'page' && titles(change.value!)).toEqual(['', 'Mine']);
  });

  it('rejects blocks outside the page, broken props and the application’s own rules', () => {
    const one = (entry: unknown) => ({
      root: 'p',
      elements: [section('p', ['x']), entry],
      data: [],
    });
    expect(message(one(element('x', 'gauge', { value: 1 })))).toBe('No block "gauge"');
    // Every page may hold a generic note, even without sources.
    expect(
      run(one(element('x', 'note', { title: '', text: 'Check the backups' }))).accepted,
    ).toHaveLength(1);
    expect(message(one(element('x', 'table', { columns: ['owner'], limit: 5 })))).toMatch(
      /^Table: /,
    );
    expect(message(one(element('x', 'table', { columns: ['name'], limit: 500 })))).toBe(
      'Table: show between 1 and 50 rows',
    );
    expect(message(compact, { context: 'cache' })).toBe('No service "cache"');
    expect(run(compact, { context: '*' }).accepted).toHaveLength(1);
  });

  it('rejects anything that is not one tree from the root', () => {
    const page = (root: string, ...elements: unknown[]) => ({ root, elements, data: [] });
    expect(message(page('p'))).toBe('A page needs an element');
    expect(
      message(
        page(
          'p',
          section('p', ['a', 'b', 'c', 'd', 'e', 'f']),
          rows('a'),
          rows('b'),
          rows('c'),
          rows('d'),
          rows('e'),
          rows('f'),
        ),
      ),
    ).toBe('At most 6 elements');
    expect(message(page('p', section('p', ['a']), rows('a'), rows('a')))).toBe(
      'Two elements are called "a"',
    );
    expect(message(page('p', section('p', ['ghost'])))).toMatch(
      /holds "ghost", which is not an element/,
    );
    expect(message(page('p', section('p', ['a', 'b']), section('b', ['a']), rows('a')))).toBe(
      '"a" has two places on the page',
    );
    expect(message(page('p', section('p', []), rows('loose')))).toBe('"loose" is not on the page');
    expect(message(page('p', section('p', ['q']), section('q', ['p'])))).toBe(
      'Nothing can hold the root',
    );
    expect(message(page('nope', section('p', [])))).toBe('The root "nope" is not an element');
    expect(
      message(
        page('p', section('p', ['t']), element('t', 'tabs', { title: '' }, ['a']), rows('a')),
      ),
    ).toBe('Tabs hold sections, one per tab');
    expect(
      message(
        page(
          'p',
          section('p', ['a']),
          element('a', 'table', { columns: ['name'], limit: 5 }, ['p']),
        ),
      ),
    ).toBe("Table can't hold other elements");
    expect(
      message(
        page(
          'p',
          section('p', ['a']),
          section('a', ['b']),
          section('b', ['c']),
          section('c', ['d']),
          rows('d'),
        ),
      ),
    ).toBe('Pages nest at most 4 levels deep');
    expect(message(page('p', section('p', ['bad id']), rows('bad id')))).toMatch(
      /Element IDs are short words/,
    );
  });

  it('embeds only regions the page may show', () => {
    const withRegion = (name: string) => ({
      root: 'p',
      elements: [section('p', ['r']), element('r', 'region', { name })],
      data: [],
    });
    const accepted = run(withRegion('ORIGINAL')).accepted[0]?.change;
    expect(accepted?.kind === 'page' && accepted.value?.elements[1]?.props).toEqual({
      name: 'original',
    });
    expect(message(withRegion('sidebar'))).toBe('No region "sidebar" on this page');
  });

  it('lets a planner redesign only with a stated reason', () => {
    expect(run(compact, { origin: 'model' }).rejected[0]?.rule).toBe('evidence');
    expect(
      run(compact, { origin: 'model', intent: 'show me what is running' }).accepted,
    ).toHaveLength(1);
  });
});

describe('standard pages and regions in contracts', () => {
  const base = {
    id: 'app',
    description: 'An app',
    actions: { open: action({ label: 'Open', description: 'Open' }) },
  };

  it('rejects standard pages that break the rules, naming the context value', () => {
    expect(() =>
      defineApp({
        ...base,
        surfaces: {
          home: page({ note })({
            label: 'Home',
            description: 'Home',
            standard: () => ui.page(ui.section('', 'stack', [ui.block('chart', {})])),
          }),
        },
      }),
    ).toThrow(/surface home: the standard page: No block "chart"/);
    expect(() =>
      defineApp({
        ...base,
        contexts: { service: ['vm', 'db'] },
        surfaces: {
          service: page({ table })({
            label: 'Service',
            description: 'Service',
            context: 'service',
            standard: (value) =>
              ui.page(
                ui.section('', 'stack', [
                  ui.block('table', { columns: ['name'], limit: value === 'db' ? 99 : 5 }),
                ]),
              ),
          }),
        },
      }),
    ).toThrow(/the standard page for db: Table: show between 1 and 50 rows/);
  });

  it('reserves the built-in block names and checks entities', () => {
    const plain = (spec: Record<string, unknown>) => () =>
      defineApp({
        ...base,
        sources: {
          customers: source({
            label: 'Customers',
            description: 'Customers',
            row: z.object({ id: z.string(), name: z.string(), owner: field.ref('customers') }),
            key: 'id',
          }),
        },
        ...spec,
      } as never);
    expect(
      plain({
        surfaces: {
          home: page({ section: note })({
            label: 'Home',
            description: 'Home',
            standard: () => ui.page(ui.section('', 'stack', [])),
          }),
        },
      }),
    ).toThrow(/"section" is a built-in block/);
    expect(
      plain({
        surfaces: {
          home: page({ note })({
            label: 'Home',
            description: 'Home',
            entity: 'orders',
            standard: () => ui.page(ui.section('', 'stack', [])),
          }),
        },
      }),
    ).toThrow(/unknown source "orders"/);
    expect(
      plain({
        regions: { card: { label: 'Card', description: 'Card', entity: 'orders' } },
        surfaces: {},
      }),
    ).toThrow(/region card: unknown source "orders"/);
  });

  it('offers regions about an entity only on pages about it', () => {
    const contract = defineApp({
      ...base,
      sources: {
        customers: source({
          label: 'Customers',
          description: 'Customers',
          row: z.object({ id: z.string(), name: z.string() }),
          key: 'id',
        }),
      },
      regions: {
        profile: { label: 'Profile', description: 'One customer', entity: 'customers' },
        news: { label: 'News', description: 'Announcements' },
      },
      surfaces: {
        customer: page({ note })({
          label: 'Customer',
          description: 'One customer',
          entity: 'customers',
          standard: () => ui.page(ui.section('', 'stack', [ui.region('profile')])),
        }),
        home: page({ note })({
          label: 'Home',
          description: 'Home',
          standard: () => ui.page(ui.section('', 'stack', [ui.region('news')])),
        }),
      },
    });
    const client = createUitive({ contract, now: () => 0 });
    const onHome = client.setPage('home', ui.page(ui.section('', 'stack', [ui.region('profile')])));
    expect(onHome.rejected[0]?.message).toBe('No region "profile" on this page');
  });
});

describe('pages in the client', () => {
  const fresh = (planner?: Planner) =>
    createUitive({ contract: ops, now: () => 0, ...(planner ? { planner } : {}) });

  it('applies the user’s redesign at once, explains it, and resets it', async () => {
    const client = fresh();
    client.setContext('service', 'vm');
    const adaptation = client.setPage('service', compact);
    expect(client.surface('service')).toEqual(compact);
    expect(titles(client.surface('service', 'db'))).toEqual(['db']);
    expect(client.explain(adaptation.applied[0] as string)?.title).toBe(
      'Service page for vm redesigned',
    );
    client.resetPage('service');
    expect(titles(client.surface('service'))).toEqual(['vm']);
    client.setPage('service', v1Service('Old style'));
    expect(titles(client.surface('service'))).toEqual(['', 'Old style']);
    const reset = await client.ask('reset this page');
    expect(reset.status).toBe('done');
    expect(titles(client.surface('service'))).toEqual(['vm']);
  });

  it('keeps a planner’s redesign as a suggestion to preview, accept or dismiss', async () => {
    const designer: Planner = {
      name: 'designer',
      async plan() {
        return {
          origin: 'model',
          operations: [
            {
              change: { kind: 'page', surface: 'home', op: 'set', value: charts },
              evidence: [{ intent: true }],
            },
          ],
          meta: { planner: 'designer', ms: 0 },
        };
      },
    };
    const client = fresh(designer);
    client.setGoal('I watch memory');
    // Even when the person lets the interface act on its own.
    client.setAutonomy('auto');
    const plan = await client.plan();
    const id = plan.applied[0] as string;
    expect(titles(client.surface('home'))).toEqual(['', 'Overview']);
    client.preview(id);
    expect(client.surface('home')).toEqual(charts);
    expect(titles(client.standard('home'))).toEqual(['', 'Overview']);
    expect(client.accept(id)).toBe(true);
    expect(client.getSnapshot().preview).toBeUndefined();
    expect(client.surface('home')).toEqual(charts);
    expect(
      client.getSnapshot().definition.operations.find((entry) => entry.id === id)?.status,
    ).toBe('kept');
    const again = await client.plan();
    expect(again.rejected[0]?.rule).toBe('precedence');
  });

  it('migrates stored definitions from sections to elements', () => {
    const operation = {
      ...applied({
        kind: 'page',
        surface: 'service',
        context: 'vm',
        op: 'set',
        value: v1Service('Stored') as never,
      }),
    };
    const store = memoryStore({
      schemaVersion: 1,
      contract: ops.hash,
      session: 0,
      lastActivityAt: 0,
      sessions: [{ index: 0, startedAt: 0, contexts: {} }],
      events: [],
      definition: {
        ...emptyDefinition(ops),
        schemaVersion: 1,
        version: 1,
        operations: [operation],
      },
      pending: [],
      seen: {},
      adaptations: [],
      view: 'yours',
      autonomy: 'mixed',
      counter: 1,
    });
    const client = createUitive({ contract: ops, store, now: () => 0 });
    expect(client.getSnapshot().definition.schemaVersion).toBe(2);
    expect(client.surface('service', 'vm')).toEqual(fromSections(v1Service('Stored')));
  });

  it('imports version 1 documents', () => {
    const client = fresh();
    const result = client.import({
      format: 'uitive.definition',
      version: 1,
      contract: { id: 'ops', hash: 'old' },
      definition: {
        ...emptyDefinition(ops),
        schemaVersion: 1,
        operations: [
          applied({
            kind: 'page',
            surface: 'service',
            context: 'db',
            op: 'set',
            value: v1Service('Imported') as never,
          }),
        ],
      },
    });
    expect(result.applied).toHaveLength(1);
    expect(titles(client.surface('service', 'db'))).toEqual(['', 'Imported']);
  });

  it('types every page element from the contract', () => {
    const client = fresh();
    const value = client.surface('service', 'vm');
    expectTypeOf(value.elements[0]!).toEqualTypeOf<
      ElementOf<{ table: typeof table; metric: typeof metric }>
    >();
  });
});
