import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const packages = readdirSync(join(root, 'packages'));
const built = packages.every((name) => existsSync(join(root, 'packages', name, 'dist')));

/** The files in a gzipped tarball, by path, read from its tar headers. */
function unpack(tarball: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(tarball);
  const field = (header: Buffer, start: number, end: number) =>
    header.toString('utf8', start, end).replace(/\0[\s\S]*$/, '');
  const files = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = field(header, 0, 100);
    if (name === '') break;
    const prefix = field(header, 345, 500);
    const size = Number.parseInt(field(header, 124, 136).trim() || '0', 8);
    const type = field(header, 156, 157);
    if (type === '' || type === '0') {
      files.set(
        prefix ? `${prefix}/${name}` : name,
        tar.subarray(offset + 512, offset + 512 + size),
      );
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Every file an exports map names, whatever its conditions. */
const targets = (exports: unknown): string[] =>
  typeof exports === 'string'
    ? [exports]
    : exports !== null && typeof exports === 'object'
      ? Object.values(exports).flatMap(targets)
      : [];

// Development resolves every import to source, so only packing shows what installs would get.
describe.skipIf(!built)('the packages as packed for npm (skipped until they are built)', () => {
  let folder = '';
  const packed = new Map<string, Map<string, Buffer>>();

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'uitive-pack-'));
    await Promise.all(
      packages.map(async (name) => {
        const { stdout } = await promisify(execFile)(
          'pnpm',
          ['pack', '--json', '--pack-destination', folder],
          { cwd: join(root, 'packages', name), shell: process.platform === 'win32' },
        );
        const { filename } = JSON.parse(stdout.slice(stdout.indexOf('{'))) as { filename: string };
        packed.set(name, unpack(readFileSync(filename)));
      }),
    );
  }, 60_000);

  afterAll(() => {
    if (folder) rmSync(folder, { recursive: true, force: true });
  });

  const manifestOf = (name: string) =>
    JSON.parse(packed.get(name)?.get('package/package.json')?.toString() ?? '{}') as {
      exports?: unknown;
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

  it.each(packages)('%s holds every file its exports and its bin name', (name) => {
    const files = packed.get(name) ?? new Map();
    const manifest = manifestOf(name);
    const named = [...targets(manifest.exports), ...Object.values(manifest.bin ?? {})];
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((path) => !files.has(`package/${path.replace(/^\.\//, '')}`))).toEqual([]);
    expect(files.has('package/README.md') && files.has('package/LICENSE')).toBe(true);
  });

  it.each(packages)('%s ships no tests, fixtures or workspace links', (name) => {
    const paths = [...(packed.get(name)?.keys() ?? [])];
    expect(
      paths.filter((path) => /\.test\.|__fixtures__|\.tsbuildinfo$|\/src\//.test(path)),
    ).toEqual([]);
    const manifest = manifestOf(name);
    const ranges = Object.values({ ...manifest.dependencies, ...manifest.peerDependencies });
    expect(ranges.filter((range) => range.startsWith('workspace:'))).toEqual([]);
  });
});
