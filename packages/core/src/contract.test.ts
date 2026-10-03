import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { editor } from './__fixtures__/editor.js';
import { createUitive } from './client.js';
import {
  action,
  choice,
  collection,
  defineApp,
  list,
  type ActionIdOf,
  type CollectionValue,
  type ListValue,
  type SurfaceIdOf,
} from './contract.js';

const base = {
  id: 'app',
  description: 'An app',
  actions: {
    open: action({ label: 'Open', description: 'Open a file', aliases: ['load'] }),
    close: action({ label: 'Close', description: 'Close the file' }),
  },
};

describe('defineApp', () => {
  it('rejects lists that reference unknown actions', () => {
    expect(() =>
      defineApp({
        ...base,
        surfaces: {
          // @ts-expect-error: `save` is not an action of this contract.
          bar: list({ label: 'Bar', description: '', items: ['open', 'save'], capacity: 1 }),
        },
      }),
    ).toThrow(/unknown action "save"/);
  });

  it('rejects IDs that collide ignoring case', () => {
    expect(() =>
      defineApp({
        id: 'app',
        description: '',
        actions: {
          open: action({ label: 'Open', description: '' }),
          'open-file': action({ label: 'Open file', description: '', aliases: ['open'] }),
        },
        surfaces: {},
      }),
    ).toThrow(/collides/);
    expect(() =>
      defineApp({
        ...base,
        actions: { Open: action({ label: 'Open', description: '' }) },
        surfaces: {},
      }),
    ).toThrow(/must match/);
  });

  it('rejects more required items than capacity, and unknown contexts', () => {
    expect(() =>
      defineApp({
        ...base,
        surfaces: {
          bar: list({
            label: 'Bar',
            description: '',
            items: ['open', 'close'],
            capacity: 1,
            required: ['open', 'close'],
          }),
        },
      }),
    ).toThrow(/more required items than capacity/);
    expect(() =>
      defineApp({
        ...base,
        surfaces: {
          bar: list({
            label: 'Bar',
            description: '',
            items: ['open'],
            capacity: 1,
            context: 'mode',
          }),
        },
      }),
    ).toThrow(/unknown context "mode"/);
  });

  it('rejects choices whose default is not a value', () => {
    expect(() =>
      defineApp({
        ...base,
        surfaces: {
          // @ts-expect-error: the default must be one of the values.
          mode: choice({ label: 'Mode', description: '', values: ['a', 'b'], default: 'c' }),
        },
      }),
    ).toThrow(/default is not a value/);
  });

  it('hashes what a planner sees, not key order or functions', () => {
    const make = (label: string, reversed = false) => {
      const actions = {
        open: action({ label, description: 'Open a file' }),
        close: action({ label: 'Close', description: 'Close the file' }),
      };
      return defineApp({
        id: 'app',
        description: 'An app',
        actions: reversed ? { close: actions.close, open: actions.open } : actions,
        surfaces: {
          bar: list({ label: 'Bar', description: '', items: ['open', 'close'], capacity: 1 }),
          notes: collection({
            label: 'Notes',
            description: '',
            item: z.object({ text: z.string() }),
            max: 2,
            title: (item) => item.text,
            validate: () => undefined,
          }),
        },
      });
    };
    expect(make('Open').hash).toBe(make('Open', true).hash);
    expect(make('Open').hash).not.toBe(make('Open…').hash);
  });

  it('finds actions, surfaces and contexts case-insensitively, including former IDs', () => {
    const contract = defineApp({
      ...base,
      contexts: { mode: ['reading', 'editing'] },
      surfaces: {
        mainBar: list({ label: 'Bar', description: '', items: ['open', 'close'], capacity: 1 }),
      },
    });
    expect(contract.action('OPEN')).toBe('open');
    expect(contract.action('Load')).toBe('open');
    expect(contract.action('nope')).toBeUndefined();
    expect(contract.surface('mainbar')).toBe('mainBar');
    expect(contract.contextValue('mode', 'Editing ')).toBe('editing');
    expect(Object.isFrozen(contract)).toBe(true);
  });

  it('offers the items available for a context value', () => {
    expect(editor.items('tableBar', 'table')).toEqual(['table', 'bold', 'italic']);
    expect(editor.items('tableBar')).toEqual(['bold', 'italic', 'table', 'comment']);
    expect(editor.items('density')).toEqual([]);
  });
});

describe('types', () => {
  it('infers action and surface IDs, and each surface value', () => {
    const client = createUitive({ contract: editor });
    expectTypeOf<ActionIdOf<typeof editor>>().toEqualTypeOf<
      | 'save'
      | 'undo'
      | 'bold'
      | 'italic'
      | 'underline'
      | 'strike'
      | 'heading'
      | 'quote'
      | 'code'
      | 'link'
      | 'table'
      | 'image'
      | 'comment'
      | 'share'
      | 'export-pdf'
      | 'export-csv'
      | 'print'
    >();
    expectTypeOf<SurfaceIdOf<typeof editor>>().toEqualTypeOf<
      'toolbar' | 'file' | 'tableBar' | 'density' | 'macros'
    >();
    expectTypeOf(client.surface('density')).toEqualTypeOf<'comfortable' | 'compact'>();
    expectTypeOf(client.surface('toolbar')).toEqualTypeOf<
      ListValue<
        | 'bold'
        | 'italic'
        | 'underline'
        | 'strike'
        | 'heading'
        | 'quote'
        | 'code'
        | 'link'
        | 'table'
        | 'image'
        | 'comment'
        | 'share'
        | 'export-pdf'
        | 'print'
      >
    >();
    expectTypeOf(client.surface('macros')).toEqualTypeOf<
      CollectionValue<{ label: string; steps: string[] }>
    >();
    // @ts-expect-error: not an action of the editor.
    client.record('teleport');
    // @ts-expect-error: not a surface of the editor.
    client.surface('sidebar');
  });
});
