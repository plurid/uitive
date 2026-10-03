// Refreshes the examples embedded in the docs and regenerates the API reference: `pnpm docs`.
// With `--check`, reports what is stale instead, and exits 1.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { apiModel, renderApiPages } from './api-docs.ts';
import { embedExamples, region } from './markdown.ts';

/** The repository's root. */
export const root = fileURLToPath(new URL('../../', import.meta.url));

const exists = (path: string) =>
  readFile(join(root, path)).then(
    () => true,
    () => false,
  );

/** The Markdown files that may embed examples, from the repository's root. */
export async function documents(): Promise<string[]> {
  const guides = (await readdir(join(root, 'docs')))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`);
  const packages = await readdir(join(root, 'packages'));
  const readmes = packages.map((name) => `packages/${name}/README.md`);
  const candidates = ['README.md', ...guides, ...readmes, 'apps/extension/README.md'];
  const found = await Promise.all(
    candidates.map(async (path) => ((await exists(path)) ? path : '')),
  );
  return found.filter(Boolean).sort();
}

/** Formats text as Prettier would format the file at this path. */
export async function formatAs(text: string, path: string): Promise<string> {
  const file = join(root, path);
  return format(text, { ...((await resolveConfig(file)) ?? {}), filepath: file });
}

/** An example as the docs show it: the region, dedented, formatted like its file. */
export async function snippet(path: string, name?: string): Promise<string> {
  return formatAs(region(await readFile(join(root, path), 'utf8'), name), path);
}

/** Every file `pnpm docs` writes, with its text: guides with their examples, and the API pages. */
export async function render(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of await documents()) {
    const text = await readFile(join(root, path), 'utf8');
    out.set(path, await formatAs(await embedExamples(text, snippet), path));
  }
  for (const [path, text] of await renderApiPages(apiModel())) out.set(path, text);
  return out;
}

/** Files in docs/api that `pnpm docs` no longer writes. */
export async function leftovers(files: ReadonlyMap<string, string>): Promise<string[]> {
  const present = await readdir(join(root, 'docs/api')).catch(() => [] as string[]);
  return present.map((name) => `docs/api/${name}`).filter((path) => !files.has(path));
}

/** The files whose text on disk differs from what `pnpm docs` writes. */
export async function stale(files: ReadonlyMap<string, string>): Promise<string[]> {
  const differing = await Promise.all(
    [...files].map(async ([path, text]) => {
      const current = await readFile(join(root, path), 'utf8').catch(() => undefined);
      return current === text ? '' : path;
    }),
  );
  return differing.filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = await render();
  const changed = await stale(files);
  const extra = await leftovers(files);
  if (process.argv.includes('--check')) {
    if (changed.length + extra.length > 0) {
      console.error(`Stale, run \`pnpm docs\`: ${[...changed, ...extra].join(', ')}`);
      process.exit(1);
    }
    console.log('The docs are up to date.');
  } else {
    await mkdir(join(root, 'docs/api'), { recursive: true });
    for (const path of changed) await writeFile(join(root, path), files.get(path) ?? '');
    for (const path of extra) await rm(join(root, path));
    const touched = [...changed, ...extra.map((path) => `${path} (removed)`)];
    console.log(touched.length > 0 ? `Wrote ${touched.join(', ')}` : 'The docs are up to date.');
  }
}
