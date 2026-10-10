import { describe, expect, it } from 'vitest';
import { editor } from './__fixtures__/editor.js';
import { emptyEditor, operation, summaryOf, type Use } from './__fixtures__/usage.js';
import {
  emptyDefinition,
  operationKey,
  resolveList,
  type Change,
  type Definition,
  type Operation,
} from './definition.js';
import {
  applyOperation,
  DEFAULT_STABILIZER,
  evictFor,
  revert,
  settle,
  stage,
  type Pending,
} from './stabilizer.js';

const promote = (target: string): Change => ({
  kind: 'list',
  surface: 'toolbar',
  op: 'promote',
  target,
});

function pending(change: Change, strength = 5, session = 5): Pending {
  const base = operation(change);
  return {
    ...base,
    basedOn: { ...base.basedOn, session },
    key: operationKey(change),
    strength,
    held: false,
  };
}

const uses: Use[] = [
  ['table', 'overflow', 4],
  ['table', 'overflow', 5],
  ['image', 'overflow', 4],
  ['image', 'overflow', 5],
  ['link', 'overflow', 5],
  ['link', 'overflow', 5],
  ['bold', 'region', 5],
  ['italic', 'region', 5],
];

function settled(
  items: Pending[],
  definition: Definition = emptyEditor(),
  session = 5,
  usage = uses,
) {
  return settle(
    {
      contract: editor,
      definition,
      pending: items,
      summary: summaryOf(usage, { definition, session }),
      session,
      adaptation: 'a1',
    },
    DEFAULT_STABILIZER,
  );
}

describe('stage', () => {
  const model = (change: Change): Operation => operation(change);
  const options = (session: number) => ({ ...DEFAULT_STABILIZER, hysteresis: true, session });

  it('holds a weak model change until a plan in a later session proposes it', () => {
    const first = stage([model(promote('table'))], {}, [0.5], options(1));
    expect(first.pending[0]?.held).toBe(true);
    const second = stage([model(promote('table'))], first.seen, [0.5], options(2));
    expect(second.pending[0]?.held).toBe(false);
  });

  it('counts plans in one session once, so planning again proves nothing', () => {
    const first = stage([model(promote('table'))], {}, [0.5], options(1));
    const again = stage([model(promote('table'))], first.seen, [0.5], options(1));
    expect(again.pending[0]?.held).toBe(true);
    expect(again.seen).toEqual({ 'toolbar||promote|table': { count: 1, session: 1 } });
  });

  it('lets strong model changes and every heuristic change through at once', () => {
    expect(stage([model(promote('table'))], {}, [2], options(1)).pending[0]?.held).toBe(false);
    const heuristic = { ...model(promote('table')), origin: 'heuristic' as const };
    expect(stage([heuristic], {}, [0], options(1)).pending[0]?.held).toBe(false);
  });

  it('forgets changes a plan no longer proposes', () => {
    const first = stage([model(promote('table'))], {}, [0.5], options(1));
    const second = stage([model(promote('image'))], first.seen, [0.5], options(2));
    expect(second.seen).toEqual({ 'toolbar||promote|image': { count: 1, session: 2 } });
  });
});

describe('settle', () => {
  it('applies the strongest changes within the budget and keeps the rest pending', () => {
    const used: Use[] = [
      ...uses,
      ['print', 'overflow', 5],
      ['comment', 'overflow', 5, { tool: 'text' }],
    ];
    const result = settled(
      [
        pending(
          { kind: 'list', surface: 'tableBar', context: 'text', op: 'promote', target: 'comment' },
          1,
        ),
        pending(promote('table'), 3),
        pending({ kind: 'list', surface: 'file', op: 'promote', target: 'print' }, 2),
      ],
      emptyEditor(),
      5,
      used,
    );
    expect(
      result.applied.map((entry) => entry.change.kind === 'list' && entry.change.target),
    ).toEqual(['table', 'print']);
    expect(
      result.pending.map((entry) => entry.change.kind === 'list' && entry.change.target),
    ).toEqual(['comment']);
  });

  it('pushes at most one item out of view per surface at a time, counting evictions', () => {
    const result = settled([pending(promote('table'), 3), pending(promote('image'), 2)]);
    expect(
      result.applied.map((entry) => entry.change.kind === 'list' && entry.change.target),
    ).toEqual(['table']);
    expect(
      result.pending.map((entry) => entry.change.kind === 'list' && entry.change.target),
    ).toEqual(['image']);
  });

  it('demotes at most one item per surface at a time', () => {
    const idle: Use[] = [['bold', 'region', 0]];
    const definition = { ...emptyEditor(), goal: 'tidy up' };
    const result = settle(
      {
        contract: editor,
        definition,
        pending: [
          pending({ kind: 'list', surface: 'toolbar', op: 'demote', target: 'underline' }),
          pending({ kind: 'list', surface: 'toolbar', op: 'demote', target: 'strike' }),
        ].map((entry) => ({ ...entry, evidence: [{ intent: 'tidy up' }] })),
        summary: summaryOf(idle, { definition }),
        session: 5,
        adaptation: 'a1',
      },
      DEFAULT_STABILIZER,
    );
    expect(result.applied).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
  });

  it('fixes which item made room: the least used, then the last in standard order', () => {
    const result = settled([pending(promote('table'))]);
    const change = result.applied[0]?.change;
    expect(change?.kind === 'list' && change.evict).toBe('heading');
    expect(resolveList(editor, result.definition, 'toolbar').visible.has('heading')).toBe(false);
  });

  it('waits while an item is still settling into its new place', () => {
    const first = settled([pending(promote('table'))]);
    const evicted =
      first.applied[0]?.change.kind === 'list' ? first.applied[0].change.evict : undefined;
    const comeback: Use[] = [
      ...uses,
      [evicted as string, 'overflow', 6],
      [evicted as string, 'overflow', 6],
    ];
    const again = settled([pending(promote(evicted as string))], first.definition, 6, comeback);
    expect(again.applied).toHaveLength(0);
    expect(again.pending).toHaveLength(1);
  });

  it('spares an item still settling when another must make room, or waits', () => {
    const history: Use[] = [
      ['table', 'overflow', 3],
      ...(['bold', 'italic', 'underline', 'strike'] as const).flatMap((action): Use[] => [
        [action, 'region', 3],
        [action, 'region', 5],
      ]),
      ['image', 'overflow', 5],
      ['image', 'overflow', 5],
    ];
    // Session 4: table is promoted. Session 5: image needs room, and table is the least used.
    const first = settled([pending(promote('table'), 5, 4)], emptyEditor(), 4, history);
    expect(first.applied).toHaveLength(1);
    const second = settled([pending(promote('image'), 5, 5)], first.definition, 5, history);
    const change = second.applied[0]?.change;
    expect(change?.kind === 'list' && change.evict).toBe('strike');
    expect(resolveList(editor, second.definition, 'toolbar').visible.has('table')).toBe(true);

    // With every evictable item freshly moved, the change waits instead.
    let crowded = emptyDefinition(editor);
    for (const target of ['quote', 'code', 'link', 'table', 'image']) {
      crowded = applyOperation(crowded, operation(promote(target)), {
        contract: editor,
        summary: summaryOf([]),
        session: 4,
        adaptation: 'a',
      });
    }
    const waiting = settled([pending(promote('comment'), 5, 5)], crowded, 5, [
      ['comment', 'overflow', 5],
      ['comment', 'overflow', 5],
    ]);
    expect(waiting.applied).toHaveLength(0);
    expect(waiting.pending).toHaveLength(1);
  });

  it('drops expired changes and re-checks the rest against the current definition', () => {
    const result = settled(
      [pending(promote('table'), 5, 0), pending(promote('bold'), 5, 6)],
      emptyEditor(),
      6,
    );
    expect(result.dropped.map((entry) => entry.reason)).toEqual(['expired']);
    expect(result.rejected.map((entry) => entry.rule)).toEqual(['noop']);
  });
});

describe('revert', () => {
  it('cools a planned change down, and blocks it when reverted again', () => {
    const apply = (definition: Definition) =>
      applyOperation(definition, operation(promote('table')), {
        contract: editor,
        summary: summaryOf(uses),
        session: 5,
        adaptation: 'a1',
      });
    let definition = apply(emptyEditor());
    definition = revert(definition, definition.operations[0]?.id as string, 5, DEFAULT_STABILIZER);
    expect(definition.cooldowns).toEqual([{ key: 'toolbar||promote|table', until: 10 }]);
    definition = apply(definition);
    definition = revert(definition, definition.operations[1]?.id as string, 11, DEFAULT_STABILIZER);
    expect(definition.blocked).toEqual(['toolbar||promote|table']);
  });

  it('counts only planned reverts toward a block', () => {
    const summary = summaryOf(uses);
    const context = { contract: editor, summary, session: 5, adaptation: 'a1' };
    const choose = { kind: 'choice', surface: 'density', op: 'set', value: 'compact' } as const;
    let definition = applyOperation(emptyEditor(), operation(choose, { origin: 'user' }), context);
    definition = revert(definition, definition.operations[0]?.id as string, 5, DEFAULT_STABILIZER);
    definition = applyOperation(
      definition,
      operation(choose, { evidence: [{ intent: 'denser' }] }),
      context,
    );
    definition = revert(definition, definition.operations[1]?.id as string, 5, DEFAULT_STABILIZER);
    expect(definition.blocked).toEqual([]);
    expect(definition.cooldowns).toEqual([{ key: 'density||set|compact', until: 10 }]);
  });

  it('never cools down the user’s own changes', () => {
    const definition = applyOperation(
      emptyEditor(),
      operation(
        { kind: 'list', surface: 'toolbar', op: 'pin', target: 'table' },
        { origin: 'user' },
      ),
      { contract: editor, summary: summaryOf([]), session: 5, adaptation: 'a1' },
    );
    const reverted = revert(
      definition,
      definition.operations[0]?.id as string,
      5,
      DEFAULT_STABILIZER,
    );
    expect(reverted.cooldowns).toEqual([]);
    expect(reverted.operations[0]?.status).toBe('reverted');
  });
});

describe('evictFor', () => {
  const comment: Change = {
    kind: 'list',
    surface: 'tableBar',
    context: 'text',
    op: 'promote',
    target: 'comment',
  };

  it('picks the least used item, then the last in standard order, when the list is full', () => {
    expect(evictFor(editor, emptyEditor(), comment, summaryOf([]))).toBe('italic');
    const used = (action: string) => summaryOf([[action, 'region', 5, { tool: 'text' }]]);
    expect(evictFor(editor, emptyEditor(), comment, used('bold'))).toBe('italic');
    expect(evictFor(editor, emptyEditor(), comment, used('italic'))).toBe('bold');
  });

  it('needs no eviction while the list has room', () => {
    const roomy = applyOperation(
      emptyEditor(),
      operation(
        { kind: 'list', surface: 'tableBar', context: 'text', op: 'hide', target: 'bold' },
        { origin: 'user' },
      ),
      { contract: editor, summary: summaryOf([]), session: 5, adaptation: 'a1' },
    );
    expect(evictFor(editor, roomy, comment, summaryOf([]))).toBeUndefined();
  });
});

describe('applyOperation', () => {
  it('replaces an earlier suggestion with the same aim', () => {
    const add = (label: string): Change => ({
      kind: 'collection',
      surface: 'macros',
      op: 'add',
      item: 'emphasis',
      value: { label, steps: ['bold', 'italic'] },
    });
    const context = { contract: editor, summary: summaryOf([]), session: 5, adaptation: 'a1' };
    let definition = applyOperation(emptyEditor(), operation(add('One')), context, 'suggested');
    definition = applyOperation(definition, operation(add('Two')), context, 'suggested');
    expect(definition.operations.map((entry) => entry.status)).toEqual(['suggested']);
    expect(resolveList(editor, definition, 'toolbar').visible.size).toBe(6);
  });
});
