import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** The code a bundler keeps for an application that imports these names from the package. */
async function bundle(names: readonly string[]): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: /^@plurid\/uitive-core$/, replacement: `${root}packages/core/src/index.ts` },
        { find: /^@plurid\/uitive-dom\/debug$/, replacement: `${root}packages/dom/src/debug.ts` },
        { find: /^@plurid\/uitive-dom$/, replacement: `${root}packages/dom/src/index.ts` },
      ],
    },
    plugins: [
      {
        name: 'entry',
        resolveId: (id) => (id === 'entry' ? id : undefined),
        load: (id) =>
          id === 'entry'
            ? `export { ${names.join(', ')} } from '${root}packages/react/src/index.ts';`
            : undefined,
      },
    ],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: 'entry',
        external: [/^react/, /^zod/],
        // As a library keeps them: an application's build keeps what its own code uses.
        preserveEntrySignatures: 'strict',
        output: { format: 'es' },
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs
    .flatMap((entry) => ('output' in entry ? entry.output : []))
    .map((chunk) => ('code' in chunk ? chunk.code : ''))
    .join('\n');
}

describe('bundles', () => {
  it('leave the debug panel out of builds that never render it', { timeout: 30_000 }, async () => {
    const code = await bundle(['UitiveProvider', 'Confirmations']);
    expect(code).toContain('uitive-dialog');
    expect(code).not.toContain('uitive-debug');
    expect(code).not.toContain('Simulate a week');
    expect(await bundle(['UitiveDebug'])).toContain('uitive-debug');
  });
});
