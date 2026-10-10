import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { editor } from './__fixtures__/editor.js';
import { payments } from './__fixtures__/payments.js';
import { createUitive, type DefinitionDocument } from './client.js';
import { action, collection, defineApp, list } from './contract.js';
import { emptyDefinition } from './definition.js';
import { heuristicPlanner } from './heuristic.js';
import type { Planner, PlanResult, ProposedOperation } from './planner.js';
import { memoryStore, type Store } from './storage.js';

const MINUTE = 60_000;

/** Stores that share one value and tell every other tab about a write, as `storage` events do. */
function tabs() {
  let text: string | undefined;
  const watchers = new Set<() => void>();
  return (): Store => {
    let own: (() => void) | undefined;
    return {
      load: () => (text === undefined ? undefined : JSON.parse(text)),
      save: (state: unknown) => {
        text = JSON.stringify(state);
        for (const watcher of watchers) if (watcher !== own) watcher();
      },
      clear: () => {
        text = undefined;
      },
      watch(listener) {
        own = listener;
        watchers.add(listener);
        return () => watchers.delete(listener);
      },
    };
  };
}

const document = (definition: unknown): DefinitionDocument =>
  ({
    format: 'uitive.definition',
    version: 1,
    contract: { id: 'editor', hash: 'elsewhere' },
    definition,
  }) as DefinitionDocument;

let counter = 0;
const applied = (change: unknown, origin: 'user' | 'model' = 'user', status = 'active') => ({
  id: `i${++counter}`,
  change,
  origin,
  layer: origin === 'user' ? 'user' : 'model',
  evidence: [],
  basedOn: { version: 0, summary: '', session: 0 },
  status,
  session: 40,
  adaptation: 'x',
});

const macro = (item: string, steps = ['bold', 'italic']) => ({
  kind: 'collection',
  surface: 'macros',
  op: 'add',
  item,
  value: { label: item, steps },
});

const answering = (operations: ProposedOperation[]): Planner => ({
  name: 'model',
  async plan() {
    return { origin: 'model', operations, meta: { planner: 'model', ms: 0 } };
  },
});

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

describe('import', () => {
  it('checks imported changes against the contract’s rules, as any change', () => {
    const client = createUitive({ contract: editor, now: () => 0 });
    const result = client.import(
      document({
        ...emptyDefinition(editor),
        operations: [
          applied(macro('one')),
          applied(macro('unknown', ['bold', 'teleport'])),
          applied({
            ...macro('long'),
            value: { label: 'x'.repeat(5000), steps: ['bold', 'quote'] },
          }),
          applied(macro('two')),
          applied(macro('three')),
          applied({ kind: 'list', surface: 'toolbar', op: 'hide', target: 'share' }),
          applied({ kind: 'list', surface: 'toolbar', op: 'pin', target: 'table' }, 'model'),
          applied({ kind: 'list', surface: 'toolbar', op: 'hide', target: 'bold' }),
        ],
      }),
    );
    expect(result.rejected.map((entry) => entry.rule)).toEqual([
      'validator',
      'validator',
      'capacity',
      'required',
      'kind',
    ]);
    expect(client.surface('macros').items.map((entry) => entry.title)).toEqual(['one', 'two']);
    expect(client.surface('toolbar').visible.map((view) => view.id)).not.toContain('bold');
    // Imported changes count from this device's session: another counts its own.
    expect(client.getSnapshot().definition.operations.map((entry) => entry.session)).toEqual([
      0, 0, 0,
    ]);
  });

  it('keeps the person’s pages within their cap, each a valid page', () => {
    const client = createUitive({ contract: payments, now: () => 0 });
    const page = (slug: string, value: unknown) =>
      applied({ kind: 'userPage', surface: 'userPages', op: 'create', slug, title: 'T', value });
    const valid = client.createPage('Template').adaptation;
    const value = client.userPages()[0]?.value;
    expect(valid.applied).toHaveLength(1);
    const result = client.import({
      ...document({
        ...emptyDefinition(payments),
        operations: [
          page('broken', {
            root: 'nope',
            elements: [{ id: 'a', block: 'nothing', children: ['a'] }],
          }),
          ...Array.from({ length: 22 }, (_, index) => page(`page-${index}`, value)),
        ],
      }),
      contract: { id: payments.id, hash: 'elsewhere' },
    });
    expect(result.rejected.map((entry) => entry.rule)).toEqual(['unknown', 'capacity', 'capacity']);
    expect(client.userPages()).toHaveLength(20);
  });

  it('refuses files whose entries aren’t changes, without throwing or changing anything', () => {
    const client = createUitive({ contract: editor, now: () => 0 });
    client.hide('toolbar', 'bold');
    for (const schemaVersion of [1, 2]) {
      const result = client.import(
        document({ ...emptyDefinition(editor), schemaVersion, operations: [null] }),
      );
      expect(result.status).toBe('not_allowed');
    }
    expect(client.surface('toolbar').visible.map((view) => view.id)).not.toContain('bold');
  });

  it('takes only well-formed settings, so planning keeps working, across reloads too', async () => {
    const store = memoryStore();
    const client = createUitive({ contract: editor, now: () => 0, store });
    client.import(
      document({
        operations: [],
        frozen: 'yes',
        goal: `  ${'g'.repeat(600)}  `,
        blocked: ['TOOLBAR||promote|Table', 'toolbar||promote|teleport', 7],
        cooldowns: [
          { key: 'toolbar||promote|image', until: 900 },
          { key: 'toolbar||promote|link', until: 'later' },
        ],
        extra: 'kept?',
      }),
    );
    const definition = client.getSnapshot().definition;
    expect(definition.frozen).toBe(false);
    expect(definition.goal).toHaveLength(500);
    expect(definition.blocked).toEqual(['toolbar||promote|table']);
    expect(definition.cooldowns).toEqual([{ key: 'toolbar||promote|image', until: 5 }]);
    expect(definition).not.toHaveProperty('extra');
    expect((await client.plan()).kind).toBe('plan');
    client.flush();

    const reloaded = createUitive({ contract: editor, now: () => 0, store });
    expect(reloaded.request('plan').state.cooldowns).toEqual(['toolbar||promote|image']);
    reloaded.nextSession();
    expect(await reloaded.learn()).toMatchObject({ kind: 'plan' });
  });
});

describe('storage', () => {
  it('loads state with missing or broken parts, and keeps working', async () => {
    const store = memoryStore({
      schemaVersion: 2,
      contract: editor.hash,
      session: 3,
      lastActivityAt: 0,
      sessions: 'none',
      events: [{ action: 'bold', via: 'region', session: 2 }, null, { action: 'italic' }],
      definition: {
        operations: [
          applied({ kind: 'list', surface: 'toolbar', op: 'hide', target: 'bold' }),
          { id: 'broken' },
        ],
      },
      pending: [null],
      seen: { 'toolbar||promote|table': 1 },
      adaptations: [{ id: 'a1' }],
      view: 'sideways',
      autonomy: 'reckless',
    });
    const client = createUitive({ contract: editor, now: () => 0, store });
    const snapshot = client.getSnapshot();
    expect(snapshot.definition.operations).toHaveLength(1);
    expect(snapshot.definition.cooldowns).toEqual([]);
    expect(snapshot.view).toBe('yours');
    expect(snapshot.autonomy).toBe('mixed');
    expect(client.events()).toHaveLength(1);
    expect(client.surface('toolbar').visible.map((view) => view.id)).not.toContain('bold');
    expect(client.request('plan').session).toBe(3);
    expect((await client.plan()).kind).toBe('plan');
  });

  it('drops collection items a changed contract no longer accepts, and respells keys', () => {
    const bold = action({ label: 'Bold', description: 'Bold text' });
    const before = defineApp({
      id: 'notes',
      description: 'Notes',
      actions: { bold, italic: action({ label: 'Italic', description: 'Italic text' }) },
      surfaces: {
        toolbar: list({
          label: 'Toolbar',
          description: '',
          items: ['bold', 'italic'],
          capacity: 1,
        }),
        macros: collection({
          label: 'Macros',
          description: '',
          item: z.object({ label: z.string() }),
          max: 3,
          title: (item) => item.label,
        }),
      },
    });
    const after = defineApp({
      id: 'notes',
      description: 'Notes, with named macros',
      actions: {
        bold,
        slanted: action({ label: 'Italic', description: 'Italic text', aliases: ['italic'] }),
      },
      surfaces: {
        toolbar: list({
          label: 'Toolbar',
          description: '',
          items: ['bold', 'slanted'],
          capacity: 1,
        }),
        macros: collection({
          label: 'Macros',
          description: '',
          item: z.object({ name: z.string() }),
          max: 3,
          title: (item) => item.name.toUpperCase(),
        }),
      },
    });
    const store = memoryStore();
    const first = createUitive({ contract: before, store, now: () => 0 });
    first.addItem('macros', { label: 'Emphasis' });
    first.flush();
    const saved = store.load() as { definition: Record<string, unknown> };
    saved.definition.blocked = ['toolbar||promote|italic', 'toolbar||promote|gone'];
    saved.definition.cooldowns = [{ key: 'toolbar||demote|italic', until: 3 }];
    store.save(saved);

    const second = createUitive({ contract: after, store, now: () => 0 });
    expect(second.surface('macros')).toEqual({ items: [], suggestions: [] });
    expect(second.request('plan').state.collections).toEqual({ macros: [] });
    expect(second.getSnapshot().definition.blocked).toEqual(['toolbar||promote|slanted']);
    expect(second.getSnapshot().definition.cooldowns).toEqual([
      { key: 'toolbar||demote|slanted', until: 3 },
    ]);
  });

  it('halves usage to make room only when usage is what fills the store', () => {
    const onError = vi.fn();
    const saves: number[] = [];
    const full: Store = {
      load: () => undefined,
      save: (state) => {
        saves.push((state as { events: unknown[] }).events.length);
        throw new Error('QuotaExceededError');
      },
      clear: () => {},
    };
    const heavy = createUitive({ contract: payments, now: () => 0, store: full, onError });
    for (let index = 0; index < 20; index++) heavy.createPage(`Page ${index}`);
    heavy.record('go.home');
    heavy.flush();
    expect(heavy.events()).toHaveLength(1);

    const busy = createUitive({ contract: editor, now: () => 0, store: full, onError });
    for (let index = 0; index < 40; index++) busy.record('bold');
    busy.flush();
    expect(busy.events(100)).toHaveLength(20);
    expect(onError).toHaveBeenCalled();
  });

  it('explains usage over the sessions whose use is all kept', () => {
    const client = createUitive({ contract: editor, now: () => 0 });
    for (let session = 0; session < 5; session++) {
      if (session > 0) client.nextSession();
      for (let index = 0; index < 500; index++) client.record('bold');
    }
    // 2,500 uses, of which the 2,000 newest are kept: the first session's are gone.
    expect(client.summary().window).toBe(4);
    expect(client.summary().rows.find((row) => row.action === 'bold')?.uses).toBe(2000);
  });
});

describe('tabs', () => {
  it('never applies pending changes when a second tab opens mid-session', async () => {
    const tab = tabs();
    let time = 0;
    const now = () => time;
    const first = createUitive({ contract: editor, now, store: tab() });
    for (let session = 0; session < 3; session++) {
      first.record('table', { via: 'overflow' });
      first.record('table', { via: 'overflow' });
      first.record('bold');
      first.nextSession();
    }
    await first.plan();
    first.flush();
    time += MINUTE;
    first.record('bold');
    first.flush();
    const before = first.surface('toolbar').visible.map((view) => view.id);

    const second = createUitive({ contract: editor, now, store: tab() });
    second.flush();
    expect(first.surface('toolbar').visible.map((view) => view.id)).toEqual(before);
    expect(second.getSnapshot().pending).toHaveLength(1);
  });

  it('leaves another version’s state alone, so the newer version keeps its changes', () => {
    const notes = (table: boolean) =>
      defineApp({
        id: 'notes',
        description: 'Notes',
        actions: {
          bold: action({ label: 'Bold', description: 'Bold text' }),
          italic: action({ label: 'Italic', description: 'Italic text' }),
          ...(table ? { table: action({ label: 'Table', description: 'Insert a table' }) } : {}),
        },
        surfaces: {
          toolbar: list({
            label: 'Toolbar',
            description: '',
            items: table ? ['bold', 'italic', 'table'] : ['bold', 'italic'],
            capacity: 1,
          }),
        },
      });
    const tab = tabs();
    const onError = vi.fn();
    const old = createUitive({ contract: notes(false), store: tab(), now: () => 0, onError });
    const fresh = createUitive({ contract: notes(true), store: tab(), now: () => 0 });
    fresh.pin('toolbar', 'table');
    fresh.flush();
    expect(onError).toHaveBeenCalledOnce();
    old.record('bold');
    old.flush();
    expect(fresh.getSnapshot().definition.operations).toHaveLength(1);
    expect(fresh.surface('toolbar').visible.map((view) => view.id)).toEqual(['table']);
  });
});

describe('races', () => {
  const slow = (wait: Promise<void>, operations: ProposedOperation[]): Planner => ({
    name: 'slow',
    async plan() {
      await wait;
      return { origin: 'model', operations, meta: { planner: 'slow', ms: 0 } } satisfies PlanResult;
    },
  });
  const suggestion: ProposedOperation = {
    change: {
      kind: 'collection',
      surface: 'macros',
      op: 'add',
      item: 'emphasis',
      value: { label: 'Emphasis', steps: ['bold', 'italic'] },
    },
    evidence: [{ action: 'bold', metric: 'uses' }],
  };

  it('discards a plan that comes back after the person forgot everything or reset', async () => {
    for (const forget of ['clearData', 'reset'] as const) {
      const wait = gate();
      const store = memoryStore();
      const client = createUitive({
        contract: editor,
        now: () => 0,
        store,
        planner: slow(wait.promise, [suggestion]),
      });
      client.record('bold');
      const inFlight = client.plan();
      client[forget]();
      wait.open();
      const plan = await inFlight;
      expect(plan.applied).toEqual([]);
      expect(client.surface('macros').suggestions).toEqual([]);
      expect(client.getSnapshot().adaptations.map((entry) => entry.kind)).not.toContain('plan');
    }
  });

  it('discards an answer that comes back after a reset', async () => {
    const wait = gate();
    const client = createUitive({
      contract: editor,
      now: () => 0,
      planner: slow(wait.promise, [{ ...suggestion, scope: 'explicit' }]),
    });
    const asked = client.ask('give me an emphasis macro');
    client.reset();
    wait.open();
    const answer = await asked;
    expect(answer.status).toBe('not_allowed');
    expect(answer.rejected[0]?.message).toBe(
      'Your interface changed while this was answered; ask again',
    );
    expect(client.surface('macros').items).toEqual([]);
  });

  it('shares one plan between overlapping calls, and counts a session’s plans once', async () => {
    const weak = answering([
      {
        change: { kind: 'list', surface: 'toolbar', op: 'promote', target: 'table' },
        evidence: [{ action: 'table', metric: 'viaOverflow' }],
      },
    ]);
    const plan = vi.fn(weak.plan);
    const client = createUitive({ contract: editor, now: () => 0, planner: { ...weak, plan } });
    client.record('table', { via: 'overflow' });
    client.nextSession();
    const [first, second] = await Promise.all([client.plan(), client.plan()]);
    expect(plan).toHaveBeenCalledOnce();
    expect(second).toBe(first);
    // Planning again in the same session proves nothing: the change still waits.
    await client.plan();
    expect(client.getSnapshot().pending.map((entry) => entry.held)).toEqual([true]);
    expect(client.nextSession()).toBeUndefined();
    await client.plan();
    expect(client.getSnapshot().pending.map((entry) => entry.held)).toEqual([false]);
  });
});

describe('heuristic plans across tabs', () => {
  it('apply once a new session starts in any tab', async () => {
    const tab = tabs();
    let time = 0;
    const first = createUitive({
      contract: editor,
      now: () => time,
      store: tab(),
      planner: heuristicPlanner(),
    });
    for (let session = 0; session < 3; session++) {
      first.record('table', { via: 'overflow' });
      first.record('table', { via: 'overflow' });
      first.nextSession();
    }
    await first.plan();
    first.flush();
    time += 45 * MINUTE;
    const second = createUitive({ contract: editor, now: () => time, store: tab() });
    expect(second.surface('toolbar').visible.map((view) => view.id)).toContain('table');
  });
});
