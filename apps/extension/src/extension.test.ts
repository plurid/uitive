import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDashboard } from '../../../tools/fixtures/payments-dashboard/server.ts';
import type { Dashboard } from '../../../tools/fixtures/payments-dashboard/server.ts';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const here = fileURLToPath(new URL('../', import.meta.url));

type Reply<T = Record<string, unknown>> = { ok: true; value: T } | { ok: false; problem: string };

const NONE = { measure: 'none', of: 'none', by: 'none', split: 'none', bucket: 'none' } as const;
const failed = { field: 'charges.status', op: 'eq', values: ['failed'] };
const morning = {
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
    {
      id: 'list',
      block: 'table',
      props: {
        data: 'rows',
        columns: ['charges.amount', 'charges.failure_message', 'charges.created'],
        lookups: [],
        rowActions: [],
        density: 'compact',
        link: 'none',
      },
      children: [],
    },
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
    {
      name: 'rows',
      query: {
        source: 'charges',
        fields: [
          'charges.amount',
          'charges.currency',
          'charges.failure_message',
          'charges.created',
        ],
        filter: [failed],
        sort: [{ field: 'charges.created', direction: 'desc' }],
        limit: 5,
        search: '',
        aggregate: NONE,
      },
    },
  ],
};

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

describe.skipIf(!existsSync(CHROME))(
  'the extension, in Chrome, on the fixture dashboard',
  { timeout: 30_000 },
  () => {
    let dashboard: Dashboard;
    let processHandle: ChildProcess | undefined;
    let browser: Browser | undefined;
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
      await promisify(execFile)(
        process.execPath,
        ['build.ts', '--out', 'dist/e2e', '--fixture', dashboard.url, '--api', dashboard.api],
        { cwd: here },
      );
      // Branded Chrome loads unpacked extensions over the DevTools protocol, in a throwaway profile.
      const profile = mkdtempSync(join(tmpdir(), 'uitive-chrome-'));
      processHandle = spawn(
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
        {
          path: join(here, 'dist/e2e'),
        } as never,
      )) as unknown as { id: string };
      const context = browser.contexts()[0];
      if (!context) throw new Error('No browser context');
      panel = await context.newPage();
      await panel.goto(`chrome-extension://${id}/panel/index.html`);
      expect(await worker({ kind: 'site.enable', origin: dashboard.url })).toEqual({
        ok: true,
        value: true,
      });
      site = await context.newPage();
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
      await browser?.close().catch(() => undefined);
      processHandle?.kill();
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

    it('forgets everything it keeps, keys included, on request', async () => {
      // A key for the local fixture's API only: nothing here may reach a real service.
      await worker({
        kind: 'secret.set',
        name: 'connector:stripe-dashboard:stripe:test',
        value: 'rk_test_forget',
      });
      await tab({ kind: 'ask', text: 'hide Billing' });
      expect(await display('Billing')).toBe('none');
      expect(await worker({ kind: 'forget' })).toEqual({ ok: true, value: true });
      expect(await worker({ kind: 'secret.status' })).toEqual({ ok: true, value: [] });
      await site.reload({ waitUntil: 'networkidle' });
      await site.waitForTimeout(300);
      expect(await display('Billing')).not.toBe('none');
    });

    it('never sends page text or rows to the planner', async () => {
      // Without a Claude key the request still forms, and is kept for the panel's inspector.
      await tab({ kind: 'ask', text: 'make my home a morning check of what failed overnight' });
      const reply = await tab<{ lastRequest: Record<string, unknown> }>({ kind: 'snapshot' });
      if (!reply.ok) throw new Error(reply.problem);
      const sent = JSON.stringify(reply.value.lastRequest);
      expect(await site.locator('body').textContent()).toContain('CANARY-');
      expect(sent).not.toContain('CANARY');
      expect(sent).not.toContain('example.test');
      expect(reply.value.lastRequest).toMatchObject({
        kind: 'command',
        environment: { route: 'home', anchors: { 'nav.home': 'found' } },
      });
    });
  },
);
