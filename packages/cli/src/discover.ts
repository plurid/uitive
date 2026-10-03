import { access, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  discoverApp,
  factsOf,
  parseAriaSnapshot,
  pathOf,
  templateOf,
} from '@plurid/uitive-adapter';
import type { Discovery, PageFacts } from '@plurid/uitive-adapter';
import { contractIn, loadModule } from './check.js';
import { folderOf } from './folder.js';

/** Where `discover` writes, in a project that keeps Uitive's files in `uitive/`; commands use the project's own folder (`folderOf`). */
export const DISCOVERY = 'uitive/discovery.json';

/** The part of Playwright discovery uses. */
interface Browser {
  newContext(options?: { storageState?: string }): Promise<{
    newPage(): Promise<{
      goto(url: string, options: { waitUntil: 'networkidle'; timeout: number }): Promise<unknown>;
      url(): string;
      locator(selector: string): { ariaSnapshot(): Promise<string> };
    }>;
  }>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: { launch(options: { headless: boolean; channel?: string }): Promise<Browser> };
}

/** Playwright from the project first, then from wherever this package can find it. */
async function playwright(cwd: string): Promise<Playwright> {
  const project = createRequire(join(cwd, 'package.json'));
  for (const name of ['playwright', 'playwright-core']) {
    try {
      return (await import(pathToFileURL(project.resolve(name)).href)) as Playwright;
    } catch {
      try {
        return (await import(name)) as Playwright;
      } catch {
        // Try the next one.
      }
    }
  }
  throw new Error(
    'Discovery drives a browser with Playwright: install it (npm install -D playwright, then npx playwright install chromium), or install playwright-core and pass --chrome to use the installed Chrome',
  );
}

/** Links whose names suggest they do something rather than go somewhere. */
const SKIP = /\b(log ?out|sign ?out|delete|remove|destroy|disconnect|revoke|unsubscribe)\b/i;

/** What `discover` takes: where the application runs, how much to crawl, and where to write. */
export interface DiscoverOptions {
  /** Where to start, such as `http://localhost:5173/`. */
  url: string;
  /** The project's root. @default process.cwd() */
  cwd?: string;
  /** Most pages visited. @default 30 */
  pages?: number;
  /** Most visits per route, such as two orders. @default 2 */
  perRoute?: number;
  /** A Playwright storage state file holding a signed-in session. */
  storageState?: string;
  /** Uses the installed Chrome instead of Playwright's Chromium. @default false */
  chrome?: boolean;
  /** Where to write the discovery. @default 'discovery.json' in the project's Uitive folder */
  out?: string;
  /**
   * Matches buttons against this contract's actions, when it exists.
   * @default 'contract.ts' in the project's Uitive folder
   */
  contract?: string;
}

/** What `discover` did: where it wrote, the pages it visited, and the discovery. */
export interface DiscoverResult {
  /** Where the discovery was written. */
  file: string;
  /** The URLs visited, in order. */
  visited: string[];
  /** What the pages suggest. */
  discovery: Discovery;
}

/**
 * Crawls a running application's pages, same origin only, following links but never pressing
 * anything, and proposes routes, regions, lists and button-to-action matches from what assistive
 * technology sees. Rows are never read.
 */
export async function discover(options: DiscoverOptions): Promise<DiscoverResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const start = new URL(options.url);
  const { chromium } = await playwright(cwd);
  const browser = await chromium.launch({
    headless: true,
    ...(options.chrome ? { channel: 'chrome' } : {}),
  });
  const facts: PageFacts[] = [];
  try {
    const context = await browser.newContext(
      options.storageState ? { storageState: resolve(cwd, options.storageState) } : {},
    );
    const page = await context.newPage();
    const queue = [start.href];
    const queued = new Set(queue);
    const visits = new Map<string, number>();
    while (queue.length > 0 && facts.length < (options.pages ?? 30)) {
      const href = queue.shift() ?? '';
      if ((visits.get(templateOf(pathOf(href))) ?? 0) >= (options.perRoute ?? 2)) continue;
      try {
        await page.goto(href, { waitUntil: 'networkidle', timeout: 15_000 });
      } catch {
        continue;
      }
      const landed = new URL(page.url());
      // A redirect elsewhere, such as to a sign-in provider, ends that path.
      if (landed.origin !== start.origin) continue;
      const template = templateOf(landed.pathname);
      if ((visits.get(template) ?? 0) >= (options.perRoute ?? 2)) continue;
      visits.set(template, (visits.get(template) ?? 0) + 1);
      const found = factsOf(
        parseAriaSnapshot(await page.locator('body').ariaSnapshot()),
        landed.href,
      );
      facts.push(found);
      const links = [
        ...found.links,
        ...found.navigation.flatMap((nav) =>
          nav.items.flatMap((item) => (item.url ? [{ name: item.name, url: item.url }] : [])),
        ),
      ];
      for (const link of links) {
        if (SKIP.test(link.name) || SKIP.test(link.url)) continue;
        const next = new URL(link.url, landed);
        next.hash = '';
        if (next.origin !== start.origin || queued.has(next.href)) continue;
        queued.add(next.href);
        queue.push(next.href);
      }
    }
  } finally {
    await browser.close();
  }

  const folder = await folderOf(cwd);
  const contractPath = resolve(cwd, options.contract ?? `${folder}/contract.ts`);
  const hasContract = await access(contractPath).then(
    () => true,
    () => false,
  );
  const contract = hasContract ? contractIn(await loadModule(contractPath)) : undefined;
  const discovery = discoverApp(facts, contract);
  const file = resolve(cwd, options.out ?? `${folder}/discovery.json`);
  await mkdir(dirname(file), { recursive: true });
  const visited = facts.map((entry) => entry.url);
  await writeFile(
    file,
    `${JSON.stringify({ start: start.href, visited, ...discovery }, null, 2)}\n`,
  );
  return { file: relative(cwd, file), visited, discovery };
}
