// Builds the extension: the adapters as data, then the worker (an ES module), the content script
// (one file, since content scripts can't load modules) and the side panel, plus the manifest.
//   node build.ts                     dist/, for loading unpacked
//   node build.ts --out dist-test --fixture <site origin> --api <api origin>   for tests
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import react from '@vitejs/plugin-react';
import { build, createServer } from 'vite';
import type { InlineConfig } from 'vite';
import { uitive } from '../../tools/vite/uitive.ts';
import { manifest } from './manifest.ts';

// The bundles are always production builds, whatever environment runs this, such as a test runner.
process.env.NODE_ENV = 'production';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'dist' },
    fixture: { type: 'string' },
    api: { type: 'string' },
  },
});
const root = new URL('./', import.meta.url).pathname;
const out = new URL(`${values.out}/`, import.meta.url).pathname;
const fixture = values.fixture && values.api ? { site: values.fixture, api: values.api } : null;

/** Adapters are written as code against the contract API, and shipped as checked JSON. */
async function adapters() {
  const server = await createServer({
    root,
    configFile: false,
    plugins: [uitive()],
    logLevel: 'error',
  });
  try {
    const module = (await server.ssrLoadModule('/adapters/stripe-dashboard.ts')) as {
      adapter: unknown;
    };
    await writeFile(
      new URL('./adapters/stripe-dashboard.json', import.meta.url),
      `${JSON.stringify(module.adapter, null, 2)}\n`,
    );
  } finally {
    await server.close();
  }
}

const shared = (): InlineConfig => ({
  root,
  configFile: false,
  mode: 'production',
  logLevel: 'warn',
  plugins: [uitive(), react()],
  define: {
    __FIXTURE__: JSON.stringify(fixture),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
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

await adapters();
await mkdir(out, { recursive: true });
await script('src/worker/index.ts', 'worker.js', 'es');
await script('src/content/index.ts', 'content.js', 'iife');
const panel = shared();
await build({
  ...panel,
  root: `${root}src/panel/`,
  base: './',
  build: { ...panel.build, outDir: `${out}panel/`, emptyOutDir: true },
});
await writeFile(
  `${out}manifest.json`,
  `${JSON.stringify(manifest({ origins: fixture ? [fixture.site, fixture.api] : [] }), null, 2)}\n`,
);
console.log(
  `Built the extension in ${values.out}/${fixture ? `, pointed at ${fixture.site}` : ''}.`,
);
