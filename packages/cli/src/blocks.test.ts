import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BlockSpec } from '@plurid/uitive-core';
import { describe, expect, it } from 'vitest';
import { emitBlocks, generateBlocks, readBlocks } from './blocks.js';
import { syntaxErrors } from './code.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const file = 'tools/fixtures/react/order-summary.tsx';
const result = readBlocks(
  [`${file}#OrderSummary`, `${file}#StatusBadge`, `${file}#Ambiguous`, `${file}#Missing`],
  root,
);

describe('readBlocks', () => {
  it('turns component props into a flat schema, documenting what was optional', () => {
    const [summary] = result.blocks;
    expect(summary).toMatchObject({
      name: 'orderSummary',
      component: 'OrderSummary',
      label: 'Order summary',
      description: 'A compact summary of an order: its lines, totals and status.',
    });
    expect(summary?.props).toEqual([
      { name: 'title', schema: 'z.string()', description: 'The heading above the summary.' },
      {
        name: 'variant',
        schema: "z.enum(['compact', 'full'])",
        description: 'How much of the order shows.',
        fallback: "'compact'",
      },
      {
        name: 'showTotals',
        schema: 'z.boolean()',
        description: 'Whether totals show beneath the lines.',
        fallback: 'true',
      },
      {
        name: 'limit',
        schema: 'z.number()',
        description: 'Most lines shown before the rest fold away.',
      },
      {
        name: 'columns',
        schema: "z.array(z.enum(['sku', 'quantity', 'price']))",
        description: 'Which columns show, in order.',
      },
      { name: 'tags', schema: 'z.array(z.string())', description: '' },
      {
        name: 'tone',
        schema: "z.enum(['neutral', 'warning'])",
        description: 'The tone of the status line.',
        fallback: "'neutral'",
      },
    ]);
    expect(summary?.adapter).toEqual([
      { name: 'onSelect', reason: 'a function' },
      { name: 'footer', reason: 'content from the application' },
      { name: 'order', reason: 'an object the application supplies' },
    ]);
  });

  it('reads memoized components, and names what it can not read', () => {
    expect(result.blocks[1]).toMatchObject({
      name: 'statusBadge',
      props: [
        { name: 'label', schema: 'z.string()' },
        { name: 'kind', schema: "z.enum(['info', 'success', 'error'])" },
      ],
    });
    expect(result.problems).toEqual([
      `${file}#Ambiguous: prop value is string | number, a union a schema can't hold; split the prop or wrap the component`,
      `${file}#Missing: ${file} exports no Missing`,
    ]);
  });
});

describe('generateBlocks', () => {
  it('writes documentation of any shape as strings that parse', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'uitive-'));
    await writeFile(join(cwd, 'package.json'), '{}');
    await writeFile(
      join(cwd, 'card.tsx'),
      [
        '/**',
        ' * Shows an order.',
        " * With its totals, in the shop's \\ style.",
        ' */',
        "export function Card(props: { /**\n * How dense.\n * Compact fits more.\n */ mode?: 'compact' | 'full'; 'data-tone': 'calm' | 'loud' }) {",
        '  return null;',
        '}',
        '',
      ].join('\n'),
    );
    const result = await generateBlocks({ components: ['card.tsx#Card'], cwd });
    expect(result).toMatchObject({ written: true, problems: [] });
    const code = await readFile(join(cwd, result.file), 'utf8');
    expect(syntaxErrors(code, result.file)).toEqual([]);
    expect(code).toContain(
      "description: 'Shows an order.\\nWith its totals, in the shop\\'s \\\\ style.',",
    );
    expect(code).toContain("'data-tone': z.enum(['calm', 'loud'])");
  });
});

describe('emitBlocks', () => {
  it('writes blocks whose schemas accept the props', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uitive-'));
    const path = join(directory, 'blocks.generated.ts');
    const code = emitBlocks(
      result.blocks,
      fileURLToPath(new URL('../../core/src/index.ts', import.meta.url)),
    ).replace("from 'zod'", `from '${fileURLToPath(import.meta.resolve('zod'))}'`);
    await writeFile(path, code);
    const { blocks } = (await import(pathToFileURL(path).href)) as {
      blocks: Record<string, BlockSpec>;
    };
    const props = {
      title: 'Order 1042',
      variant: 'full',
      showTotals: false,
      limit: 5,
      columns: ['sku', 'price'],
      tags: [],
      tone: 'warning',
    };
    expect(blocks.orderSummary?.props.parse(props)).toEqual(props);
    expect(() => blocks.orderSummary?.props.parse({ ...props, variant: 'huge' })).toThrow();
    expect(code).toContain(
      "variant: z.enum(['compact', 'full']).describe('How much of the order shows. The component\\'s default: \\'compact\\'.'),",
    );
    expect(code).toContain(
      '// The adapter supplies onSelect (a function), footer (content from the application), order (an object the application supplies).',
    );
  });
});
