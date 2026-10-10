// Builds the extension: each adapter as checked JSON, then the worker (an ES module), the content
// script (one file, since content scripts can't load modules) and the side panel, plus the manifest.
//   node build.ts                          dist/, shipping the adapters in adapters/
//   node build.ts --adapters <dir> ...     ships the adapters in other folders instead, such as a
//                                          product's own; relative paths start from this folder
//   node build.ts --check                  checks every adapter and its JSON, and builds nothing
//   node build.ts --out dist-test --fixture <site origin> --api <api origin> [--fixture-adapter <id>]
// A test build points one adapter at a local fixture and is granted the fixture's origins at
// install; with --ask, the side panel asks for them, as it does for real sites.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Adapter } from '@plurid/uitive-adapter';
import react from '@vitejs/plugin-react';
import { build, createServer, normalizePath } from 'vite';
import type { InlineConfig, Plugin } from 'vite';
import { uitive } from '../../tools/vite/uitive.ts';
import { manifest } from './manifest.ts';

// The bundles are always production builds, whatever environment runs this, such as a test runner.
process.env.NODE_ENV = 'production';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'dist' },
    adapters: { type: 'string', multiple: true },
    check: { type: 'boolean', default: false },
    fixture: { type: 'string' },
    api: { type: 'string' },
    'fixture-adapter': { type: 'string' },
    ask: { type: 'boolean', default: false },
  },
});
const root = fileURLToPath(new URL('./', import.meta.url));
const out = resolve(root, values.out);
const folders = (values.adapters ?? ['adapters']).map((folder) => resolve(root, folder));
const fixture = values.fixture && values.api ? { site: values.fixture, api: values.api } : null;

const fail = (problems: readonly string[]): never => {
  console.error(problems.join('\n'));
  process.exit(1);
};

interface Built {
  adapter: Adapter;
  /** The tracked JSON file beside the adapter's source. */
  file: string;
  /** The adapter as written, before defaults fill in: what ships. */
  json: string;
}

/**
 * Adapters are written as code against the contract API, one per top-level file named for its
 * ID, and shipped as checked JSON. Every problem is reported, none skipped.
 */
async function adapters(): Promise<Built[]> {
  const server = await createServer({
    root,
    configFile: false,
    plugins: [uitive()],
    // One zod for every adapter, wherever its folder: core keeps field metadata in zod's registry.
    resolve: { dedupe: ['zod'] },
    logLevel: 'error',
  });
  const built: Built[] = [];
  const problems: string[] = [];
  try {
    // From the packages' source, as everything else here, so a build needs no built packages.
    const { checkAdapter } = (await server.ssrLoadModule(
      '@plurid/uitive-adapter',
    )) as typeof import('@plurid/uitive-adapter');
    for (const folder of folders) {
      const names = (await readdir(folder)).filter(
        (name) => name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts'),
      );
      if (names.length === 0) problems.push(`${folder}: no adapters`);
      for (const name of names.sort()) {
        const file = join(folder, name);
        const module = (await server.ssrLoadModule(`/@fs${normalizePath(file)}`)) as {
          adapter?: unknown;
        };
        if (module.adapter === undefined) {
          problems.push(`${file}: exports no adapter`);
          continue;
        }
        const checked = checkAdapter(module.adapter);
        if ('problems' in checked) {
          problems.push(...checked.problems.map((problem) => `${file}: ${problem}`));
          continue;
        }
        const { adapter } = checked;
        const twin = built.find(
          (entry) =>
            entry.adapter.id === adapter.id ||
            entry.adapter.origins.some((origin) => adapter.origins.includes(origin)),
        );
        if (basename(name, '.ts') !== adapter.id) {
          problems.push(`${file}: its adapter is "${adapter.id}", so the file is ${adapter.id}.ts`);
        } else if (twin) {
          problems.push(`${file}: "${twin.adapter.id}" has the same ID or one of its origins`);
        } else {
          built.push({
            adapter,
            file: join(folder, `${adapter.id}.json`),
            json: `${JSON.stringify(module.adapter, null, 2)}\n`,
          });
        }
      }
    }
  } finally {
    await server.close();
  }
  return problems.length > 0 ? fail(problems) : built;
}

/** The adapters as they ship: a test build points one of them at the fixture. */
function shipping(built: readonly Built[]): unknown[] {
  const list = built.map((entry) => JSON.parse(entry.json) as Record<string, unknown>);
  if (!fixture) return list;
  const id = values['fixture-adapter'] ?? (built.length === 1 ? built[0]?.adapter.id : undefined);
  if (id === undefined) {
    return fail(['Several adapters ship: name the one the fixture stands for, --fixture-adapter']);
  }
  const index = built.findIndex((entry) => entry.adapter.id === id);
  const chosen = list[index];
  if (!chosen) return fail([`No adapter "${id}" ships`]);
  const connectors = (chosen.connectors ?? {}) as Record<string, Record<string, unknown>>;
  list[index] = {
    ...chosen,
    origins: [...(chosen.origins as string[]), fixture.site],
    connectors: Object.fromEntries(
      Object.entries(connectors).map(([name, connector]) => [
        name,
        { ...connector, base: fixture.api },
      ]),
    ),
  };
  return list;
}

/** Ships exactly the adapters built, in place of the demo that `src/shipped.ts` imports. */
const shipped = (list: readonly unknown[]): Plugin => {
  const file = normalizePath(resolve(root, 'src/shipped.ts'));
  return {
    name: 'uitive-shipped-adapters',
    enforce: 'pre',
    load: (id) =>
      normalizePath(id.split('?')[0] ?? '') === file
        ? `export const shipped = ${JSON.stringify(list)};`
        : undefined,
  };
};

const built = await adapters();
if (values.check) {
  const stale: string[] = [];
  for (const entry of built) {
    if ((await readFile(entry.file, 'utf8').catch(() => '')) !== entry.json) stale.push(entry.file);
  }
  if (stale.length > 0) fail([`Stale, so run node build.ts: ${stale.join(', ')}`]);
  console.log(`Every adapter passes its checks and its JSON is current: ${built.length}.`);
  process.exit(0);
}
for (const entry of built) {
  // The JSON is tracked: a build leaves it alone unless the adapter changed.
  if ((await readFile(entry.file, 'utf8').catch(() => '')) !== entry.json) {
    await writeFile(entry.file, entry.json);
  }
}

const list = shipping(built);
const shared = (): InlineConfig => ({
  root,
  configFile: false,
  mode: 'production',
  logLevel: 'warn',
  plugins: [shipped(list), uitive(), react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { outDir: out, emptyOutDir: false, minify: true, sourcemap: false },
});

async function script(entry: string, name: string, format: 'es' | 'iife') {
  const config = shared();
  await build({
    ...config,
    build: {
      ...config.build,
      lib: { entry, formats: [format], name: 'uitive', fileName: () => name },
      // Service workers can't import(), so everything goes in one file.
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
}

await mkdir(out, { recursive: true });
await script('src/worker/index.ts', 'worker.js', 'es');
await script('src/content/index.ts', 'content.js', 'iife');
const panel = shared();
await build({
  ...panel,
  root: join(root, 'src/panel'),
  base: './',
  build: { ...panel.build, outDir: join(out, 'panel'), emptyOutDir: true },
});
const granted = fixture && !values.ask ? [fixture.site, fixture.api] : [];
await writeFile(
  join(out, 'manifest.json'),
  `${JSON.stringify(manifest({ origins: granted }), null, 2)}\n`,
);
console.log(
  `Built the extension in ${out}, with ${built.map((entry) => entry.adapter.id).join(', ')}${fixture ? `, pointed at ${fixture.site}` : ''}.`,
);
