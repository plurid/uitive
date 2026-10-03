import { describe, expect, it } from 'vitest';
import { editor } from './__fixtures__/editor.js';
import { summaryOf, type Use } from './__fixtures__/usage.js';
import { createUitive } from './client.js';
import { command, heuristicPlanner } from './heuristic.js';
import type { PlanRequest, ProposedOperation } from './planner.js';

function request(uses: Use[], kind: PlanRequest['kind'] = 'plan', text?: string): PlanRequest {
  const client = createUitive({ contract: editor });
  return {
    ...client.request(kind, text),
    summary: summaryOf(uses),
  };
}

const targets = (operations: readonly ProposedOperation[]) =>
  operations.map(({ change }) => {
    const subject =
      change.kind === 'list'
        ? change.target
        : change.kind === 'choice'
          ? change.value
          : change.kind === 'collection'
            ? change.item
            : change.op;
    return `${change.surface}:${change.op}:${subject}`;
  });

describe('heuristicPlanner', () => {
  it('swaps a rising overflow item for the weakest visible one, past the margin', async () => {
    const uses: Use[] = [
      ['table', 'overflow', 3],
      ['table', 'overflow', 4],
      ['table', 'region', 5],
      ['bold', 'region', 5],
      ['italic', 'region', 5],
      ['underline', 'region', 5],
      ['heading', 'region', 5],
    ];
    const result = await heuristicPlanner().plan(request(uses), editor);
    expect(targets(result.operations)).toEqual(['toolbar:promote:table']);
    expect(result.operations[0]?.evidence).toEqual([
      { action: 'table', metric: 'activeSessions' },
      { action: 'table', metric: 'viaOverflow' },
      { action: 'strike', metric: 'idleSessions' },
    ]);
  });

  it('leaves the layout alone when nothing clearly earns a place, and never oscillates', async () => {
    const once: Use[] = [['table', 'overflow', 5]];
    expect((await heuristicPlanner().plan(request(once), editor)).operations).toEqual([]);
    const busy: Use[] = ['bold', 'italic', 'underline', 'strike', 'heading', 'table'].flatMap(
      (action) =>
        [3, 4, 5].map((session): Use => [
          action,
          action === 'table' ? 'overflow' : 'region',
          session,
        ]),
    );
    expect((await heuristicPlanner().plan(request(busy), editor)).operations).toEqual([]);
  });
});

describe('command', () => {
  const ask = (text: string) => command(request([], 'command', text), editor);

  it('understands naming commands', () => {
    expect(targets(ask('hide strikethrough').operations)).toEqual(['toolbar:hide:strike']);
    expect(targets(ask('Show the Insert table button').operations)).toEqual(['toolbar:pin:table']);
    expect(targets(ask('pin print').operations)).toEqual(['toolbar:pin:print', 'file:pin:print']);
    expect(ask('hide share').operations[0]?.scope).toBe('explicit');
  });

  it('moves an item to either end', () => {
    const moves = (text: string) =>
      ask(text).operations.map(({ change }) =>
        change.kind === 'list' ? `${change.surface}:${change.target}:${change.index}` : '',
      );
    expect(moves('move strikethrough to the top')).toEqual(['toolbar:strike:0']);
    expect(moves('put Strikethrough first')).toEqual(['toolbar:strike:0']);
    const last = moves('move strikethrough to the end');
    expect(last).toHaveLength(1);
    expect(Number(last[0]?.split(':')[2])).toBeGreaterThan(0);
  });

  it('asks which one when words fit several actions', () => {
    const result = ask('hide export');
    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toEqual(['Export PDF', 'Export CSV']);
  });

  it('sets a choice by naming its value, in the words people use', () => {
    for (const text of [
      'compact',
      'switch to compact mode',
      'use the compact density',
      'set density to compact',
      'compact density',
      'make it compact',
    ]) {
      expect(targets(ask(text).operations), text).toEqual(['density:set:compact']);
    }
    // Anything more than the value and filler needs a model to understand.
    expect(ask('compact for long documents').status).toBe('unsupported');
  });

  it('matches a stated goal by shared words only, literally', () => {
    const goal = (text: string) => command({ ...request([], 'command', text), goal: text }, editor);
    const result = goal('I insert tables and images all day');
    expect(targets(result.operations)).toEqual(['toolbar:promote:table', 'toolbar:promote:image']);
    expect(result.operations.every((entry) => entry.scope === 'goal')).toBe(true);
    expect(goal('I write grant proposals').status).toBe('unsupported');
    // Without a stated goal, free words need a model: guessing would only add noise.
    expect(ask('I insert tables and images all day').status).toBe('unsupported');
  });
});
