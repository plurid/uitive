import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from './commands.js';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../tools/fixtures/openapi/${name}`, import.meta.url));

async function cli(...argv: string[]) {
  let out = '';
  let err = '';
  const code = await run(argv, {
    version: '9.9.9',
    out: { write: (text: string) => (out += text) },
    err: { write: (text: string) => (err += text) },
  });
  return { code, out, err };
}

describe('uitive', () => {
  it('prints help and its version', async () => {
    expect((await cli('--help')).out).toMatch(/^Usage: uitive <command>/);
    expect(await cli('--version')).toMatchObject({ code: 0, out: '9.9.9\n' });
    expect(await cli('make', 'coffee')).toMatchObject({
      code: 1,
      err: 'uitive: unknown command "make coffee"\n\n',
    });
  });

  it('surveys an API description, as text or JSON', async () => {
    const text = await cli('survey', '--openapi', fixture('payments.json'));
    expect(text.code).toBe(0);
    expect(text.out).toContain('charges (/v1/charges) ');
    const json = await cli('survey', '--openapi', fixture('shop.yaml'), '--json');
    const survey = JSON.parse(json.out) as {
      counts: { sources: number };
      sources: { id: string }[];
    };
    expect(survey.counts.sources).toBe(4);
    expect(survey.sources.map((entry) => entry.id)).toEqual([
      'orders',
      'customers',
      'products',
      'product-types',
    ]);
  });

  it('generates sources into the project, honouring its curation', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'uitive-'));
    await writeFile(
      join(cwd, 'curation.json'),
      JSON.stringify({ default: 'exclude', sources: { orders: { include: true } } }),
    );
    const result = await cli(
      'generate',
      'sources',
      '--openapi',
      fixture('shop.yaml'),
      '--curation',
      'curation.json',
      '--cwd',
      cwd,
      '--json',
    );
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out) as { file: string; sources: string[]; written: boolean };
    expect(report).toMatchObject({
      file: 'uitive/api.generated.ts',
      written: true,
      sources: ['orders'],
    });
    const code = await readFile(join(cwd, report.file), 'utf8');
    expect(code).toContain('orders: source({');
    expect(code).toContain("'orders.cancel': action({");
  });

  it('asks for a curation before generating from a large API', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'uitive-'));
    const paths = Object.fromEntries(
      Array.from({ length: 41 }, (_, index) => [
        `/things${index}`,
        {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'object', properties: { id: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      ]),
    );
    await writeFile(
      join(cwd, 'big.json'),
      JSON.stringify({ openapi: '3.1.0', info: { title: 'Big', version: '1' }, paths }),
    );
    const result = await cli('generate', 'sources', '--openapi', 'big.json', '--cwd', cwd);
    expect(result.code).toBe(1);
    expect(result.out).toBe('Nothing written.\n');
    expect(result.err).toMatch(/This API has 41 sources and 0 actions/);
  });
});
