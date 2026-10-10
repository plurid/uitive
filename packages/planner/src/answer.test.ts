import { describe, expect, it } from 'vitest';
import { parseAnswer, schemaProblems, withoutConst } from './answer.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'count', 'items'],
  properties: {
    status: { type: 'string', enum: ['done', 'ambiguous'] },
    count: { type: 'integer' },
    items: { type: 'array', items: { $ref: '#/$defs/item' } },
  },
  $defs: {
    item: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['block', 'title'],
          properties: { block: { type: 'string', const: 'note' }, title: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['block', 'rows'],
          properties: { block: { type: 'string', const: 'table' }, rows: { type: 'number' } },
        },
      ],
    },
  },
};

describe('parseAnswer', () => {
  it('reads JSON on its own, fenced, or wrapped in prose', () => {
    expect(parseAnswer('{"a":1}')).toEqual({ a: 1 });
    expect(parseAnswer('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseAnswer('Here is the plan: {"a":{"b":2}} Hope it helps.')).toEqual({ a: { b: 2 } });
    expect(() => parseAnswer('No plan today')).toThrow(SyntaxError);
  });

  it('reads a fenced block before more prose, JSON after braces in prose, and trailing commas', () => {
    const plan = { status: 'done', candidates: [], note: '' };
    const json = JSON.stringify(plan);
    const fence = '```';
    expect(
      parseAnswer(
        `Here is the plan:\n${fence}json\n${json}\n${fence}\nTell me if you want {more}.`,
      ),
    ).toEqual(plan);
    expect(parseAnswer(`Using {braces} as asked: ${json} and {that} is all`)).toEqual(plan);
    expect(parseAnswer('{"status":"done","candidates":[],"note":"",}')).toEqual(plan);
    expect(parseAnswer('Sure: {"a":[1,2,],"b":"}, {"}')).toEqual({ a: [1, 2], b: '}, {' });
  });
});

describe('schemaProblems', () => {
  it('accepts what follows the schema', () => {
    const value = {
      status: 'done',
      count: 2,
      items: [
        { block: 'note', title: 'Hi' },
        { block: 'table', rows: 3 },
      ],
    };
    expect(schemaProblems(schema, value)).toEqual([]);
  });

  it('says where an answer strays, through references and unions', () => {
    const value = {
      status: 'finished',
      count: 2.5,
      extra: true,
      items: [{ block: 'table', rows: 'three' }],
    };
    expect(schemaProblems(schema, value)).toEqual([
      '/status: must be one of "done", "ambiguous"',
      '/count: expected integer, got number',
      '/extra: not allowed',
      '/items/0/rows: expected number, got string',
    ]);
    expect(schemaProblems(schema, { status: 'done' })).toEqual([
      '/count: missing',
      '/items: missing',
    ]);
    expect(schemaProblems(schema, [])).toEqual(['/: expected object, got array']);
  });
});

describe('withoutConst', () => {
  it('turns constants into enums of one, keeping property names as they are', () => {
    expect(
      withoutConst({
        type: 'object',
        properties: { const: { type: 'string', const: 'x' } },
        $defs: { const: { const: 1 } },
      }),
    ).toEqual({
      type: 'object',
      properties: { const: { type: 'string', enum: ['x'] } },
      $defs: { const: { enum: [1] } },
    });
  });
});
