import { describe, expect, it } from 'vitest';
import { selectSubset } from '@plurid/aptuitive-core';
import { payments } from '../../core/src/__fixtures__/payments.js';
import { scale } from '../../core/src/__fixtures__/scale.js';
import { ops } from './__fixtures__/ops.js';
import { limits, outputSchema, size } from './schema.js';

/** Follows a path of keys through parsed JSON. */
const at = (node: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>(
    (value, key) => (value as Record<string | number, unknown> | undefined)?.[key],
    node,
  );

describe('outputSchema', () => {
  const schema = outputSchema(ops);

  it('requires every field and stays within the structured-output limits', () => {
    expect(limits(schema)).toEqual({ optional: 0, unions: 1 });
  });

  it('is byte-identical for the same contract, so the grammar and prompt cache stay warm', () => {
    expect(JSON.stringify(outputSchema(ops))).toBe(JSON.stringify(schema));
  });

  it('hoists large enums into $defs and drops bounds structured outputs can’t enforce', () => {
    const text = JSON.stringify(schema);
    const defs = schema.$defs as Record<string, { enum?: string[] }>;
    const hoisted = Object.entries(defs).filter(([name]) => name.startsWith('enum'));
    expect(hoisted).toHaveLength(1);
    expect(hoisted[0]?.[1].enum).toContain('current');
    expect(text).not.toMatch(/"(minimum|maximum|minLength|maxLength)"/);
    expect(defs.context?.enum?.slice(0, 2)).toEqual(['none', '*']);
  });

  it('offers sections, tabs and the contract’s blocks as flat elements, every prop required', () => {
    const page = at(schema, 'properties', 'pages', 'items');
    expect(at(page, 'required')).toEqual([
      'surface',
      'context',
      'op',
      'slug',
      'title',
      'root',
      'elements',
      'basis',
    ]);
    const variants = at(page, 'properties', 'elements', 'items', 'anyOf') as unknown[];
    expect(variants.map((variant) => at(variant, 'properties', 'block', 'const'))).toEqual([
      'section',
      'tabs',
      'note',
      'table',
      'actions',
    ]);
    expect(at(variants[0], 'required')).toEqual(['id', 'block', 'props', 'children']);
    expect(at(variants[0], 'properties', 'props', 'required')).toEqual(['title', 'layout']);
    expect(at(variants[3], 'properties', 'props', 'required')).toEqual([
      'machine',
      'columns',
      'limit',
    ]);
    expect(at(variants[3], 'properties', 'props', 'additionalProperties')).toBe(false);
  });

  describe('with sources', () => {
    const rich = outputSchema(payments);
    const page = at(rich, 'properties', 'pages', 'items');
    const variants = at(page, 'properties', 'elements', 'items', 'anyOf') as unknown[];
    const variant = (name: string) =>
      variants.find((entry) => at(entry, 'properties', 'block', 'const') === name);

    it('still has one union and nothing optional', () => {
      expect(limits(rich)).toEqual({ optional: 0, unions: 1 });
    });

    it('offers every generic block, a region, and named queries', () => {
      expect(variants.map((entry) => at(entry, 'properties', 'block', 'const'))).toEqual([
        'section',
        'tabs',
        'region',
        'table',
        'list',
        'detail',
        'metric',
        'chart',
        'timeline',
        'board',
        'form',
        'actions',
        'note',
        'links',
      ]);
      expect(at(page, 'required')).toContain('data');
      expect(at(page, 'properties', 'data', 'items', 'properties', 'query')).toEqual({
        $ref: '#/$defs/query',
      });
    });

    it('names fields, params, actions and routes by enum', () => {
      const defs = rich.$defs as Record<string, { enum?: string[] }>;
      expect(defs.field?.enum?.slice(0, 3)).toEqual(['none', 'payments.id', 'payments.amount']);
      expect(defs.field?.enum).toContain('payments.customer.email');
      expect(defs.param?.enum).toEqual([
        'note.add:payment',
        'note.add:text',
        'refund:payment',
        'refund:reason',
      ]);
      expect(
        at(
          variant('table'),
          'properties',
          'props',
          'properties',
          'rowActions',
          'items',
          'properties',
          'action',
          'enum',
        ),
      ).toEqual(['note.add', 'refund']);
      expect(at(variant('form'), 'properties', 'props', 'properties', 'action', 'enum')).toEqual([
        'note.add',
        'refund',
      ]);
      expect(
        at(
          variant('links'),
          'properties',
          'props',
          'properties',
          'items',
          'items',
          'properties',
          'route',
          'enum',
        ),
      ).toEqual(['home', 'payments', 'payment', 'customer']);
      expect(at(rich, '$defs', 'query', 'required')).toEqual([
        'source',
        'fields',
        'filter',
        'sort',
        'limit',
        'search',
        'aggregate',
      ]);
    });
  });

  describe('at scale', () => {
    it('scopes a large contract to the areas a request needs, within the limits', () => {
      const whole = outputSchema(scale);
      const subset = selectSubset(scale, {
        text: 'refund the disputed charges',
        inView: ['customer'],
      });
      const scoped = outputSchema(scale, { subset });
      expect(limits(scoped)).toEqual({ optional: 0, unions: 1 });
      expect(size(scoped).largestEnum).toBeLessThanOrEqual(400);
      expect(size(scoped).bytes).toBeLessThan(60_000);
      expect(size(whole).largestEnum).toBeGreaterThan(size(scoped).largestEnum);
      const defs = scoped.$defs as Record<
        string,
        { enum?: string[]; properties?: Record<string, { enum?: string[] }> }
      >;
      expect(defs.query?.properties?.source?.enum).toEqual(subset.sources);
      expect(
        defs.field?.enum?.every(
          (name) => name === 'none' || subset.sources.includes(name.split('.')[0] as string),
        ),
      ).toBe(true);
      expect(
        defs.param?.enum?.every((name) => subset.actions.includes(name.split(':')[0] as string)),
      ).toBe(true);
    });

    it('drops native blocks when asked, for grammars that would not compile', () => {
      const variants = (schema: Record<string, unknown>) =>
        (
          at(
            schema,
            'properties',
            'pages',
            'items',
            'properties',
            'elements',
            'items',
            'anyOf',
          ) as unknown[]
        ).map((entry) => at(entry, 'properties', 'block', 'const'));
      expect(variants(outputSchema(ops))).toContain('table');
      expect(variants(outputSchema(ops, { native: false }))).not.toContain('table');
    });
  });
});
