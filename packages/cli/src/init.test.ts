import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { check } from './check.js';
import { detect } from './detect.js';
import { init, withOverrides } from './init.js';
import { SKILL } from './templates.js';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** A project folder whose packages resolve, as if installed. */
async function project(manifest: object, files: Record<string, string> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'uitive-'));
  await writeFile(join(cwd, 'package.json'), JSON.stringify(manifest));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(cwd, path, '..'), { recursive: true });
    await writeFile(join(cwd, path), content);
  }
  await symlink(here('../node_modules'), join(cwd, 'node_modules'));
  return cwd;
}

describe('init', () => {
  it('writes inside src when there is one, so the build and its typecheck include it', async () => {
    const cwd = await project(
      { name: 'admin', dependencies: { react: '^19.0.0', zod: '^4.6.5' } },
      { 'src/main.tsx': '', 'package-lock.json': '' },
    );
    const result = await init({ cwd, install: false, agents: false });
    expect(result.written).toEqual([
      'package.json',
      'src/uitive/contract.ts',
      'src/uitive/bindings.ts',
      'src/uitive/client.ts',
      'src/uitive/kit.tsx',
    ]);
    expect(await readFile(join(cwd, 'src/uitive/bindings.ts'), 'utf8')).toContain(
      'Bindings<typeof contract>',
    );
    expect((await check({ cwd })).checks.filter((entry) => !entry.ok)).toEqual([]);
  });

  it('mounts the planner in Next.js on one route for plans and commands', async () => {
    const cwd = await project(
      { name: 'console', dependencies: { next: '^16.0.0', react: '^19.0.0', zod: '^4.6.5' } },
      { 'app/page.tsx': '', 'package-lock.json': '' },
    );
    const result = await init({ cwd, install: false, agents: false });
    expect(result.written).toContain('app/api/uitive/[kind]/route.ts');
    expect(await readFile(join(cwd, 'app/api/uitive/[kind]/route.ts'), 'utf8')).toContain(
      "from '../../../../uitive/server'",
    );
  });

  it('shares the application’s zod, and says when it is too old', async () => {
    for (const [zod, warned] of [
      ['4.2.0', false],
      ['^3.23.8', true],
    ] as const) {
      const cwd = await project(
        { name: 'shop', dependencies: { react: '^19.0.0', zod } },
        { 'package-lock.json': '' },
      );
      const result = await init({ cwd, install: false, agents: false });
      expect(result.next[0]).toBe(
        'Install the packages: npm install @plurid/uitive-core @plurid/uitive-react && npm install --save-dev @plurid/uitive-cli',
      );
      expect(
        result.next.some((step) => step.includes('needs 4.2 or later')),
        zod,
      ).toBe(warned);
    }
  });

  it('warns about a second copy of zod', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'uitive-'));
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'two', type: 'module' }));
    await mkdir(join(cwd, 'node_modules', '@plurid'), { recursive: true });
    await symlink(here('../../core'), join(cwd, 'node_modules', '@plurid', 'uitive-core'));
    // The same code under another path and version, as a package manager's second copy is.
    const zod = join(cwd, 'node_modules', 'zod');
    await mkdir(zod);
    await writeFile(
      join(zod, 'package.json'),
      JSON.stringify({
        name: 'zod',
        version: '4.2.0',
        type: 'module',
        exports: { '.': './index.js', './package.json': './package.json' },
      }),
    );
    await writeFile(
      join(zod, 'index.js'),
      `export * from ${JSON.stringify(here('../node_modules/zod/index.js'))};\n`,
    );
    await mkdir(join(cwd, 'uitive'));
    await writeFile(
      join(cwd, 'uitive', 'contract.ts'),
      `import { action, defineApp, list } from '@plurid/uitive-core';
export const contract = defineApp({
  id: 'two',
  description: 'Two copies of zod',
  actions: { open: action({ label: 'Open', description: 'Opens the file' }) },
  surfaces: { menu: list({ label: 'Menu', description: 'The menu', items: ['open'], capacity: 1 }) },
});
`,
    );
    const checked = await check({ cwd });
    expect(checked.warnings.find((warning) => warning.startsWith('Two copies of zod'))).toMatch(
      /^Two copies of zod: the application's 4\.2\.0 and Uitive's 4\.\d+\.\d+/,
    );
  });

  it('puts its files where the build compiles them, and every command finds them there', async () => {
    const cwd = await project(
      {
        name: 'spreadsheet',
        dependencies: { grainjs: '^1.0.2' },
        devDependencies: { typescript: '^5.6.0' },
      },
      { 'yarn.lock': '' },
    );
    const result = await init({
      cwd,
      install: false,
      agents: false,
      dir: './app/client/uitive/',
    });
    expect(result.written).toEqual([
      'package.json',
      'app/client/uitive/contract.ts',
      'app/client/uitive/bindings.ts',
      'app/client/uitive/client.ts',
    ]);
    expect(JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')).uitive).toEqual({
      dir: 'app/client/uitive',
    });
    // Without React, the DOM package, and how to use it.
    expect(result.next[0]).toBe(
      'Install the packages: yarn add @plurid/uitive-core zod @plurid/uitive-dom && yarn add -D @plurid/uitive-cli',
    );
    expect(result.next.at(-2)).toMatch(/^Without React, use @plurid\/uitive-dom: call startUitive/);
    const checked = await check({ cwd });
    expect(checked.checks.filter((entry) => !entry.ok)).toEqual([]);
    expect((await detect(cwd)).uitive).toBe(true);
  });

  it('sets a React project up so that check passes, and keeps every file on a second run', async () => {
    const cwd = await project(
      {
        name: '@acme/shop-admin',
        dependencies: { react: '^18.3.1', 'react-router-dom': '^6.30.0', '@medusajs/ui': '^4.0.0' },
        devDependencies: { vite: '^5.4.0', typescript: '^5.6.0' },
      },
      { 'pnpm-lock.yaml': '', '.cursor/rules.md': '', '.claude/settings.json': '{}' },
    );
    await copyFile(here('../../../tools/fixtures/openapi/shop.yaml'), join(cwd, 'openapi.yaml'));

    const result = await init({ cwd, install: false });
    expect(result.detection).toMatchObject({
      name: '@acme/shop-admin',
      packageManager: 'pnpm',
      ui: { name: 'react', version: '18.3.1' },
      framework: { name: 'vite' },
      router: { name: 'react-router' },
      designSystems: [{ name: '@medusajs/ui' }],
      openapi: ['openapi.yaml'],
      agents: ['claude-code', 'cursor'],
    });
    expect(result.written).toEqual([
      'uitive/api.generated.ts',
      'uitive/contract.ts',
      'uitive/bindings.ts',
      'uitive/client.ts',
      'uitive/kit.tsx',
      '.mcp.json',
      '.cursor/mcp.json',
      '.claude/skills/integrate-uitive/SKILL.md',
    ]);
    expect(result.next[0]).toBe(
      'Install the packages: pnpm add @plurid/uitive-core zod @plurid/uitive-react && pnpm add -D @plurid/uitive-cli',
    );
    expect(JSON.parse(await readFile(join(cwd, '.mcp.json'), 'utf8'))).toEqual({
      mcpServers: { uitive: { command: 'npx', args: ['-y', '@plurid/uitive-mcp'] } },
    });
    expect(await readFile(join(cwd, '.claude/skills/integrate-uitive/SKILL.md'), 'utf8')).toBe(
      SKILL,
    );

    const checked = await check({ cwd });
    expect(checked.checks.filter((entry) => !entry.ok)).toEqual([]);
    expect(checked.coverage).toMatchObject({ sources: 4, routes: 1, pages: 1, regions: 1 });

    const again = await init({ cwd, install: false });
    expect(again.written).toEqual(['.mcp.json', '.cursor/mcp.json']);
    expect(again.kept).toContain('uitive/contract.ts');
  });

  it("leaves an agent's configuration it can't parse as it was, and says what to add", async () => {
    const commented = [
      '{',
      "  // The team's own servers",
      '  "servers": { "docs": { "type": "stdio", "command": "docs-mcp" } }',
      '}',
      '',
    ].join('\n');
    const cwd = await project(
      { name: 'admin', dependencies: { react: '^19.0.0', zod: '^4.6.5' } },
      { 'src/main.tsx': '', '.vscode/mcp.json': commented },
    );
    const result = await init({ cwd, install: false });
    expect(await readFile(join(cwd, '.vscode/mcp.json'), 'utf8')).toBe(commented);
    expect(result.written).not.toContain('.vscode/mcp.json');
    expect(result.kept).toContain('.vscode/mcp.json');
    expect(result.next).toContain(
      "Add the uitive MCP server to .vscode/mcp.json by hand: it isn't plain JSON, so init left it as it was.",
    );
  });

  it('configures Claude Code when Codex, which it cannot configure, is the only agent', async () => {
    const cwd = await project(
      { name: 'admin', dependencies: { react: '^19.0.0', zod: '^4.6.5' } },
      { 'src/main.tsx': '', 'AGENTS.md': '# Guidance\n' },
    );
    const result = await init({ cwd, install: false });
    expect(result.detection.agents).toEqual(['codex']);
    expect(result.written).toContain('.mcp.json');
    expect(result.written).toContain('.claude/skills/integrate-uitive/SKILL.md');
    expect(result.next).toContain(
      "Only Codex found, which init can't configure, so Claude Code is configured: .mcp.json and the integrate-uitive skill.",
    );
  });

  it('asks for a curation first when the API is large', async () => {
    const paths = Object.fromEntries(
      Array.from({ length: 45 }, (_, index) => [
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
    const cwd = await project(
      { name: 'big', dependencies: { react: '^19.0.0' } },
      {
        'openapi.json': JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Big', version: '1' },
          paths,
        }),
      },
    );
    const result = await init({ cwd, install: false, agents: false });
    expect(result.written).toContain('uitive/curation.json');
    expect(result.written).not.toContain('uitive/api.generated.ts');
    expect(result.next[1]).toMatch(/^Choose what the frontend shows in uitive\/curation\.json/);
    const curation = JSON.parse(await readFile(join(cwd, 'uitive/curation.json'), 'utf8'));
    expect(curation.default).toBe('exclude');
    expect(Object.keys(curation.sources)).toHaveLength(45);
    expect((await check({ cwd })).ok).toBe(true);
  });
});

describe('init with local packages', () => {
  it('points a yarn workspace at tarballs, before the packages are published', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uitive-'));
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['app'] }),
    );
    await writeFile(join(root, 'yarn.lock'), '');
    await mkdir(join(root, '.git'));
    await mkdir(join(root, 'app'));
    await writeFile(
      join(root, 'app', 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { react: '^19.0.0' } }),
    );
    const folder = join(root, 'tarballs');
    await mkdir(folder);
    for (const name of ['core', 'react', 'server', 'planner', 'cli']) {
      await writeFile(join(folder, `plurid-uitive-${name}-0.1.0.tgz`), '');
    }
    const result = await init({
      cwd: join(root, 'app'),
      packages: folder,
      install: false,
      agents: false,
    });
    // Relative to the package that depends on them, so the project stays movable.
    const tarball = (name: string) => `file:../tarballs/plurid-uitive-${name}-0.1.0.tgz`;
    const app = JSON.parse(await readFile(join(root, 'app', 'package.json'), 'utf8'));
    // No server here, so no server package; zod is shared with the application, so it comes too.
    expect(app.dependencies).toEqual({
      zod: '^4.6.5',
      react: '^19.0.0',
      '@plurid/uitive-core': tarball('core'),
      '@plurid/uitive-react': tarball('react'),
    });
    expect(app.devDependencies).toEqual({ '@plurid/uitive-cli': tarball('cli') });
    // Yarn reads resolutions from the workspace root, for the packages' own dependencies too:
    // every tarball, since any package left to the registry would install another build.
    const top = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(Object.keys(top.resolutions).sort()).toEqual(
      ['cli', 'core', 'planner', 'react', 'server'].map((name) => `@plurid/uitive-${name}`),
    );
    const found = await detect(root);
    expect(found.workspaces).toEqual([
      { path: 'app', name: 'app', ui: { name: 'react', version: '19.0.0' }, framework: null },
    ]);
    expect(result.next[0]).toBe('Install the packages: yarn install');
  });

  /** An app next to a folder of tarballs, using the pnpm version given. */
  async function pnpmApp(pnpm: string) {
    const root = await mkdtemp(join(tmpdir(), 'uitive-'));
    await mkdir(join(root, '.git'));
    await mkdir(join(root, 'app'));
    await writeFile(
      join(root, 'app', 'package.json'),
      JSON.stringify({ name: 'app', packageManager: pnpm, dependencies: { react: '^19.0.0' } }),
    );
    await writeFile(join(root, 'app', 'pnpm-lock.yaml'), '');
    await mkdir(join(root, 'tarballs'));
    for (const name of ['core', 'react', 'dom', 'cli']) {
      await writeFile(join(root, 'tarballs', `plurid-uitive-${name}-0.1.0.tgz`), '');
    }
    const result = await init({
      cwd: join(root, 'app'),
      packages: join(root, 'tarballs'),
      install: false,
      agents: false,
    });
    const app = JSON.parse(await readFile(join(root, 'app', 'package.json'), 'utf8'));
    return { root, result, app };
  }

  it('gives pnpm 10 and later their overrides in pnpm-workspace.yaml, which pnpm 11 requires', async () => {
    const { root, result, app } = await pnpmApp('pnpm@11.3.0');
    expect(app.pnpm).toBeUndefined();
    expect(result.written).toContain('pnpm-workspace.yaml');
    // React depends on the DOM package, so every tarball is overridden, not just what is named.
    expect(await readFile(join(root, 'app', 'pnpm-workspace.yaml'), 'utf8')).toBe(
      [
        'overrides:',
        "  '@plurid/uitive-cli': file:../tarballs/plurid-uitive-cli-0.1.0.tgz",
        "  '@plurid/uitive-core': file:../tarballs/plurid-uitive-core-0.1.0.tgz",
        "  '@plurid/uitive-dom': file:../tarballs/plurid-uitive-dom-0.1.0.tgz",
        "  '@plurid/uitive-react': file:../tarballs/plurid-uitive-react-0.1.0.tgz",
        '',
      ].join('\n'),
    );
  });

  it('gives pnpm 9 its overrides in package.json', async () => {
    const { app } = await pnpmApp('pnpm@9.15.0');
    expect(Object.keys(app.pnpm.overrides).sort()).toEqual(
      ['cli', 'core', 'dom', 'react'].map((name) => `@plurid/uitive-${name}`),
    );
  });

  it('merges overrides into a workspace file, keeping everything else', () => {
    const yaml = [
      'packages:',
      '  - app',
      '',
      'overrides:',
      "  '@plurid/uitive-core': file:old.tgz",
      '  left-pad: 1.3.0',
      '',
      'onlyBuiltDependencies:',
      '  - esbuild',
      '',
    ].join('\n');
    expect(withOverrides(yaml, { '@plurid/uitive-core': 'file:new.tgz' })).toBe(
      [
        'packages:',
        '  - app',
        '',
        'overrides:',
        "  '@plurid/uitive-core': file:new.tgz",
        '  left-pad: 1.3.0',
        '',
        'onlyBuiltDependencies:',
        '  - esbuild',
        '',
      ].join('\n'),
    );
    expect(withOverrides('packages:\n  - app\n', { a: 'file:a.tgz' })).toBe(
      "packages:\n  - app\n\noverrides:\n  'a': file:a.tgz\n",
    );
  });
});

describe('check', () => {
  it('reports a contract that does not validate', async () => {
    const cwd = await project(
      { name: 'broken' },
      {
        'uitive/contract.ts': `import { defineApp, list } from '@plurid/uitive-core';
export const contract = defineApp({
  id: 'broken',
  version: '1',
  description: 'Broken',
  actions: {},
  surfaces: { toolbar: list({ label: 'Toolbar', description: 'Buttons', items: ['nothing'], capacity: 3 }) },
});
`,
      },
    );
    const result = await check({ cwd });
    expect(result.ok).toBe(false);
    expect(result.checks).toEqual([
      { name: 'contract', ok: false, detail: expect.stringMatching(/unknown action "nothing"/) },
    ]);
  });

  it("resolves the project's tsconfig path aliases, as its build does", async () => {
    const cwd = await project(
      { name: 'aliased' },
      {
        'tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } },
        }),
        'src/tools.ts': "export const tools = ['pen', 'eraser'] as const;\n",
        'uitive/contract.ts': `import { action, defineApp, list } from '@plurid/uitive-core';
import { tools } from '@app/tools';
export const contract = defineApp({
  id: 'aliased',
  version: '1',
  description: 'Aliased',
  actions: Object.fromEntries(tools.map((tool) => [tool, action({ label: tool, description: tool })])),
  surfaces: { toolbar: list({ label: 'Toolbar', description: 'Tools', items: [...tools], capacity: 2 }) },
});
`,
      },
    );
    const result = await check({ cwd });
    expect(result.checks[0]).toMatchObject({ name: 'contract', ok: true });
  });

  it('asks for bindings when the contract has data', async () => {
    const cwd = await project(
      { name: 'unbound' },
      {
        'uitive/contract.ts': `import { defineApp, source } from '@plurid/uitive-core';
import { z } from 'zod';
export const contract = defineApp({
  id: 'unbound',
  version: '1',
  description: 'Unbound',
  actions: {},
  surfaces: {},
  sources: {
    notes: source({ label: 'Notes', description: 'Notes people keep', row: z.object({ id: z.string(), text: z.string() }), key: 'id' }),
  },
});
`,
      },
    );
    const result = await check({ cwd });
    expect(result.checks.find((entry) => entry.name === 'bindings')).toEqual({
      name: 'bindings',
      ok: false,
      detail: 'uitive/bindings.ts not found; it binds fetch',
    });
  });
});
