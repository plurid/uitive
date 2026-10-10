import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDashboard } from '../../../tools/fixtures/payments-dashboard/server.ts';
import type { Dashboard } from '../../../tools/fixtures/payments-dashboard/server.ts';

/** Chrome from CHROME_PATH, else where Chrome installs on this platform, else Playwright's own. */
function chromePath(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const programs = process.env.PROGRAMFILES ?? 'C:\\Program Files';
  const installed: Record<string, string[]> = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    win32: [join(programs, 'Google', 'Chrome', 'Application', 'chrome.exe')],
  };
  let bundled: string | undefined;
  try {
    bundled = chromium.executablePath();
  } catch {
    bundled = undefined;
  }
  return [...(installed[process.platform] ?? []), bundled].find(
    (path): path is string => path !== undefined && existsSync(path),
  );
}

const CHROME = chromePath();
const here = fileURLToPath(new URL('../', import.meta.url));

type Reply<T = Record<string, unknown>> = { ok: true; value: T } | { ok: false; problem: string };

const NONE = { measure: 'none', of: 'none', by: 'none', split: 'none', bucket: 'none' } as const;
const failed = { field: 'charges.status', op: 'eq', values: ['failed'] };
const table = (columns: string[]) => ({
  id: 'list',
  block: 'table',
  props: { data: 'rows', columns, lookups: [], rowActions: [], density: 'compact', link: 'none' },
  children: [],
});
const rows = (fields: string[], filter: unknown[]) => ({
  name: 'rows',
  query: {
    source: 'charges',
    fields,
    filter,
    sort: [{ field: 'charges.created', direction: 'desc' }],
    limit: 5,
    search: '',
    aggregate: NONE,
  },
});
const page = (list: object, data: object) => ({
  root: 'top',
  elements: [
    {
      id: 'top',
      block: 'section',
      props: { title: 'Morning check', layout: 'stack' },
      children: ['count', 'list'],
    },
    {
      id: 'count',
      block: 'metric',
      props: { data: 'count', label: 'Failed payments', compare: 'none' },
      children: [],
    },
    list,
  ],
  data: [
    {
      name: 'count',
      query: {
        source: 'charges',
        fields: [],
        filter: [failed],
        sort: [],
        limit: 20,
        search: '',
        aggregate: { ...NONE, measure: 'count' },
      },
    },
    data,
  ],
});
const morning = page(
  table(['charges.amount', 'charges.failure_message', 'charges.created']),
  rows(
    ['charges.amount', 'charges.currency', 'charges.failure_message', 'charges.created'],
    [failed],
  ),
);
/** Recent payments with their descriptions, some of which carry canaries. */
const canaries = page(
  table(['charges.amount', 'charges.description']),
  rows(['charges.amount', 'charges.currency', 'charges.description', 'charges.created'], []),
);

/** Every name in the page's accessibility tree, which closed shadow roots are part of. */
async function accessibleNames(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
    nodes: { name?: { value?: string } }[];
  };
  await session.detach();
  return nodes.flatMap((node) => (node.name?.value ? [node.name.value] : []));
}

/** Clicks an element by its role and name, closed shadow roots included, as a pointer would. */
async function press(page: Page, role: string, name: string): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
      nodes: { role?: { value?: string }; name?: { value?: string }; backendDOMNodeId?: number }[];
    };
    const node = nodes.find(
      (entry) => entry.role?.value === role && entry.name?.value === name && entry.backendDOMNodeId,
    );
    if (!node?.backendDOMNodeId) throw new Error(`No ${role} named ${name}`);
    const { model } = (await session.send('DOM.getBoxModel', {
      backendNodeId: node.backendDOMNodeId,
    })) as { model: { content: number[] } };
    const [left = 0, top = 0, right = 0, , , bottom = 0] = model.content;
    await page.mouse.click((left + right) / 2, (top + bottom) / 2);
  } finally {
    await session.detach();
  }
}

interface Launched {
  context: BrowserContext;
  session: CDPSession;
  /** The extension's ID. */
  id: string;
  /** The DevTools port, for targets Playwright doesn't list, such as the side panel. */
  port: string;
  close(): Promise<void>;
}

/** Builds the extension and loads it in Chrome, in a throwaway profile that close removes. */
async function launch(out: string, args: readonly string[]): Promise<Launched> {
  if (!CHROME) throw new Error('No Chrome');
  await promisify(execFile)(process.execPath, ['build.ts', '--out', out, ...args], { cwd: here });
  // Branded Chrome loads unpacked extensions over the DevTools protocol.
  const profile = mkdtempSync(join(tmpdir(), 'uitive-chrome-'));
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let browser: Browser | undefined;
  const close = async () => {
    await browser?.close().catch(() => undefined);
    if (child.exitCode === null) child.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    let port = '';
    for (let attempt = 0; attempt < 100 && port === ''; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const file = join(profile, 'DevToolsActivePort');
      if (existsSync(file)) port = readFileSync(file, 'utf8').split('\n')[0] ?? '';
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const session = await browser.newBrowserCDPSession();
    const { id } = (await session.send(
      'Extensions.loadUnpacked' as never,
      { path: join(here, out) } as never,
    )) as unknown as { id: string };
    const context = browser.contexts()[0];
    if (!context) throw new Error('No browser context');
    return { context, session, id, port, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Drives a page Playwright doesn't list, such as the side panel, over the DevTools protocol. */
async function attach(port: string, targetId: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  let next = 0;
  const waiting = new Map<number, (value: { result?: { value?: unknown } }) => void>();
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(String(event.data)) as {
      id?: number;
      result?: { result?: { value?: unknown } };
    };
    if (data.id !== undefined) waiting.get(data.id)?.(data.result ?? {});
  });
  const send = (method: string, params: object) =>
    new Promise<{ result?: { value?: unknown } }>((resolve) => {
      next += 1;
      waiting.set(next, resolve);
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  const evaluate = async <T>(expression: string) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
      ?.value as T;
  return {
    evaluate,
    /** Clicks a button by its text as a pointer would, so the browser trusts the click. */
    async press(text: string) {
      const box = await evaluate<{ x: number; y: number } | null>(
        `(() => {
          const found = [...document.querySelectorAll('button')].find(
            (button) => button.textContent === ${JSON.stringify(text)},
          );
          if (!found) return null;
          const rect = found.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`,
      );
      if (!box) throw new Error(`No button ${text}`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, ...box, button: 'left', clickCount: 1 });
      }
    },
    close: () => socket.close(),
  };
}

// In CI the suite has to run: a missing Chrome fails there rather than skipping.
if (!CHROME && process.env.CI) {
  it('runs the extension in Chrome', () => {
    throw new Error('No Chrome found: set CHROME_PATH to a Chrome or Chromium executable');
  });
}

describe.skipIf(!CHROME)(
  'the extension, in Chrome, on the fixture dashboard',
  { timeout: 30_000 },
  () => {
    let dashboard: Dashboard;
    let launched: Launched | undefined;
    let panel: Page;
    let site: Page;
    let tabId: number;

    const tab = <T>(message: object) =>
      panel.evaluate(([id, body]) => chrome.tabs.sendMessage(id, body), [
        tabId,
        message,
      ] as const) as Promise<Reply<T>>;
    const worker = <T>(message: object) =>
      panel.evaluate((body) => chrome.runtime.sendMessage(body), message) as Promise<Reply<T>>;
    const display = (text: string) =>
      site
        .locator('nav a', { hasText: text })
        .evaluate((element) => getComputedStyle(element).display);

    beforeAll(async () => {
      dashboard = await startDashboard();
      launched = await launch('dist/e2e', ['--fixture', dashboard.url, '--api', dashboard.api]);
      panel = await launched.context.newPage();
      await panel.goto(`chrome-extension://${launched.id}/panel/index.html`);
      expect(await worker({ kind: 'site.enable', origin: dashboard.url })).toEqual({
        ok: true,
        value: true,
      });
      site = await launched.context.newPage();
      await site.goto(`${dashboard.url}/test/dashboard`, { waitUntil: 'networkidle' });
      const [found] = (await panel.evaluate(() =>
        chrome.tabs
          .query({ url: 'http://127.0.0.1/*' })
          .then((tabs) => tabs.map((entry) => entry.id)),
      )) as number[];
      if (found === undefined) throw new Error('The fixture tab is missing');
      tabId = found;
    }, 90_000);

    afterAll(async () => {
      await launched?.close();
      await dashboard?.close();
    });

    it('finds every part of the page the adapter names', async () => {
      const reply = await tab<{
        route: string;
        mode: string;
        anchors: Record<string, string>;
        timing: { syncs: number; p95: number };
        paused: string | null;
      }>({ kind: 'snapshot' });
      expect(reply.ok && reply.value).toMatchObject({ route: 'home', mode: 'test', paused: null });
      if (!reply.ok) return;
      expect(Object.values(reply.value.anchors).every((state) => state === 'found')).toBe(true);
      // Keeping up with the page stays within budget.
      expect(reply.value.timing.syncs).toBeGreaterThan(0);
      expect(reply.value.timing.p95).toBeLessThan(8);
    });

    it('hides a sidebar link through re-renders and reloads, and shows the original on request', async () => {
      const asked = await tab<{ status: string; applied: number }>({
        kind: 'ask',
        text: 'hide Connect',
      });
      expect(asked.ok && asked.value).toMatchObject({ status: 'done', applied: 1 });
      expect(await display('Connect')).toBe('none');
      // The page re-renders its sidebar on every navigation; the mark comes back before paint.
      await site.locator('nav a', { hasText: 'Transactions' }).click();
      await site.waitForURL(/\/test\/payments$/);
      expect(await display('Connect')).toBe('none');
      await site.reload({ waitUntil: 'networkidle' });
      await site.waitForTimeout(300);
      expect(await display('Connect')).toBe('none');
      await site.keyboard.press('Alt+Shift+KeyA');
      expect(await display('Connect')).not.toBe('none');
      await site.keyboard.press('Alt+Shift+KeyA');
      expect(await display('Connect')).toBe('none');
      // Typing is never a shortcut, and a script's key presses are not the person's.
      await site.locator('input[type="search"]').focus();
      await site.keyboard.press('Alt+Shift+KeyA');
      expect(await display('Connect')).toBe('none');
      await site.locator('input[type="search"]').blur();
      await site.evaluate(() =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyA' }),
        ),
      );
      expect(await display('Connect')).toBe('none');
      const reset = await tab({ kind: 'reset' });
      expect(reset.ok).toBe(true);
      expect(await display('Connect')).not.toBe('none');
    });

    it('offers hidden links in a More list that still navigates', async () => {
      await site.goto(`${dashboard.url}/test/dashboard`, { waitUntil: 'networkidle' });
      await tab({ kind: 'ask', text: 'hide Connect' });
      await expect.poll(async () => (await accessibleNames(site)).includes('More (1)')).toBe(true);
      await press(site, 'button', 'More (1)');
      await expect.poll(async () => (await accessibleNames(site)).includes('Connect')).toBe(true);
      await press(site, 'button', 'Connect');
      await site.waitForURL(/\/test\/connect$/);
      expect(await site.locator('main h1').textContent()).toBe('Connect');
      await tab({ kind: 'reset' });
      await expect.poll(() => site.locator('[data-uitive-more]').count()).toBe(0);
    });

    it('keeps the More list last when a link moves to the top', async () => {
      await site.goto(`${dashboard.url}/test/dashboard`, { waitUntil: 'networkidle' });
      await tab({ kind: 'ask', text: 'hide Connect' });
      const moved = await tab<{ status: string }>({
        kind: 'ask',
        text: 'move Reporting to the top',
      });
      expect(moved.ok && moved.value.status).toBe('done');
      const shown = () =>
        site.locator('nav.sidebar').evaluate((nav) =>
          [...nav.children]
            .map((child, index) => ({ child, index, style: getComputedStyle(child) }))
            .filter(({ style }) => style.display !== 'none')
            .sort((a, b) => Number(a.style.order) - Number(b.style.order) || a.index - b.index)
            .map(({ child }) =>
              child.hasAttribute('data-uitive-more') ? 'More' : child.textContent,
            ),
        );
      await expect
        .poll(shown)
        .toEqual([
          'Reporting',
          'Home',
          'Balances',
          'Transactions',
          'Customers',
          'Product catalog',
          'Billing',
          'More',
        ]);
      await tab({ kind: 'reset' });
    });

    it('repairs an anchor from one click after the site renames it', async () => {
      await site.goto(`${dashboard.url}/test/dashboard?variant=renamed`, {
        waitUntil: 'networkidle',
      });
      const before = await tab<{ anchors: Record<string, string> }>({ kind: 'snapshot' });
      expect(before.ok && before.value.anchors['nav.customers']).toBe('missing');
      const picking = tab<{
        strategy: unknown;
        report: { anchors: Record<string, string>; repairs: string[] };
      }>({ kind: 'pick', anchor: 'nav.customers' });
      await site.waitForSelector('[data-uitive-pick]', { state: 'attached' });
      await site.locator('nav a', { hasText: 'Buyers' }).click();
      const repaired = await picking;
      if (!repaired.ok) throw new Error(repaired.problem);
      // The link's path, which survives translation, with the test-mode prefix optional.
      expect(repaired.value.strategy).toEqual({ href: '^(/test)?/buyers/?$' });
      expect(repaired.value.report.anchors['nav.customers']).toBe('found');
      expect(repaired.value.report.repairs).toEqual(['nav.customers']);
      // Picking doesn't navigate: the click never reached the page.
      expect(new URL(site.url()).pathname).toBe('/test/dashboard');
      // The repaired anchor works like the original one.
      await tab({ kind: 'ask', text: 'hide Customers' });
      expect(await display('Buyers')).toBe('none');
      await tab({ kind: 'reset' });
      await tab({ kind: 'repairs.clear' });
      await site.goto(`${dashboard.url}/test/dashboard?variant=original`, {
        waitUntil: 'networkidle',
      });
    });

    it('refuses secret keys, and keys for the other mode', async () => {
      const name = 'connector:stripe-dashboard:stripe:test';
      expect(await worker({ kind: 'secret.set', name, value: 'sk_test_123' })).toMatchObject({
        ok: false,
        problem: expect.stringMatching(/^Secret keys are refused/),
      });
      expect(await worker({ kind: 'secret.set', name, value: 'rk_live_123' })).toMatchObject({
        ok: false,
        problem: expect.stringMatching(/^That isn't a test restricted key/),
      });
      expect(await worker({ kind: 'secret.status' })).toEqual({ ok: true, value: [] });
    });

    it('redesigns a page on official API data, drawn in a closed shadow root', async () => {
      await site.goto(`${dashboard.url}/test/dashboard`, { waitUntil: 'networkidle' });
      const name = 'connector:stripe-dashboard:stripe:test';
      expect(await worker({ kind: 'secret.set', name, value: 'rk_test_e2e' })).toEqual({
        ok: true,
        value: true,
      });
      const applied = await tab<{ applied: number; rejected: string[] }>({
        kind: 'page',
        surface: 'home',
        value: morning,
      });
      expect(applied.ok && applied.value).toMatchObject({ applied: 1, rejected: [] });
      await site.waitForSelector('[data-uitive-overlay]', { state: 'attached' });
      // The original page is replaced, the redesign drawn where it was.
      expect(
        await site.locator('main').evaluate((element) => getComputedStyle(element).display),
      ).toBe('none');
      await expect
        .poll(async () => (await accessibleNames(site)).includes('Failed payments'), {
          timeout: 10_000,
        })
        .toBe(true);
      const names = await accessibleNames(site);
      expect(names).toContain('Morning check');
      expect(names.some((entry) => /declined/i.test(entry))).toBe(true);
      // Rows came from the API with the person's restricted key, never from the page.
      const reads = dashboard.requests.filter((entry) => entry.path.startsWith('/v1/charges'));
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every((entry) => entry.authorization === 'Bearer rk_test_e2e')).toBe(true);
      await tab({ kind: 'reset' });
      await expect.poll(() => site.locator('[data-uitive-overlay]').count()).toBe(0);
    });

    it('never sends page text, rows or IDs to the planner, with both on screen', async () => {
      await site.goto(`${dashboard.url}/test/dashboard`, { waitUntil: 'networkidle' });
      await worker({
        kind: 'secret.set',
        name: 'connector:stripe-dashboard:stripe:test',
        value: 'rk_test_e2e',
      });
      const applied = await tab<{ applied: number }>({
        kind: 'page',
        surface: 'home',
        value: canaries,
      });
      expect(applied.ok && applied.value.applied).toBe(1);
      // Rows from the API with canaries in them, and the page's own canary, both on screen.
      await expect
        .poll(async () => (await accessibleNames(site)).some((name) => name.includes('CANARY-')), {
          timeout: 10_000,
        })
        .toBe(true);
      expect(await site.locator('body').textContent()).toContain('CANARY-');
      const extension = `chrome-extension://${launched?.id}/`;
      const serviceWorker =
        launched?.context.serviceWorkers().find((entry) => entry.url().startsWith(extension)) ??
        (await launched?.context.waitForEvent('serviceworker'));
      if (!serviceWorker) throw new Error('No service worker');
      // A listener beside the worker's own keeps whatever reaches the planner port.
      await serviceWorker.evaluate(() => {
        const kept: unknown[] = [];
        (globalThis as unknown as { received: unknown[] }).received = kept;
        chrome.runtime.onConnect.addListener((port) =>
          port.onMessage.addListener((message: unknown) => {
            kept.push(message);
          }),
        );
      });
      await tab({ kind: 'ask', text: 'make my home a morning check of what failed overnight' });
      const received = (await serviceWorker.evaluate(
        () => (globalThis as unknown as { received: unknown[] }).received,
      )) as {
        adapter: string;
        request: { summary: { rows: { action: string; uses: number }[] } };
      }[];
      expect(received).toHaveLength(1);
      const sent = JSON.stringify(received);
      expect(sent).not.toContain('CANARY');
      expect(sent).not.toContain('example.test');
      // The fixture's row IDs all end alike.
      expect(sent).not.toContain('Q7M3W2B4A5');
      expect(received[0]).toMatchObject({
        adapter: 'stripe-dashboard',
        request: {
          kind: 'command',
          text: 'make my home a morning check of what failed overnight',
          environment: {
            route: 'home',
            anchors: { 'nav.home': 'found' },
            sources: { charges: 'live' },
          },
        },
      });
      // The person's own click on Transactions, earlier on, taught it.
      expect(
        received[0]?.request.summary.rows.some(
          (row) => row.action === 'nav.transactions' && row.uses > 0,
        ),
      ).toBe(true);
      // The panel's inspector shows exactly what left.
      const reply = await tab<{ lastRequest: unknown }>({ kind: 'snapshot' });
      expect(reply.ok && reply.value.lastRequest).toEqual(received[0]?.request);
      await tab({ kind: 'reset' });
      await expect.poll(() => site.locator('[data-uitive-overlay]').count()).toBe(0);
    });

    it('forgets everything it keeps, keys included, and stops on every site', async () => {
      // A key for the local fixture's API only: nothing here may reach a real service.
      await worker({
        kind: 'secret.set',
        name: 'connector:stripe-dashboard:stripe:test',
        value: 'rk_test_forget',
      });
      await tab({ kind: 'ask', text: 'hide Billing' });
      expect(await display('Billing')).toBe('none');
      const kept = () =>
        site.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('uitive:')));
      expect(await kept()).toEqual(['uitive:stripe-dashboard']);
      expect(await worker({ kind: 'forget' })).toEqual({ ok: true, value: true });
      expect(await worker({ kind: 'secret.status' })).toEqual({ ok: true, value: [] });
      // The open page hears of it at once, and what its tab kept goes too.
      await expect.poll(() => display('Billing')).not.toBe('none');
      expect(await kept()).toEqual([]);
      const status = await worker<{ enabled: boolean }>({ kind: 'site.status', tabId });
      expect(status.ok && status.value.enabled).toBe(false);
      await site.reload({ waitUntil: 'networkidle' });
      await site.waitForTimeout(300);
      expect(await display('Billing')).not.toBe('none');
      // No content script runs here any more.
      expect(
        await panel.evaluate(
          (id) =>
            chrome.tabs.sendMessage(id, { kind: 'snapshot' }).then(
              () => 'answered',
              () => 'nobody',
            ),
          tabId,
        ),
      ).toBe('nobody');
    });
  },
);

describe.skipIf(!CHROME)(
  'the extension as published, granted nothing at install',
  { timeout: 30_000 },
  () => {
    let dashboard: Dashboard;
    let launched: Launched | undefined;

    beforeAll(async () => {
      dashboard = await startDashboard();
      // The API under another host name, so the request shows both: patterns leave ports out.
      const api = dashboard.api.replace('127.0.0.1', 'localhost');
      launched = await launch('dist/e2e-ask', ['--fixture', dashboard.url, '--api', api, '--ask']);
    }, 90_000);

    afterAll(async () => {
      await launched?.close();
      await dashboard?.close();
    });

    // Chrome's permission prompt can't be automated, so this stops at the request the side panel
    // makes; that granting it enables the site is checked by hand, as the README says.
    it('asks for the site and its API together, from the side panel, where the address is hidden', async () => {
      if (!launched) throw new Error('Not launched');
      const { context, session, id, port } = launched;
      const site = await context.newPage();
      await site.goto(`${dashboard.url}/test/dashboard`, { waitUntil: 'networkidle' });
      expect(await site.locator('[data-uitive]').count()).toBe(0);
      const targets = async (type?: string) =>
        (
          (await session.send(
            'Target.getTargets' as never,
            (type ? { filter: [{ type }] } : {}) as never,
          )) as unknown as { targetInfos: { targetId: string; type: string; url: string }[] }
        ).targetInfos;
      const tab = (await targets('tab')).find((entry) => entry.url.startsWith(dashboard.url));
      if (!tab) throw new Error('No tab for the dashboard');
      // As a click on the toolbar button does: it opens the side panel for the tab.
      await session.send(
        'Extensions.triggerAction' as never,
        { id, targetId: tab.targetId } as never,
      );
      let target: { targetId: string } | undefined;
      await expect
        .poll(async () => {
          target = (await targets()).find((entry) =>
            entry.url.startsWith(`chrome-extension://${id}/panel/`),
          );
          return target !== undefined;
        })
        .toBe(true);
      if (!target) throw new Error('No side panel');
      const sidePanel = await attach(port, target.targetId);
      try {
        const host = new URL(dashboard.url).host;
        const text = () =>
          sidePanel.evaluate<string>("document.querySelector('main')?.textContent ?? ''");
        await expect.poll(text).toContain(`Enable on ${host}`);
        expect(await text()).toContain('Forget everything');
        await sidePanel.evaluate(
          'chrome.permissions.request = (asked) => { window.asked = asked; return Promise.resolve(false); }',
        );
        await sidePanel.press(`Enable on ${host}`);
        await expect
          .poll(() => sidePanel.evaluate<unknown>('window.asked'))
          .toEqual({
            origins: ['http://127.0.0.1/*', 'http://localhost/*'],
          });
      } finally {
        sidePanel.close();
      }
    });
  },
);
