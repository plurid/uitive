import { describe, expect, it } from 'vitest';
import { editor } from './__fixtures__/editor.js';
import { emptyEditor, operation, summaryOf, type Use } from './__fixtures__/usage.js';
import {
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
  const options = { ...DEFAULT_STABILIZER, hysteresis: true };

  it('holds a weak model change until a second plan proposes it', () => {
    const first = stage([model(promote('table'))], {}, [0.5], options);
    expect(first.pending[0]?.held).toBe(true);
    const second = stage([model(promote('table'))], first.seen, [0.5], options);
    expect(second.pending[0]?.held).toBe(false);
  });

  it('lets strong model changes and every heuristic change through at once', () => {
    expect(stage([model(promote('table'))], {}, [2], options).pending[0]?.held).toBe(false);
    const heuristic = { ...model(promote('table')), origin: 'heuristic' as const };
    expect(stage([heuristic], {}, [0], options).pending[0]?.held).toBe(false);
  });

  it('forgets changes a plan no longer proposes', () => {
    const first = stage([model(promote('table'))], {}, [0.5], options);
    const second = stage([model(promote('image'))], first.seen, [0.5], options);
    expect(second.seen).toEqual({ 'toolbar||promote|image': 1 });
  });
});

describe('settle', () => {
  it('applies the strongest changes within the budget and keeps the rest pending', () => {
    const result = settled([
      pending(promote('link'), 1),
      pending(promote('table'), 3),
      pending(promote('image'), 2),
    ]);
    expect(
      result.applied.map((entry) => entry.change.kind === 'list' && entry.change.target),
    ).toEqual(['table', 'image']);
    expect(
      result.pending.map((entry) => entry.change.kind === 'list' && entry.change.target),
    ).toEqual(['link']);
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
  it('needs no eviction while the list has room', () => {
    const change: Change = {
      kind: 'list',
      surface: 'tableBar',
      context: 'text',
      op: 'promote',
      target: 'comment',
    };
    expect(evictFor(editor, emptyEditor(), change, summaryOf([]))).toBe('italic');
  });
});
