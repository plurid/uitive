import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leftovers, render, root, stale } from '../build/docs.ts';
import { anchors, fences, links, markers } from '../build/markdown.ts';

const read = (path: string) => readFileSync(join(root, path), 'utf8');
const EM_DASH = String.fromCharCode(0x2014);

/** Every file in the repository that git would keep, from its root. */
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter(
    (path) => path !== '' && existsSync(join(root, path)) && statSync(join(root, path)).isFile(),
  );

const BINARY = /\.(png|jpe?g|gif|ico|ai|tgz|woff2?|ttf|pdf)$/;
const text = files.filter(
  (path) =>
    !BINARY.test(path) &&
    !/^(legacy\/|tools\/fixtures\/aria\/)/.test(path) &&
    !/(^|\/)(node_modules|dist)\//.test(path) &&
    path !== 'pnpm-lock.yaml',
);

/** The Markdown that links into the repository: guides, READMEs and the agents' playbooks. */
const documents = files.filter(
  (path) =>
    path.endsWith('.md') &&
    !path.startsWith('legacy/') &&
    (/^(README|CONTEXT|AGENTS)\.md$/.test(path) ||
      path.startsWith('docs/') ||
      /^packages\/(?:[^/]+\/)+README\.md$/.test(path) ||
      path === 'apps/extension/README.md' ||
      path.startsWith('plugins/')),
);

/** Links to this repository on GitHub, which npm pages need, mapped to their files. */
const GITHUB =
  /^https:\/\/(?:github\.com\/plurid\/uitive\/(?:blob|tree)\/master|raw\.githubusercontent\.com\/plurid\/uitive\/master)\/(.*)$/;

describe('the documentation', () => {
  it('embeds every example as its file says, keeps the API pages current, and is formatted', async () => {
    const files = await render();
    expect([...(await stale(files)), ...(await leftovers(files))]).toEqual([]);
  }, 60_000);

  it('links only to files and headings that exist', () => {
    const broken: string[] = [];
    for (const path of documents) {
      for (const link of links(read(path))) {
        const local = GITHUB.exec(link.href)?.[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(link.href) && local === undefined) continue;
        const [target = '', anchor] = (local ?? link.href).split('#');
        const file =
          target === ''
            ? path
            : local !== undefined
              ? normalize(target)
              : normalize(join(dirname(path), target));
        const where = `${path}:${link.line} ${link.href}`;
        if (relative(root, join(root, file)).startsWith('..') || !existsSync(join(root, file))) {
          broken.push(`${where} (no such file)`);
        } else if (anchor) {
          if (!file.endsWith('.md')) broken.push(`${where} (anchor on a file that isn't Markdown)`);
          else if (!anchors(read(file)).has(anchor)) broken.push(`${where} (no such heading)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('uses no em dashes, anywhere', () => {
    expect(text.filter((path) => read(path).includes(EM_DASH))).toEqual([]);
  });

  it('uses the name Uitive, but in the records that keep the old one', () => {
    // Decision records are immutable, and the findings say which name their runs used (ADR 0009).
    const records = /^(docs\/adr\/000[1-9]-|docs\/findings\.md$)/;
    // The old name is built from parts, so this file doesn't trip its own check.
    const name = new RegExp(['ap', 'tuitive'].join(''), 'i');
    // Its prefix too, in class names and on its own, as elements, attributes and paths had it.
    const prefix = /\bApt[A-Z]|\bapt\b/;
    const stale = (path: string) => name.test(read(path)) || prefix.test(read(path));
    expect(text.filter((path) => !records.test(path) && stale(path))).toEqual([]);
  });

  it('gives every code block a language', () => {
    const bare = documents.flatMap((path) =>
      fences(read(path))
        .filter((fence) => fence.lang === '')
        .map((fence) => `${path}:${fence.start + 1}`),
    );
    expect(bare).toEqual([]);
  });

  it('shows only TypeScript that compiles: every ts or tsx block comes from an example', () => {
    const typed = documents.filter(
      (path) =>
        path === 'README.md' ||
        /^docs\/[^/]+\.md$/.test(path) ||
        /^packages\/[^/]+\/README\.md$/.test(path),
    );
    const loose = typed.flatMap((path) => {
      const lines = read(path).split('\n');
      const marked = new Set(markers(read(path)).map((marker) => marker.line));
      return fences(read(path))
        .filter((fence) => fence.lang === 'ts' || fence.lang === 'tsx')
        .filter((fence) => {
          let above = fence.start - 1;
          while (above >= 0 && (lines[above] ?? '').trim() === '') above--;
          return !marked.has(above) && (lines[above] ?? '').trim() !== '<!-- not-typechecked -->';
        })
        .map((fence) => `${path}:${fence.start + 1}`);
    });
    expect(loose).toEqual([]);
  });

  it('lists every guide in the README, and embeds or lists every example', () => {
    const readme = read('README.md');
    const guides = files.filter((path) => /^docs\/[^/]+\.md$/.test(path));
    expect(guides.filter((path) => !readme.includes(`](${path})`))).toEqual([]);
    const embedded = new Set(
      documents.flatMap((path) => markers(read(path)).map((marker) => marker.path)),
    );
    const index = existsSync(join(root, 'docs/examples/README.md'))
      ? read('docs/examples/README.md')
      : '';
    const examples = files.filter(
      (path) => path.startsWith('docs/examples/') && path !== 'docs/examples/README.md',
    );
    expect(
      examples.filter(
        (path) => !embedded.has(path) && !index.includes(path.slice('docs/examples/'.length)),
      ),
    ).toEqual([]);
  });
});
