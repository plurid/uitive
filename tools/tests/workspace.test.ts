import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const workspace = read('pnpm-workspace.yaml');
const listed = [...workspace.matchAll(/^ {2}- (.+)$/gm)].map((match) => match[1] ?? '');
const packages = readdirSync(new URL('packages/', root));

describe('workspace', () => {
  it('lists every package explicitly', () => {
    for (const name of packages) expect(listed).toContain(`packages/${name}`);
  });

  it.each(packages)('packages/%s follows the package conventions', (name) => {
    const manifest = JSON.parse(read(`packages/${name}/package.json`));
    expect(manifest.name).toBe(`@plurid/uitive-${name}`);
    expect(manifest.type).toBe('module');
    // `default` lets CommonJS servers require the package, which Node 22 and later can.
    expect(manifest.exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    });
    expect(manifest.files).toEqual(['dist']);
    expect(manifest.license).toBe('MIT');
    expect(manifest.homepage).toBe(
      `https://github.com/plurid/uitive/tree/master/packages/${name}#readme`,
    );
    // npm packs only the package's own folder, so the licence and the README's links must work
    // from there: relative links would break on the package's page.
    expect(read(`packages/${name}/LICENSE`)).toBe(read('LICENSE'));
    expect(read(`packages/${name}/README.md`)).toContain(
      `https://github.com/plurid/uitive/blob/master/docs/api/${name}.md`,
    );
    expect(read(`packages/${name}/README.md`)).not.toMatch(/\]\((?!https:|#)/);
  });

  it('keeps the core free of DOM and Node types', () => {
    const tsconfig = JSON.parse(read('packages/core/tsconfig.json'));
    expect(tsconfig.compilerOptions.lib).toEqual(['ES2022']);
    expect(tsconfig.compilerOptions.types).toEqual([]);
  });

  it('keeps the legacy code out of the workspace', () => {
    expect(listed.some((path) => path.startsWith('legacy'))).toBe(false);
  });

  // ADR 0010: `npx uitive` runs the CLI, published under its short name too.
  it('publishes the CLI as uitive, at the same version', () => {
    const cli = JSON.parse(read('packages/cli/package.json'));
    const alias = JSON.parse(read('packages/cli/uitive/package.json'));
    expect(listed).toContain('packages/cli/uitive');
    expect(alias.name).toBe('uitive');
    expect(alias.version).toBe(cli.version);
    expect(alias.dependencies).toEqual({ '@plurid/uitive-cli': 'workspace:^' });
    expect(alias.bin).toEqual({ uitive: './bin.js' });
    expect(alias.files).toEqual(['bin.js']);
    expect(cli.bin).toEqual({ uitive: './dist/bin.js' });
    expect(cli.exports['./bin']).toBe('./dist/bin.js');
    expect(read('packages/cli/uitive/bin.js')).toMatch(
      /^#!\/usr\/bin\/env node\n(?:\/\/.*\n)*import '@plurid\/uitive-cli\/bin';\n$/,
    );
    expect(read('packages/cli/uitive/LICENSE')).toBe(read('LICENSE'));
  });
});
