import { describe, expect, it, vi } from 'vitest';
import { editor } from './__fixtures__/editor.js';
import { payments } from './__fixtures__/payments.js';
import { createUitive, type Uitive } from './client.js';
import { action, defineApp, list } from './contract.js';
import { KEEP_FINISHED } from './definition.js';
import { heuristicPlanner } from './heuristic.js';
import { ui } from './page.js';
import { remotePlanner, type Planner, type ProposedOperation } from './planner.js';
import { memoryStore } from './storage.js';

const answering = (operations: ProposedOperation[]): Planner => ({
  name: 'model',
  async plan() {
    return { origin: 'model', operations, meta: { planner: 'model', ms: 0 } };
  },
});

const MINUTE = 60_000;

function clock(start = 0) {
  let time = start;
  return { now: () => time, advance: (minutes: number) => (time += minutes * MINUTE) };
}

const ids = (views: readonly { id: string }[]) => views.map((view) => view.id);

/** Uses `table` from overflow across sessions until the heuristic wants it on the toolbar. */
async function earnTable(client: Uitive<typeof editor>) {
  for (let session = 0; session < 3; session++) {
    client.record('table', { via: 'overflow' });
    client.record('table', { via: 'overflow' });
    client.record('bold');
    client.nextSession();
  }
  return client.plan();
}

describe('sessions', () => {
  it('splits sessions lazily, and never applies changes on the first interaction after idle', async () => {
    const time = clock();
    const client = createUitive({ contract: editor, now: time.now });
    await earnTable(client);
    expect(client.getSnapshot().pending).toHaveLength(1);

    time.advance(31);
    client.record('bold');
    expect(client.getSnapshot().session).toBe(4);
    expect(ids(client.surface('toolbar').visible)).not.toContain('table');
    expect(client.getSnapshot().pending).toHaveLength(1);

    time.advance(31);
    const applied = client.resume();
    expect(applied?.applied).toHaveLength(1);
    expect(ids(client.surface('toolbar').visible)).toContain('table');
  });

  it('applies pending changes at page start, before anything renders', async () => {
    const time = clock();
    const store = memoryStore();
    const first = createUitive({ contract: editor, now: time.now, store });
    await earnTable(first);
    first.flush();

    time.advance(45);
    const second = createUitive({ contract: editor, now: time.now, store });
    expect(ids(second.surface('toolbar').visible)).toContain('table');
    expect(second.getSnapshot().latest?.kind).toBe('apply');
  });
});

describe('plan and apply', () => {
  it('stages a plan and applies it at the next session, explaining it with numbers true then', async () => {
    const client = createUitive({ contract: editor, now: clock().now });
    const plan = await earnTable(client);
    expect(plan.pending).toBe(1);
    expect(ids(client.surface('toolbar').visible)).not.toContain('table');

    const applied = client.nextSession();
    const operation = applied?.applied[0] as string;
    expect(ids(client.surface('toolbar').visible)).toContain('table');
    expect(client.surface('toolbar').visible.find((view) => view.id === 'table')?.moved).toBe(true);
    expect(client.explain(operation)).toEqual({
      title: 'Insert table added to Toolbar',
      reason:
        'Insert table was used in 3 of your last 5 sessions; you opened Insert table from overflow 6 times; Heading moved to overflow to make room, since it went unused for 3 sessions.',
    });
  });

  it('keeps surface values identical between unrelated updates', () => {
    const client = createUitive({ contract: editor, now: clock().now });
    const before = client.surface('toolbar');
    const listener = vi.fn();
    client.subscribe(listener);
    client.record('bold');
    expect(listener).toHaveBeenCalledOnce();
    expect(client.surface('toolbar')).toBe(before);
    client.hide('toolbar', 'bold');
    expect(client.surface('toolbar')).not.toBe(before);
  });

  it('lets the user revert, which cools the change down, or keep it', async () => {
    const client = createUitive({ contract: editor, now: clock().now });
    await earnTable(client);
    const operation = client.nextSession()?.applied[0] as string;
    client.revert(operation);
    expect(ids(client.surface('toolbar').visible)).not.toContain('table');
    expect(client.getSnapshot().definition.cooldowns).toHaveLength(1);

    await client.plan();
    expect(client.getSnapshot().latest?.rejected.map((entry) => entry.rule)).toEqual(['cooldown']);

    const other = createUitive({ contract: editor, now: clock().now });
    await earnTable(other);
    const kept = other.nextSession()?.applied[0] as string;
    other.keep(kept);
    expect(
      other.getSnapshot().definition.operations.find((entry) => entry.id === kept)?.status,
    ).toBe('kept');
  });

  it('applies nothing on its own in suggest mode, until the user accepts', async () => {
    const client = createUitive({ contract: editor, now: clock().now, autonomy: 'suggest' });
    await earnTable(client);
    expect(client.nextSession()).toBeUndefined();
    const waiting = client.getSnapshot().pending[0]?.id as string;
    expect(client.accept(waiting)).toBe(true);
    expect(ids(client.surface('toolbar').visible)).toContain('table');
    // Saying yes makes the change the person's own.
    expect(client.request('plan').state.user).toEqual(['toolbar||promote|table']);
  });

  it('learns from use once a session, across reloads and overlapping calls', async () => {
    const time = clock();
    const store = memoryStore();
    const base = heuristicPlanner();
    const counting: Planner = { name: 'counting', plan: vi.fn(base.plan) };
    const first = createUitive({ contract: editor, now: time.now, store, planner: counting });
    await Promise.all([first.learn(), first.learn()]);
    expect(counting.plan).toHaveBeenCalledOnce();
    first.flush();

    const reloaded = createUitive({ contract: editor, now: time.now, store, planner: counting });
    expect(await reloaded.learn()).toBeUndefined();
    expect(counting.plan).toHaveBeenCalledOnce();

    reloaded.nextSession();
    expect(await reloaded.learn()).toMatchObject({ kind: 'plan' });
    expect(counting.plan).toHaveBeenCalledTimes(2);
  });

  it('learns nothing while frozen, or when the application turns learning off', async () => {
    const counting: Planner = { name: 'counting', plan: vi.fn(heuristicPlanner().plan) };
    const frozen = createUitive({ contract: editor, now: clock().now, planner: counting });
    frozen.freeze(true);
    expect(await frozen.learn()).toBeUndefined();
    const off = createUitive({
      contract: editor,
      now: clock().now,
      planner: counting,
      learn: false,
    });
    expect(await off.learn()).toBeUndefined();
    expect(counting.plan).not.toHaveBeenCalled();
    expect(await off.plan()).toMatchObject({ kind: 'plan' });
  });

  it('shows the standard interface on request, without losing the definition', () => {
    const client = createUitive({ contract: editor, now: clock().now });
    client.hide('toolbar', 'bold');
    client.setView('standard');
    expect(ids(client.surface('toolbar').visible)).toContain('bold');
    client.setView('yours');
    expect(ids(client.surface('toolbar').visible)).not.toContain('bold');
  });
});

describe('commands', () => {
  it('brings an item in from overflow when asked to move it, and undoes a hide when asked to show it', async () => {
    const notes = defineApp({
      id: 'notes',
      description: 'A notes editor',
      actions: {
        bold: action({ label: 'Bold', description: 'Bold text' }),
        italic: action({ label: 'Italic', description: 'Italic text' }),
        share: action({ label: 'Share', description: 'Share the note' }),
        table: action({ label: 'Table', description: 'Insert a table' }),
      },
      surfaces: {
        toolbar: list({
          label: 'Toolbar',
          description: 'Formatting',
          items: ['bold', 'italic', 'share', 'table'],
          capacity: 3,
          reorderable: true,
        }),
      },
    });
    const client = createUitive({ contract: notes, now: clock().now });
    expect((await client.ask('move Table to the top')).status).toBe('done');
    expect(ids(client.surface('toolbar').visible)).toEqual(['table', 'bold', 'italic']);

    await client.ask('hide Bold');
    expect(ids(client.surface('toolbar').visible)).not.toContain('bold');
    expect((await client.ask('show Bold')).status).toBe('done');
    expect(ids(client.surface('toolbar').visible)).toContain('bold');
    // The hide was undone, not covered by a pin that Revert would leave behind.
    const pins = client
      .getSnapshot()
      .definition.operations.filter(
        (entry) =>
          entry.change.kind === 'list' &&
          entry.change.op === 'pin' &&
          entry.change.target === 'bold',
      );
    expect(pins).toHaveLength(0);
  });

  it('applies explicit commands at once, and explains refusals from policy', async () => {
    const client = createUitive({ contract: editor, now: clock().now });
    const hidden = await client.ask('hide bold');
    expect(hidden.status).toBe('done');
    expect(ids(client.surface('toolbar').visible)).not.toContain('bold');
    expect(client.explain(hidden.applied[0] as string)?.reason).toBe('You asked: “hide bold”.');

    // Share is required on the toolbar but not in the File menu: hidden there, refused here.
    const partly = await client.ask('hide share');
    expect(partly.status).toBe('partial');
    expect(partly.applied).toHaveLength(1);
    expect(partly.rejected.map((entry) => entry.message)).toEqual([
      'Share is required by this application',
    ]);
    expect(ids(client.surface('file').visible)).not.toContain('share');
    expect((await client.ask('hide share')).status).toBe('not_allowed');

    expect((await client.ask('compact')).status).toBe('done');
    expect(client.surface('density')).toBe('compact');

    const unclear = await client.ask('hide export');
    expect(unclear.status).toBe('ambiguous');
    expect(unclear.candidates).toEqual(['Export PDF', 'Export CSV']);
  });

  it('keeps one choice per setting, so changes don\u2019t pile up', () => {
    const client = createUitive({ contract: editor, now: () => 0 });
    client.set('density', 'compact');
    client.set('density', 'comfortable');
    client.set('density', 'compact');
    const choices = client
      .getSnapshot()
      .definition.operations.filter((operation) => operation.change.kind === 'choice');
    expect(choices).toHaveLength(1);
    expect(client.surface('density')).toBe('compact');
    client.revert(choices[0]?.id ?? '');
    expect(client.surface('density')).toBe('comfortable');
  });

  it('undoes a hide or a pin by reverting it, rather than stacking an opposite change', async () => {
    const client = createUitive({ contract: editor, now: () => 0 });
    const toolbar = () => client.surface('toolbar');
    const standard = toolbar();
    const shown = standard.visible.find((view) => view.id !== 'bold')?.id;
    const spare = standard.overflow[0]?.id;
    if (!shown || !spare) throw new Error('The fixture needs a visible item and an overflow one');
    const lists = () =>
      client
        .getSnapshot()
        .definition.operations.filter((operation) => operation.change.kind === 'list')
        .map((operation) => [
          operation.change.kind === 'list' && operation.change.op,
          operation.status,
        ]);

    client.hide('toolbar', shown);
    const undo = client.restore('toolbar', shown);
    expect(undo.applied).toEqual([]);
    expect(toolbar()).toEqual(standard);
    expect(lists()).toEqual([['hide', 'reverted']]);
    // Reverting the undo changes nothing: there is nothing left to bring back.
    client.revertAdaptation(undo.id);
    expect(toolbar()).toEqual(standard);

    client.pin('toolbar', spare);
    expect(toolbar().visible.map((view) => view.id)).toContain(spare);
    await client.ask(`unpin ${client.contract.actions[spare].label}`);
    expect(toolbar()).toEqual(standard);
    expect(lists()).toEqual([
      ['hide', 'reverted'],
      ['pin', 'reverted'],
    ]);
  });

  it('keeps a stated goal and lets the planner act on it', async () => {
    const client = createUitive({ contract: editor, now: clock().now });
    const result = await client.ask('I insert tables and images', { goal: true });
    expect(client.getSnapshot().definition.goal).toBe('I insert tables and images');
    expect(result.status).toBe('done');
    expect(ids(client.surface('toolbar').visible)).toEqual(
      expect.arrayContaining(['table', 'image']),
    );
  });

  it('falls back to the local planner, recording why, when the server fails', async () => {
    const planner = remotePlanner({
      url: 'https://planner.test/uitive',
      fetch: async () => {
        throw new Error('offline');
      },
      fallback: heuristicPlanner(),
    });
    const onError = vi.fn();
    const client = createUitive({ contract: editor, now: clock().now, planner, onError });
    const goal = await client.ask('I insert tables and images', { goal: true });
    expect(goal.meta?.fellBack).toBe('offline');
    expect(onError).toHaveBeenCalledWith(new Error('offline'));
    expect(goal.status).toBe('done');
    // A redesign request needs the model; offline, the answer says so instead of guessing.
    const redesign = await client.ask('make my toolbar about writing reports');
    expect(redesign.status).toBe('unavailable');
    expect(redesign.applied).toHaveLength(0);
  });

  it('turns suggested items into accepted ones, or dismisses them', async () => {
    const suggesting: Planner = {
      name: 'test',
      async plan() {
        return {
          origin: 'model',
          operations: [
            {
              change: {
                kind: 'collection',
                surface: 'macros',
                op: 'add',
                item: 'emphasis',
                value: { label: 'Emphasis', steps: ['bold', 'italic'] },
              },
              evidence: [{ action: 'bold', metric: 'uses' }],
            },
          ],
          meta: { planner: 'test', ms: 0 },
        };
      },
    };
    const client = createUitive({ contract: editor, now: clock().now, planner: suggesting });
    client.record('bold');
    const plan = await client.plan();
    expect(client.surface('macros').suggestions.map((entry) => entry.title)).toEqual(['Emphasis']);
    expect(client.accept(plan.applied[0] as string)).toBe(true);
    expect(client.surface('macros').items.map((entry) => entry.title)).toEqual(['Emphasis']);
    expect(client.request('plan').state.user).toEqual(['macros||add|emphasis']);

    // A person who lets the interface act on its own gets new items at once.
    const trusting = createUitive({ contract: editor, now: clock().now, planner: suggesting });
    trusting.setAutonomy('auto');
    await trusting.plan();
    expect(trusting.surface('macros').items.map((entry) => entry.title)).toEqual(['Emphasis']);
  });
});

describe('ownership', () => {
  it('exports a definition another client can import', async () => {
    const source = createUitive({ contract: editor, now: clock().now });
    source.hide('toolbar', 'bold');
    source.pin('toolbar', 'print');
    source.set('density', 'compact');
    const target = createUitive({ contract: editor, now: clock().now });
    const imported = target.import(JSON.parse(JSON.stringify(source.export())));
    expect(imported.applied).toHaveLength(3);
    expect(target.surface('toolbar')).toEqual(source.surface('toolbar'));
    expect(target.surface('density')).toBe('compact');
    expect(target.import({ format: 'something else' }).status).toBe('not_allowed');
  });

  it('resets to the standard interface but keeps usage; clearing forgets everything', async () => {
    const client = createUitive({ contract: editor, now: clock().now });
    await earnTable(client);
    client.revert(client.nextSession()?.applied[0] as string);
    client.record('table', { via: 'overflow' });
    client.hide('toolbar', 'bold');
    client.freeze(true);
    client.setGoal('I write reports');
    client.reset();
    expect(ids(client.surface('toolbar').visible)).toContain('bold');
    expect(client.summary().rows.some((row) => row.action === 'table')).toBe(true);
    // What the person decided about planners outlasts the layout.
    const definition = client.getSnapshot().definition;
    expect(definition.operations).toEqual([]);
    expect(definition).toMatchObject({ frozen: true, goal: 'I write reports' });
    expect(definition.cooldowns.map((entry) => entry.key)).toEqual(['toolbar||promote|table']);
    client.clearData();
    expect(client.summary().rows.some((row) => row.action === 'table')).toBe(false);
  });

  it('freezes the interface against planners', async () => {
    const client = createUitive({ contract: editor, now: clock().now });
    client.freeze(true);
    const plan = await earnTable(client);
    expect(plan.pending).toBe(0);
    expect(plan.rejected.map((entry) => entry.rule)).toEqual(['frozen']);
  });
});

describe('what a model may do with words', () => {
  it('never deletes the person’s pages, nor brings back a change they blocked', async () => {
    const client = createUitive({
      contract: payments,
      now: () => 0,
      planner: answering([
        {
          change: { kind: 'userPage', surface: 'userPages', op: 'delete', slug: 'morning' },
          evidence: [{ intent: true }],
          scope: 'explicit',
        },
      ]),
    });
    client.createPage('Morning');
    const answer = await client.ask('make the home page calmer');
    expect(answer.status).toBe('not_allowed');
    expect(answer.rejected[0]?.message).toBe(
      'Delete your page morning yourself, from Your interface',
    );
    expect(client.userPages().map((entry) => entry.slug)).toEqual(['morning']);

    const blocked = createUitive({
      contract: editor,
      now: () => 0,
      planner: answering([
        {
          change: { kind: 'list', surface: 'toolbar', op: 'promote', target: 'table' },
          evidence: [],
          scope: 'explicit',
        },
        {
          change: { kind: 'list', surface: 'toolbar', op: 'hide', target: 'share' },
          evidence: [],
          scope: 'explicit',
        },
        {
          change: { kind: 'choice', surface: 'density', op: 'set', value: 'compact' },
          evidence: [],
          scope: 'explicit',
        },
      ]),
    });
    blocked.import({
      format: 'uitive.definition',
      version: 1,
      contract: { id: 'editor', hash: '' },
      definition: { operations: [], blocked: ['toolbar||promote|table'], frozen: true },
    });
    const tidy = await blocked.ask('tidy my toolbar');
    expect(tidy.rejected.map((entry) => entry.rule)).toEqual(['blocked', 'required']);
    // A command applies at once, frozen or not: freeze stops planned changes only.
    expect(tidy.status).toBe('partial');
    expect(blocked.surface('density')).toBe('compact');
  });

  it('lets the person delete a page in plain words the deterministic planner reads', async () => {
    const client = createUitive({
      contract: payments,
      now: () => 0,
      planner: {
        name: 'local',
        async plan() {
          return {
            origin: 'heuristic',
            operations: [
              {
                change: { kind: 'userPage', surface: 'userPages', op: 'delete', slug: 'morning' },
                evidence: [{ intent: true }],
                scope: 'explicit',
              },
            ],
            meta: { planner: 'local', ms: 0 },
          };
        },
      },
    });
    client.createPage('Morning');
    expect((await client.ask('delete my morning page')).status).toBe('done');
    expect(client.userPages()).toEqual([]);
  });
});

describe('caps and goals', () => {
  const macro = (item: string): ProposedOperation => ({
    change: {
      kind: 'collection',
      surface: 'macros',
      op: 'add',
      item,
      value: { label: item, steps: ['bold', 'italic'] },
    },
    evidence: [{ action: 'bold', metric: 'uses' }],
  });

  it('never lets plans or commands overfill a collection', async () => {
    const plans = createUitive({
      contract: editor,
      now: () => 0,
      autonomy: 'auto',
      planner: answering([macro('one'), macro('two'), macro('three'), macro('four')]),
    });
    plans.record('bold');
    const plan = await plans.plan();
    expect(plans.surface('macros').items).toHaveLength(2);
    expect(plan.rejected.map((entry) => entry.rule)).toEqual(['capacity', 'capacity']);

    const commands = createUitive({
      contract: editor,
      now: () => 0,
      planner: answering(
        [macro('one'), macro('two'), macro('three')].map((entry) => ({
          ...entry,
          scope: 'explicit' as const,
        })),
      ),
    });
    expect((await commands.ask('make me some macros')).status).toBe('partial');
    expect(commands.surface('macros').items).toHaveLength(2);
  });

  it('takes a blank goal for none, and keeps goals short', async () => {
    const planner: Planner = answering([
      {
        change: { kind: 'choice', surface: 'density', op: 'set', value: 'compact' },
        evidence: [{ intent: true }],
      },
    ]);
    const plan = vi.fn(planner.plan);
    const client = createUitive({ contract: editor, now: () => 0, planner: { ...planner, plan } });
    client.setGoal('I want more on screen');
    expect((await client.ask('   ', { goal: true })).status).toBe('done');
    expect(client.getSnapshot().definition.goal).toBeUndefined();
    expect(plan).not.toHaveBeenCalled();
    expect((await client.plan()).rejected.map((entry) => entry.rule)).toEqual(['evidence']);

    client.setGoal(`  ${'x'.repeat(700)} `);
    expect(client.getSnapshot().definition.goal).toHaveLength(500);
    client.setGoal('   ');
    expect(client.getSnapshot().definition.goal).toBeUndefined();
  });
});

describe('history', () => {
  it('keeps one suggestion per page, however often plans repeat it', async () => {
    const value = ui.page(ui.section('Mine', 'stack', [ui.region('original')]));
    const client = createUitive({
      contract: payments,
      now: () => 0,
      planner: answering([
        {
          change: { kind: 'page', surface: 'customer', op: 'set', value },
          evidence: [{ intent: true }],
        },
      ]),
    });
    client.setGoal('I watch customers');
    for (let index = 0; index < 5; index++) await client.plan();
    const suggested = client
      .getSnapshot()
      .definition.operations.filter((entry) => entry.status === 'suggested');
    expect(suggested).toHaveLength(1);
  });

  it('compacts finished changes, keeping what a second revert needs', async () => {
    const client = createUitive({ contract: editor, now: () => 0 });
    await earnTable(client);
    const planned = client.nextSession()?.applied[0] as string;
    client.revert(planned);
    for (let index = 0; index < KEEP_FINISHED + 20; index++) {
      client.hide('toolbar', 'bold');
      client.restore('toolbar', 'bold');
    }
    const operations = client.getSnapshot().definition.operations;
    expect(operations.length).toBeLessThanOrEqual(KEEP_FINISHED + 1);
    expect(operations.some((entry) => entry.id === planned)).toBe(true);
  });

  it('knows where use happened, in the contract’s spelling', () => {
    const client = createUitive({ contract: editor, now: () => 0 });
    client.record('print', { via: 'overflow', surface: 'FILE' });
    client.record('print', { via: 'overflow', surface: 'nowhere' });
    expect(client.events().map((event) => event.surface)).toEqual(['file', undefined]);
  });

  it('counts a new context in the summary at once', () => {
    const client = createUitive({ contract: editor, now: () => 0 });
    client.setContext('tool', 'text');
    client.record('bold');
    client.nextSession();
    const contexts = () =>
      new Set(
        client
          .summary()
          .rows.filter((row) => row.surface === 'tableBar')
          .map((row) => row.context),
      );
    expect(contexts()).toEqual(new Set(['text']));
    client.setContext('tool', 'table');
    expect(contexts()).toEqual(new Set(['text', 'table']));
  });
});

describe('storage', () => {
  it('survives corrupt storage, reporting the problem', () => {
    const onError = vi.fn();
    const store = { load: () => JSON.parse('{oops'), save: () => {}, clear: () => {} };
    const client = createUitive({ contract: editor, store, onError });
    expect(onError).toHaveBeenCalled();
    expect(ids(client.surface('toolbar').visible)).toContain('bold');
  });

  it('keeps what still means something when the contract changes', () => {
    const store = memoryStore();
    const before = createUitive({ contract: editor, store, now: clock().now });
    before.pin('toolbar', 'print');
    before.pin('toolbar', 'image');
    before.record('print');
    before.flush();

    const after = defineApp({
      id: 'editor',
      description: 'A document editor',
      actions: {
        bold: action({ label: 'Bold', description: '' }),
        output: action({ label: 'Print', description: '', aliases: ['print'] }),
      },
      surfaces: {
        toolbar: list({
          label: 'Toolbar',
          description: '',
          items: ['bold', 'output'],
          capacity: 1,
        }),
      },
    });
    const client = createUitive({ contract: after, store, now: clock().now });
    expect(ids(client.surface('toolbar').visible)).toEqual(['output']);
    expect(client.getSnapshot().definition.operations).toHaveLength(1);
    expect(client.summary().rows.find((row) => row.action === 'output')?.uses).toBe(1);
  });
});

describe('tabs', () => {
  it('adopts state another tab saved', () => {
    // A shared store that tells every other tab about a write, as `storage` events do.
    let text: string | undefined;
    const watchers = new Set<() => void>();
    const tab = () => {
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
        watch(listener: () => void) {
          own = listener;
          watchers.add(listener);
          return () => watchers.delete(listener);
        },
      };
    };
    const first = createUitive({ contract: editor, store: tab(), now: clock().now });
    const second = createUitive({ contract: editor, store: tab(), now: clock().now });
    const listener = vi.fn();
    second.subscribe(listener);

    first.hide('toolbar', 'bold');
    first.flush();
    expect(listener).toHaveBeenCalled();
    expect(ids(second.surface('toolbar').visible)).not.toContain('bold');
  });
});

describe('request', () => {
  it('sends only IDs, statistics and the user’s own words', async () => {
    const client = createUitive({ contract: editor, now: clock().now });
    client.setContext('tool', 'table');
    client.record('table');
    const request = client.request('command', 'hide print');
    expect(Object.keys(request).sort()).toEqual([
      'contexts',
      'contract',
      'kind',
      'session',
      'state',
      'summary',
      'text',
    ]);
    expect(request.contract).toEqual({ id: 'editor', hash: editor.hash });
    expect(request.contexts).toEqual({ tool: 'table' });
    expect(JSON.stringify(request)).not.toContain('Insert table');
  });
});
