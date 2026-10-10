import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { check, checkText } from './check.js';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** A project whose contract has `count` sources of `fields` fields each, a third of them enums. */
async function wide(count: number, fields: number) {
  const cwd = await mkdtemp(join(tmpdir(), 'uitive-'));
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'wide', type: 'module' }));
  await symlink(here('../node_modules'), join(cwd, 'node_modules'));
  await mkdir(join(cwd, 'uitive'));
  await writeFile(
    join(cwd, 'uitive', 'contract.ts'),
    `import { action, defineApp, field, page, source, ui } from '@plurid/uitive-core';
import { z } from 'zod';

const sources: Record<string, ReturnType<typeof source>> = {};
const actions: Record<string, ReturnType<typeof action>> = {};
for (let i = 0; i < ${count}; i++) {
  const id = \`things-\${i}\`;
  const shape: Record<string, z.ZodType> = { id: z.string(), name: z.string() };
  for (let j = 0; j < ${fields - 2}; j++) {
    shape[\`f\${j}\`] = j % 3 === 0 ? field.enum(['a', 'b', 'c']) : z.string();
  }
  sources[id] = source({
    label: \`Things \${i}\`,
    description: \`Things number \${i}\`,
    row: z.object(shape),
    key: 'id',
    title: 'name',
    capabilities: {},
  });
  actions[\`\${id}.touch\`] = action({
    label: \`Touch things \${i}\`,
    description: 'Touches one',
    params: z.object({ thing: field.ref(id) }),
    effect: 'write',
  });
}

export const contract = defineApp({
  id: 'wide',
  version: '1',
  description: 'Wide',
  sources,
  actions,
  regions: { app: { label: 'App', description: 'The app' } },
  surfaces: {
    home: page({})({ label: 'Home', description: 'Home', standard: () => ui.page(ui.region('app')) }),
  },
});
`,
  );
  await writeFile(
    join(cwd, 'uitive', 'bindings.ts'),
    'export const bindings = { fetch: async () => ({ rows: [] }), perform: async () => ({ ok: true }) };\n',
  );
  return cwd;
}

describe('check', () => {
  it('measures the largest subset a request can plan over, not only one source at a time', async () => {
    // Each source fits alone, but eight together name more than 400 fields.
    const result = await check({ cwd: await wide(20, 50) });
    const schemas = result.checks.find((entry) => entry.name === 'schemas');
    expect(schemas).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/^the 8 largest sources together: an enum of \d+$/),
    });
  }, 30_000);

  it('passes contracts whose largest subset fits, and counts what it covers in words', async () => {
    const result = await check({ cwd: await wide(10, 12) });
    expect(result.checks.filter((entry) => !entry.ok)).toEqual([]);
    expect(result.checks.find((entry) => entry.name === 'schemas')?.detail).toMatch(
      /^11 request schemas fit/,
    );
    expect(checkText(result)).toContain(
      'Coverage: 10 sources; 10 actions, 10 with effects, all able to run through perform; 0 routes, 1 page, 1 region, 0 lists, 0 choices.',
    );
  }, 30_000);
});
