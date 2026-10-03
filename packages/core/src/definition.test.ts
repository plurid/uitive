import { describe, expect, it } from 'vitest';
import { editor } from './__fixtures__/editor.js';
import { action, defineApp, list } from './contract.js';
import {
  emptyDefinition,
  operationKey,
  resolveChoice,
  resolveCollection,
  resolveList,
  type AppliedOperation,
  type Change,
  type Definition,
} from './definition.js';

let counter = 0;
function applied(
  change: Change,
  options: Partial<Pick<AppliedOperation, 'origin' | 'layer' | 'status' | 'session'>> = {},
): AppliedOperation {
  const origin = options.origin ?? 'model';
  return {
    id: `op${++counter}`,
    change,
    origin,
    layer: options.layer ?? (origin === 'user' ? 'user' : 'model'),
    evidence: [],
    basedOn: { version: 0, summary: '', session: 0 },
    status: options.status ?? 'active',
    session: options.session ?? 1,
    adaptation: 'a1',
  };
}

const with_ = (...operations: AppliedOperation[]): Definition => ({
  ...emptyDefinition(editor),
  operations,
});

const ids = (views: readonly { id: string }[]) => views.map((view) => view.id);

describe('resolveList', () => {
  it('shows required items first, then the standard order up to capacity', () => {
    const { value } = resolveList(editor, undefined, 'toolbar');
    expect(ids(value.visible)).toEqual([
      'bold',
      'italic',
      'underline',
      'strike',
      'heading',
      'share',
    ]);
    expect(ids(value.overflow)).toEqual([
      'quote',
      'code',
      'link',
      'table',
      'image',
      'comment',
      'export-pdf',
      'print',
    ]);
  });

  it('promotes into the standard position, evicting the chosen item', () => {
    const definition = with_(
      applied({
        kind: 'list',
        surface: 'toolbar',
        op: 'promote',
        target: 'table',
        evict: 'strike',
      }),
    );
    const { value } = resolveList(editor, definition, 'toolbar', undefined, 1);
    expect(ids(value.visible)).toEqual([
      'bold',
      'italic',
      'underline',
      'heading',
      'table',
      'share',
    ]);
    expect(value.visible.find((view) => view.id === 'table')?.moved).toBe(true);
    expect(ids(value.overflow)).toContain('strike');
  });

  it('never evicts required or pinned items, falling back to the last evictable one', () => {
    const definition = with_(
      applied(
        { kind: 'list', surface: 'toolbar', op: 'pin', target: 'heading' },
        { origin: 'user' },
      ),
      applied({ kind: 'list', surface: 'toolbar', op: 'promote', target: 'link', evict: 'share' }),
    );
    const { value } = resolveList(editor, definition, 'toolbar');
    expect(ids(value.visible)).toContain('share');
    expect(ids(value.visible)).toContain('heading');
    expect(ids(value.visible)).toContain('link');
    expect(value.visible).toHaveLength(6);
  });

  it('applies the user layer after the model layer, whatever the order applied', () => {
    const definition = with_(
      applied({ kind: 'list', surface: 'toolbar', op: 'hide', target: 'bold' }, { origin: 'user' }),
      applied({ kind: 'list', surface: 'toolbar', op: 'promote', target: 'table' }),
    );
    const { value } = resolveList(editor, definition, 'toolbar');
    expect(ids(value.visible)).not.toContain('bold');
    expect(ids(value.visible)).toContain('table');
  });

  it('ignores reverted and dismissed operations, and honours kept ones as the user layer', () => {
    const definition = with_(
      applied(
        { kind: 'list', surface: 'toolbar', op: 'promote', target: 'table' },
        { status: 'reverted' },
      ),
      applied(
        { kind: 'list', surface: 'toolbar', op: 'promote', target: 'image' },
        { status: 'kept' },
      ),
    );
    const { value } = resolveList(editor, definition, 'toolbar');
    expect(ids(value.visible)).not.toContain('table');
    expect(ids(value.visible)).toContain('image');
  });

  it('never moves required items to overflow', () => {
    const definition = with_(
      applied({ kind: 'list', surface: 'toolbar', op: 'demote', target: 'share' }),
      applied(
        { kind: 'list', surface: 'toolbar', op: 'hide', target: 'share' },
        { origin: 'user' },
      ),
    );
    expect(ids(resolveList(editor, definition, 'toolbar').value.visible)).toContain('share');
  });

  it('restores only items the standard layout shows', () => {
    const hidden = with_(
      applied({ kind: 'list', surface: 'toolbar', op: 'hide', target: 'bold' }, { origin: 'user' }),
      applied(
        { kind: 'list', surface: 'toolbar', op: 'restore', target: 'bold' },
        { origin: 'user' },
      ),
      applied(
        { kind: 'list', surface: 'toolbar', op: 'restore', target: 'print' },
        { origin: 'user' },
      ),
    );
    const { value } = resolveList(editor, hidden, 'toolbar');
    expect(ids(value.visible)).toContain('bold');
    expect(ids(value.visible)).not.toContain('print');
  });

  it('reorders only reorderable lists', () => {
    const contract = defineApp({
      id: 'app',
      description: '',
      actions: {
        a: action({ label: 'A', description: '' }),
        b: action({ label: 'B', description: '' }),
        c: action({ label: 'C', description: '' }),
      },
      surfaces: {
        nav: list({
          label: 'Nav',
          description: '',
          items: ['a', 'b', 'c'],
          capacity: 3,
          reorderable: true,
        }),
        bar: list({ label: 'Bar', description: '', items: ['a', 'b', 'c'], capacity: 3 }),
      },
    });
    const move = (surface: string): Definition => ({
      ...emptyDefinition(contract),
      operations: [
        applied({ kind: 'list', surface, op: 'move', target: 'c', index: 0 }, { origin: 'user' }),
      ],
    });
    expect(ids(resolveList(contract, move('nav'), 'nav').value.visible)).toEqual(['c', 'a', 'b']);
    expect(ids(resolveList(contract, move('bar'), 'bar').value.visible)).toEqual(['a', 'b', 'c']);
  });

  it('adapts each context value separately', () => {
    const definition = with_(
      applied({
        kind: 'list',
        surface: 'tableBar',
        context: 'table',
        op: 'promote',
        target: 'italic',
        evict: 'bold',
      }),
    );
    expect(ids(resolveList(editor, definition, 'tableBar', 'table').value.visible)).toEqual([
      'table',
      'italic',
    ]);
    expect(ids(resolveList(editor, definition, 'tableBar', 'text').value.visible)).toEqual([
      'bold',
      'italic',
    ]);
  });
});

describe('resolveChoice', () => {
  it('starts from the default and lets the user layer win', () => {
    expect(resolveChoice(editor, undefined, 'density')).toBe('comfortable');
    const definition = with_(
      applied(
        { kind: 'choice', surface: 'density', op: 'set', value: 'comfortable' },
        { origin: 'user' },
      ),
      applied({ kind: 'choice', surface: 'density', op: 'set', value: 'compact' }),
    );
    expect(resolveChoice(editor, definition, 'density')).toBe('comfortable');
  });
});

describe('resolveCollection', () => {
  it('separates suggestions from accepted items, and applies edits and removals in order', () => {
    const add = (item: string, label: string, status: AppliedOperation['status']) =>
      applied(
        {
          kind: 'collection',
          surface: 'macros',
          op: 'add',
          item,
          value: { label, steps: ['bold', 'italic'] },
        },
        { status },
      );
    const definition = with_(
      add('m1', 'Emphasis', 'active'),
      add('m2', 'Headline', 'suggested'),
      add('m3', 'Gone', 'active'),
      applied(
        {
          kind: 'collection',
          surface: 'macros',
          op: 'update',
          item: 'm1',
          value: { label: 'Strong', steps: ['bold', 'underline'] },
        },
        { origin: 'user' },
      ),
      applied(
        { kind: 'collection', surface: 'macros', op: 'remove', item: 'm3' },
        { origin: 'user' },
      ),
    );
    const value = resolveCollection(editor, definition, 'macros');
    expect(value.items.map((entry) => entry.title)).toEqual(['Strong']);
    expect(value.suggestions.map((entry) => entry.title)).toEqual(['Headline']);
  });
});

describe('operationKey', () => {
  it('identifies what an operation does, not when or by whom', () => {
    const change: Change = { kind: 'list', surface: 'toolbar', op: 'promote', target: 'table' };
    expect(operationKey(change)).toBe('toolbar||promote|table');
    expect(operationKey({ ...change, context: 'x' })).toBe('toolbar|x|promote|table');
  });
});
