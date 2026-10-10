import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('..', import.meta.url));

/** Runs the build as a person would, and says how it ended. */
async function build(...args: string[]) {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['build.ts', ...args], {
      cwd: here,
    });
    return { code: 0, out: stdout, err: '' };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, out: failed.stdout, err: failed.stderr };
  }
}

// An adapter in a folder of its own, outside this repository, as a product keeps its own: it
// imports core and zod, which must resolve to this workspace's single copies.
const adapterSource = (
  id: string,
  origin: string,
) => `import { action, defineApp, list, source, toJson } from '@plurid/uitive-core';
import { z } from 'zod';

const contract = defineApp({
  id: '${id}',
  description: 'A site for a test',
  sources: {
    items: source({ label: 'Items', description: 'Items', row: z.object({ id: z.string(), name: z.string() }), key: 'id' }),
  },
  actions: { 'nav.home': action({ label: 'Home', description: 'Opens the home page' }) },
  surfaces: { nav: list({ label: 'Navigation', description: 'Links', items: ['nav.home'], capacity: 1 }) },
});

export const adapter = {
  format: 'uitive.adapter',
  formatVersion: 2,
  id: '${id}',
  label: 'A site',
  origins: ['${origin}'],
  contract: toJson(contract),
  anchors: {
    nav: { match: [{ role: 'navigation' }] },
    home: { within: 'nav', match: [{ role: 'link', name: ['Home'] }] },
  },
  routes: [],
  lists: { nav: { container: 'nav', items: { 'nav.home': 'home' } } },
  regions: {},
  pages: {},
};
`;

async function folder(adapters: Record<string, string>) {
  const path = await mkdtemp(join(tmpdir(), 'uitive-adapters-'));
  for (const [name, text] of Object.entries(adapters)) await writeFile(join(path, name), text);
  return path;
}

describe('the build', () => {
  it('checks the shipped adapters and their JSON, building nothing', async () => {
    expect(await build('--check')).toMatchObject({ code: 0, err: '' });
  });

  it('ships adapters from folders elsewhere, and only those, with their JSON written beside them', async () => {
    const elsewhere = await folder({ 'a-site.ts': adapterSource('a-site', 'https://a.example') });
    const stale = await build('--adapters', elsewhere, '--check');
    expect(stale.code).toBe(1);
    expect(stale.err).toContain(`Stale, so run node build.ts: ${join(elsewhere, 'a-site.json')}`);

    const out = join(elsewhere, 'dist');
    expect(await build('--adapters', elsewhere, '--out', out)).toMatchObject({ code: 0 });
    expect(JSON.parse(await readFile(join(elsewhere, 'a-site.json'), 'utf8'))).toMatchObject({
      id: 'a-site',
    });
    const worker = await readFile(join(out, 'worker.js'), 'utf8');
    expect(worker).toContain('https://a.example');
    expect(worker).not.toContain('acme-payments');
    expect(await build('--adapters', elsewhere, '--check')).toMatchObject({ code: 0 });
  }, 180_000);

  it('names every problem: a misnamed file, one adapter twice, and an unclear fixture', async () => {
    const misnamed = await folder({ 'other.ts': adapterSource('a-site', 'https://a.example') });
    expect((await build('--adapters', misnamed, '--check')).err).toContain(
      'its adapter is "a-site", so the file is a-site.ts',
    );

    const first = await folder({ 'a-site.ts': adapterSource('a-site', 'https://a.example') });
    const second = await folder({ 'a-site.ts': adapterSource('a-site', 'https://b.example') });
    const twice = await build('--adapters', first, '--adapters', second, '--check');
    expect(twice.code).toBe(1);
    expect(twice.err).toContain('"a-site" has the same ID or one of its origins');

    const other = await folder({ 'b-site.ts': adapterSource('b-site', 'https://b.example') });
    await mkdir(join(first, 'dist'), { recursive: true });
    const unclear = await build(
      '--adapters',
      first,
      '--adapters',
      other,
      '--out',
      join(first, 'dist'),
      '--fixture',
      'http://127.0.0.1:1',
      '--api',
      'http://127.0.0.1:2',
    );
    expect(unclear.code).toBe(1);
    expect(unclear.err).toContain('name the one the fixture stands for, --fixture-adapter');
  }, 120_000);
});
