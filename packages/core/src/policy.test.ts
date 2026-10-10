import { describe, expect, it } from 'vitest';
import { editor } from './__fixtures__/editor.js';
import { emptyEditor, operation, summaryOf, type Use } from './__fixtures__/usage.js';
import {
  resolveList,
  type AppliedOperation,
  type Change,
  type Definition,
  type Operation,
} from './definition.js';
import { canonical, canonicalKey, check, checkStored } from './policy.js';
import { random } from './simulate.js';
import { applyOperation } from './stabilizer.js';

const tableUse: Use[] = [
  ['table', 'overflow', 3],
  ['table', 'overflow', 4],
  ['table', 'region', 5],
];

function run(
  operations: Operation[],
  definition: Definition = emptyEditor(),
  uses: Use[] = tableUse,
  intent?: string,
) {
  return check(operations, {
    contract: editor,
    definition,
    summary: summaryOf(uses, { definition }),
    session: 5,
    ...(intent === undefined ? {} : { intent }),
  });
}

const promoteTable: Change = { kind: 'list', surface: 'toolbar', op: 'promote', target: 'table' };

describe('check', () => {
  it('resolves IDs case-insensitively, and rejects unknown ones', () => {
    const result = run([
      operation(
        { kind: 'list', surface: 'TOOLBAR', op: 'promote', target: 'Table' },
        {
          evidence: [{ action: 'TABLE', metric: 'uses', value: 0 }],
        },
      ),
      operation({ kind: 'list', surface: 'toolbar', op: 'promote', target: 'teleport' }),
      operation({ kind: 'list', surface: 'sidebar', op: 'promote', target: 'table' }),
    ]);
    expect(result.accepted[0]?.change).toEqual(promoteTable);
    expect(result.rejected.map((entry) => entry.rule)).toEqual(['unknown', 'unknown']);
  });

  it('never lets anyone hide a required item', () => {
    const result = run([
      operation(
        { kind: 'list', surface: 'toolbar', op: 'demote', target: 'share' },
        {
          evidence: [{ action: 'share', metric: 'idleSessions', value: 9 }],
        },
      ),
      operation(
        { kind: 'list', surface: 'toolbar', op: 'hide', target: 'share' },
        { origin: 'user' },
      ),
    ]);
    expect(result.rejected.map((entry) => entry.rule)).toEqual(['required', 'required']);
    expect(result.rejected[1]?.message).toBe('Share is required by this application');
  });

  it('keeps pinning, hiding and reordering for the user', () => {
    const result = run([
      operation({ kind: 'list', surface: 'toolbar', op: 'pin', target: 'table' }),
      operation(
        { kind: 'list', surface: 'toolbar', op: 'move', target: 'bold', index: 2 },
        { origin: 'user' },
      ),
    ]);
    expect(result.rejected.map((entry) => entry.rule)).toEqual(['kind', 'kind']);
  });

  it('lets the user layer outrank the model', () => {
    let definition = emptyEditor();
    const pin = operation(
      { kind: 'list', surface: 'toolbar', op: 'pin', target: 'bold' },
      { origin: 'user' },
    );
    definition = applyOperation(definition, pin, {
      contract: editor,
      summary: summaryOf([]),
      session: 5,
      adaptation: 'a',
    });
    const result = run(
      [
        operation(
          { kind: 'list', surface: 'toolbar', op: 'demote', target: 'bold' },
          {
            evidence: [{ action: 'bold', metric: 'idleSessions', value: 9 }],
          },
        ),
      ],
      definition,
    );
    expect(result.rejected[0]?.rule).toBe('precedence');
  });

  it('stops planners when frozen, during a cooldown, and once blocked', () => {
    const frozen = run([operation(promoteTable)], { ...emptyEditor(), frozen: true });
    const cooling = run([operation(promoteTable)], {
      ...emptyEditor(),
      cooldowns: [{ key: 'toolbar||promote|table', until: 9 }],
    });
    const blocked = run([operation(promoteTable)], {
      ...emptyEditor(),
      blocked: ['toolbar||promote|table'],
    });
    expect([frozen, cooling, blocked].map((result) => result.rejected[0]?.rule)).toEqual([
      'frozen',
      'cooldown',
      'blocked',
    ]);
    expect(
      run([operation(promoteTable, { origin: 'user' })], { ...emptyEditor(), frozen: true })
        .accepted,
    ).toHaveLength(1);
  });

  it('takes every number from the summary, whatever the planner claimed', () => {
    const result = run([
      operation(promoteTable, {
        evidence: [{ action: 'table', metric: 'viaOverflow', value: 1000 }],
      }),
    ]);
    expect(result.accepted[0]?.evidence).toEqual([
      { action: 'table', metric: 'viaOverflow', value: 2, window: 6 },
    ]);
  });

  it('requires evidence that supports the change', () => {
    const unused = run([
      operation({ kind: 'list', surface: 'toolbar', op: 'promote', target: 'image' }),
    ]);
    expect(unused.rejected[0]?.rule).toBe('evidence');

    const used = [...tableUse, ['bold', 'region', 0] as Use];
    const early = run(
      [
        operation(
          { kind: 'list', surface: 'toolbar', op: 'demote', target: 'italic' },
          {
            evidence: [{ action: 'italic', metric: 'idleSessions', value: 0 }],
          },
        ),
      ],
      emptyEditor(),
      [
        ['italic', 'region', 3],
        ['bold', 'region', 4],
      ],
    );
    expect(early.rejected[0]?.message).toMatch(/Not unused for 3 sessions/);
    const idle = run(
      [
        operation(
          { kind: 'list', surface: 'toolbar', op: 'demote', target: 'italic' },
          {
            evidence: [{ action: 'italic', metric: 'idleSessions', value: 0 }],
          },
        ),
      ],
      emptyEditor(),
      used,
    );
    expect(idle.accepted).toHaveLength(1);
  });

  it('accepts a stated goal as evidence only when there is one, quoting it exactly', () => {
    const claim = operation(
      { kind: 'list', surface: 'toolbar', op: 'promote', target: 'image' },
      {
        evidence: [{ intent: 'anything the model says' }],
      },
    );
    expect(run([claim]).rejected[0]?.rule).toBe('evidence');
    const result = run([claim], emptyEditor(), [], 'I add lots of pictures');
    expect(result.accepted[0]?.evidence).toEqual([{ intent: 'I add lots of pictures' }]);
  });

  it('changes choices only on a stated preference', () => {
    const set: Change = { kind: 'choice', surface: 'density', op: 'set', value: 'COMPACT' };
    expect(run([operation(set)]).rejected[0]?.rule).toBe('evidence');
    const result = run(
      [operation(set, { evidence: [{ intent: '' }] })],
      emptyEditor(),
      [],
      'denser please',
    );
    expect(result.accepted[0]?.change).toEqual({ ...set, value: 'compact' });
  });

  it('validates generated items against the schema, length caps and the application', () => {
    const add = (label: string, steps: string[], origin: Operation['origin'] = 'model') =>
      operation(
        { kind: 'collection', surface: 'macros', op: 'add', item: label, value: { label, steps } },
        { origin, evidence: [{ action: 'bold', metric: 'uses', value: 0 }] },
      );
    const result = run(
      [
        add('One step', ['bold']),
        add('Unknown', ['bold', 'teleport']),
        add('x'.repeat(81), ['bold', 'italic']),
        add('Emphasis', ['bold', 'italic'], 'user'),
      ],
      emptyEditor(),
      [['bold', 'region', 5]],
    );
    expect(result.rejected.map((entry) => entry.message)).toEqual([
      'A macro needs at least two steps',
      'Macros may only use known actions',
      'Titles need 1 to 80 characters',
    ]);
    expect(result.accepted).toHaveLength(1);
    const update = operation(
      {
        kind: 'collection',
        surface: 'macros',
        op: 'update',
        item: 'Emphasis',
        value: { label: 'x', steps: [] },
      },
      { evidence: [{ action: 'bold', metric: 'uses', value: 0 }] },
    );
    expect(run([update]).rejected[0]?.rule).toBe('kind');
  });

  it('keeps short plain notes and drops ones with numbers', () => {
    const notes = ['Fits how you format reports', 'Used 9 of 10 times', 'x'.repeat(141)].map(
      (note) => run([operation(promoteTable, { note })]).accepted[0]?.note,
    );
    expect(notes).toEqual(['Fits how you format reports', undefined, undefined]);
  });

  it('rejects changes that change nothing', () => {
    const result = run([
      operation({ kind: 'list', surface: 'toolbar', op: 'promote', target: 'bold' }),
      operation(
        { kind: 'list', surface: 'toolbar', op: 'demote', target: 'print' },
        {
          evidence: [{ action: 'print', metric: 'idleSessions', value: 9 }],
        },
      ),
    ]);
    expect(result.rejected.map((entry) => entry.rule)).toEqual(['noop', 'noop']);
  });

  it('refuses a pin when every visible slot is pinned or required', () => {
    let definition = emptyEditor();
    for (const target of ['bold', 'italic', 'underline', 'strike', 'heading']) {
      definition = applyOperation(
        definition,
        operation({ kind: 'list', surface: 'toolbar', op: 'pin', target }, { origin: 'user' }),
        { contract: editor, summary: summaryOf([]), session: 5, adaptation: 'a' },
      );
    }
    const result = run(
      [
        operation(
          { kind: 'list', surface: 'toolbar', op: 'pin', target: 'table' },
          { origin: 'user' },
        ),
      ],
      definition,
    );
    expect(result.rejected[0]?.rule).toBe('capacity');
  });

  it('never hides a required item, whatever a planner proposes', () => {
    const draw = random(7);
    const toolbar = editor.surfaces.toolbar.items;
    const ops = ['promote', 'demote', 'pin', 'unpin', 'hide', 'restore'] as const;
    for (let round = 0; round < 40; round++) {
      let definition = emptyEditor();
      const uses: Use[] = toolbar.map((action, index) => [action, 'region', index % 6]);
      for (let step = 0; step < 25; step++) {
        const target = toolbar[Math.floor(draw() * toolbar.length)] as string;
        const op = ops[Math.floor(draw() * ops.length)] as (typeof ops)[number];
        const origin = draw() < 0.5 ? 'user' : 'model';
        const summary = summaryOf(uses, { definition });
        const result = check(
          [
            operation(
              { kind: 'list', surface: 'toolbar', op, target },
              {
                origin,
                evidence: [
                  { action: target, metric: op === 'demote' ? 'idleSessions' : 'uses', value: 0 },
                ],
              },
            ),
          ],
          { contract: editor, definition, summary, session: 5 },
        );
        for (const accepted of result.accepted) {
          definition = applyOperation(definition, accepted, {
            contract: editor,
            summary,
            session: 5,
            adaptation: 'a',
          });
        }
        const state = resolveList(editor, definition, 'toolbar');
        expect(state.visible.has('share')).toBe(true);
        expect(state.visible.size).toBeLessThanOrEqual(6);
      }
    }
  });

  it('caps a collection at its max, whoever adds to it', () => {
    const add = (label: string) =>
      operation(
        {
          kind: 'collection',
          surface: 'macros',
          op: 'add',
          item: label,
          value: { label, steps: ['bold', 'italic'] },
        },
        { origin: 'user' },
      );
    let definition = emptyEditor();
    for (const label of ['One', 'Two']) {
      definition = applyOperation(definition, add(label), {
        contract: editor,
        summary: summaryOf([]),
        session: 5,
        adaptation: 'a',
      });
    }
    expect(run([add('Three')], definition).rejected[0]).toMatchObject({
      rule: 'capacity',
      message: 'Macros holds at most 2',
    });
  });

  it('never takes the item that makes room from a proposal', () => {
    const change = canonical({ ...promoteTable, evict: 'share' }, editor);
    expect(change).toEqual(promoteTable);
  });

  it('keeps a model’s reading of words from deleting pages or bringing back blocked changes', () => {
    const named = (change: Change) => operation(change, { origin: 'user' });
    const blocked = { ...emptyEditor(), blocked: ['toolbar||promote|table'] };
    const read = check([named(promoteTable)], {
      contract: editor,
      definition: blocked,
      summary: summaryOf(tableUse),
      session: 5,
      interpreted: true,
    });
    expect(read.rejected[0]).toMatchObject({ rule: 'blocked' });
    const typed = check([named({ kind: 'list', surface: 'toolbar', op: 'pin', target: 'table' })], {
      contract: editor,
      definition: blocked,
      summary: summaryOf(tableUse),
      session: 5,
      interpreted: true,
    });
    expect(typed.accepted).toHaveLength(1);

    const created = applyOperation(
      emptyEditor(),
      operation(
        {
          kind: 'userPage',
          surface: 'userPages',
          op: 'create',
          slug: 'morning',
          title: 'Morning',
          value: {
            root: 'root',
            elements: [
              { id: 'root', block: 'section', props: { title: '', layout: 'stack' }, children: [] },
            ],
            data: [],
          } as never,
        },
        { origin: 'user' },
      ),
      { contract: editor, summary: summaryOf([]), session: 5, adaptation: 'a' },
    );
    const remove = named({ kind: 'userPage', surface: 'userPages', op: 'delete', slug: 'morning' });
    const context = { contract: editor, definition: created, summary: summaryOf([]), session: 5 };
    expect(check([remove], { ...context, interpreted: true }).rejected[0]).toMatchObject({
      rule: 'kind',
      message: 'Delete your page morning yourself, from Your interface',
    });
    expect(check([remove], context).accepted).toHaveLength(1);
  });

  it('takes a blank goal for no goal at all', () => {
    const set: Change = { kind: 'choice', surface: 'density', op: 'set', value: 'compact' };
    const claim = operation(set, { evidence: [{ intent: '' }] });
    expect(run([claim], { ...emptyEditor(), goal: '   ' }).rejected[0]?.rule).toBe('evidence');
  });
});

describe('checkStored', () => {
  let counter = 0;
  const stored = (
    change: Change,
    options: Partial<Pick<AppliedOperation, 'origin' | 'status'>> = {},
  ): AppliedOperation => ({
    ...operation(change, { origin: options.origin ?? 'user' }),
    id: `s${++counter}`,
    status: options.status ?? 'active',
    session: 0,
    adaptation: 'a',
  });
  const macro = (item: string, steps = ['bold', 'italic']): Change => ({
    kind: 'collection',
    surface: 'macros',
    op: 'add',
    item,
    value: { label: item, steps },
  });

  it('holds stored changes to every rule that needs no state, in order', () => {
    const result = checkStored(
      [
        stored(macro('one')),
        stored(macro('bad', ['bold'])),
        stored(macro('two')),
        stored(macro('three')),
        stored({ ...macro('nope'), op: 'update' } as Change),
        stored({ kind: 'list', surface: 'toolbar', op: 'hide', target: 'share' }),
        stored({ kind: 'list', surface: 'TOOLBAR', op: 'pin', target: 'Table', evict: 'BOLD' }),
        stored(
          { kind: 'list', surface: 'toolbar', op: 'pin', target: 'table' },
          { origin: 'model' },
        ),
        stored(promoteTable, { status: 'suggested', origin: 'model' }),
      ],
      editor,
    );
    expect(result.rejected.map((entry) => entry.rule)).toEqual([
      'validator',
      'capacity',
      'noop',
      'required',
      'kind',
      'kind',
    ]);
    expect(result.accepted.map((entry) => entry.change)).toEqual([
      macro('one'),
      macro('two'),
      { kind: 'list', surface: 'toolbar', op: 'pin', target: 'table', evict: 'bold' },
    ]);
  });

  it('spells operation keys the contract’s way, and drops ones naming nothing', () => {
    expect(canonicalKey('TOOLBAR||promote|Table', editor)).toBe('toolbar||promote|table');
    expect(canonicalKey('density||set|COMPACT', editor)).toBe('density||set|compact');
    expect(canonicalKey('toolbar||promote|teleport', editor)).toBeUndefined();
    expect(canonicalKey('sidebar||promote|table', editor)).toBeUndefined();
    expect(canonicalKey('toolbar||launch|table', editor)).toBeUndefined();
  });
});
