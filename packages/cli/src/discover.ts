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
  textOf,
} from '@plurid/uitive-adapter';
import type { Discovery, PageFacts } from '@plurid/uitive-adapter';
import { contractIn, loadModule } from './check.js';
import { folderOf } from './folder.js';

/** Where `discover` writes, in a project that keeps Uitive's files in `uitive/`; commands use the project's own folder (`folderOf`). */
export const DISCOVERY = 'uitive/discovery.json';

/** The part of Playwright's responses discovery uses. */
interface Response {
  status(): number;
  headers(): Record<string, string>;
}
/** The part of Playwright's locators discovery uses. */
interface Locator {
  ariaSnapshot(options?: { timeout: number }): Promise<string>;
  count(): Promise<number>;
  nth(index: number): Locator;
}
/** The part of Playwright discovery uses. */
interface Browser {
  newContext(options?: { storageState?: string }): Promise<{
    route(
      url: string,
      handler: (route: {
        request(): {
          url(): string;
          isNavigationRequest(): boolean;
          frame(): { parentFrame(): unknown };
        };
        continue(): Promise<void>;
        abort(): Promise<void>;
        fetch(options: { maxRedirects: number }): Promise<Response>;
        fulfill(options: { response: Response }): Promise<void>;
      }) => Promise<void>,
    ): Promise<void>;
    newPage(): Promise<{
      goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>;
      waitForLoadState(state: 'networkidle', options: { timeout: number }): Promise<void>;
      waitForTimeout(milliseconds: number): Promise<void>;
      close(): Promise<void>;
      url(): string;
      locator(selector: string): Locator;
    }>;
  }>;
  close(): Promise<void>;
}

/** Controls that open a menu or a panel: their snapshot says so only while it is open. */
const TRIGGERS = '[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded]';
/** Most triggers read on one page, each its own round trip to the browser. */
const MAX_TRIGGERS = 40;
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
  /** Pages that couldn't be read, and why, such as a redirect to another site. */
  skipped: { url: string; reason: string }[];
  /** What the pages suggest. */
  discovery: Discovery;
}

/**
 * Crawls a running application's pages, same origin only, following links but never pressing
 * anything, and proposes routes, regions, lists and button-to-action matches from what assistive
 * technology sees. Rows are never read, and the browser never navigates to another origin, not
 * even through a redirect.
 */
export async function discover(options: DiscoverOptions): Promise<DiscoverResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const start = new URL(options.url);
  const most = options.pages ?? 30;
  const perRoute = options.perRoute ?? 2;
  for (const [name, value] of [
    ['pages', most],
    ['perRoute', perRoute],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a whole number of at least 1, not ${value}`);
    }
  }
  const { chromium } = await playwright(cwd);
  const browser = await chromium.launch({
    headless: true,
    ...(options.chrome ? { channel: 'chrome' } : {}),
  });
  const facts: PageFacts[] = [];
  const skipped: DiscoverResult['skipped'] = [];
  try {
    const context = await browser.newContext(
      options.storageState ? { storageState: resolve(cwd, options.storageState) } : {},
    );
    // Pages go nowhere else: a redirect to another site is refused before it is requested.
    const redirects = new Map<string, string>();
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.isNavigationRequest() || request.frame().parentFrame() !== null) {
        await route.continue();
        return;
      }
      if (new URL(request.url()).origin !== start.origin) {
        await route.abort();
        return;
      }
      // The browser would follow a redirect by itself, wherever it leads: read it here instead,
      // unfollowed, and let the crawl decide where to go.
      const response = await route.fetch({ maxRedirects: 0 });
      const location = response.headers()['location'];
      if (response.status() >= 300 && response.status() < 400 && location !== undefined) {
        redirects.set(new URL(request.url()).href, new URL(location, request.url()).href);
        await route.abort();
      } else {
        await route.fulfill({ response });
      }
    });
    let page = await context.newPage();
    /** Where to go next, for a page that loaded; else why it didn't. */
    const visit = async (href: string): Promise<string | undefined> => {
      let target = href;
      for (let hops = 0; hops < 5; hops++) {
        try {
          await page.goto(target, { waitUntil: 'load', timeout: 15_000 });
          return undefined;
        } catch (error) {
          // A refused navigation leaves an error page that would cut the next one short: start over.
          await page.close();
          page = await context.newPage();
          const next = redirects.get(target);
          if (next === undefined) {
            const message = (error as Error).message.split('\n')[0] ?? '';
            return /timeout/i.test(message)
              ? 'it did not load within 15 seconds'
              : `it did not load (${message})`;
          }
          if (new URL(next).origin !== start.origin) return 'it leads to another site';
          target = next;
        }
      }
      return 'it redirects too many times';
    };
    const queue = [start.href];
    const queued = new Set(queue);
    const visits = new Map<string, number>();
    while (queue.length > 0 && facts.length < most) {
      const href = queue.shift() ?? '';
      if ((visits.get(templateOf(pathOf(href))) ?? 0) >= perRoute) continue;
      const failed = await visit(href);
      if (failed !== undefined) {
        skipped.push({ url: href, reason: failed });
        continue;
      }
      // Pages that keep polling never go quiet: give them a moment instead.
      await page
        .waitForLoadState('networkidle', { timeout: 5_000 })
        .catch(() => page.waitForTimeout(1_000));
      const landed = new URL(page.url());
      // A redirect elsewhere, such as to a sign-in provider, ends that path.
      if (landed.origin !== start.origin) {
        skipped.push({ url: href, reason: 'it leads to another site' });
        continue;
      }
      const template = templateOf(landed.pathname);
      if ((visits.get(template) ?? 0) >= perRoute) continue;
      visits.set(template, (visits.get(template) ?? 0) + 1);
      // A snapshot marks a menu's button only while the menu is open, so ask the page itself.
      const triggers = page.locator(TRIGGERS);
      const menus: string[] = [];
      const total = Math.min(await triggers.count().catch(() => 0), MAX_TRIGGERS);
      for (let index = 0; index < total; index++) {
        const snapshot = await triggers
          .nth(index)
          .ariaSnapshot({ timeout: 1_000 })
          .catch(() => '');
        const [node] = parseAriaSnapshot(snapshot);
        if (node && textOf(node) !== '') menus.push(textOf(node));
      }
      const found = factsOf(
        parseAriaSnapshot(await page.locator('body').ariaSnapshot()),
        landed.href,
        { menus },
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
    `${JSON.stringify({ start: start.href, visited, skipped, ...discovery }, null, 2)}\n`,
  );
  return { file: relative(cwd, file), visited, skipped, discovery };
}
