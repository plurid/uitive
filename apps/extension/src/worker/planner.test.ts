import { createUitive, memoryStore } from '@plurid/uitive-core';
import type { PlanRequest } from '@plurid/uitive-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../__fixtures__/chrome.ts';
import { adapterById } from '../adapters.ts';
import { planMessage } from '../messages.ts';
import type { PlanReply } from '../messages.ts';

vi.mock('./secrets.ts', () => ({ getSecret: async () => undefined }));

const loaded = adapterById('acme-payments');
if (!loaded) throw new Error('No adapter');
const ORIGIN = 'https://dashboard.acme-payments.example';

/** A request exactly as the content script's client builds one. */
function request(text = 'hide Partners'): PlanRequest {
  const client = createUitive({
    contract: loaded!.contract,
    store: memoryStore(),
    environment: () => ({
      route: 'home',
      anchors: { 'nav.home': 'found', sidebar: 'found' },
      sources: { charges: 'live' },
      unmapped: { links: 3, buttons: 1, tables: 0 },
    }),
  });
  client.setLocation('/dashboard');
  client.record('nav.home', { via: 'region', surface: 'sidebar' });
  return client.request('command', text);
}

const message = (body: unknown) => ({ adapter: 'acme-payments', request: body });

/** A port as a content script on the dashboard opens one, and what the worker posts to it. */
function port(origin = ORIGIN) {
  const replies: PlanReply[] = [];
  const listeners: ((raw: unknown) => void)[] = [];
  const handle = {
    name: 'planner',
    sender: { id: 'uitive-test', origin },
    onMessage: { addListener: (listener: (raw: unknown) => void) => listeners.push(listener) },
    onDisconnect: { addListener: () => undefined },
    postMessage: (reply: PlanReply) => replies.push(reply),
  };
  return {
    handle: handle as unknown as chrome.runtime.Port,
    replies,
    async post(raw: unknown) {
      for (const listener of listeners) listener(raw);
      await vi.waitFor(() => expect(replies.length).toBeGreaterThan(0));
      return replies.shift();
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('chrome', fakeChrome({ delay: 1 }).chrome);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plan requests, as the worker checks them', () => {
  it('take what the client sends', () => {
    expect(planMessage.safeParse(message(request())).success).toBe(true);
  });

  it.each([
    ['a plan nobody asked for', { kind: 'plan' }],
    ['words over 500 characters', { text: 'x'.repeat(501) }],
    ['a field the request has no place for', { page: 'CANARY-1 order' }],
    ['text where an ID belongs', { contexts: { service: 'Your card was declined.' } }],
    ['text as a route', { route: 'CANARY order 1000' }],
  ])('refuse %s', (_, change) => {
    expect(planMessage.safeParse(message({ ...request(), ...change })).success).toBe(false);
  });

  it('refuse a request larger than the server would take', () => {
    const big = request();
    const rows = Array.from({ length: 2_000 }, () => big.summary.rows[0]!);
    expect(
      planMessage.safeParse(message({ ...big, summary: { ...big.summary, rows } })).success,
    ).toBe(false);
  });
});

describe('the planner port', () => {
  it('checks a request, then looks for a key', async () => {
    const { servePlanner } = await import('./planner.ts');
    const opened = port();
    servePlanner(opened.handle);
    expect(await opened.post(message(request()))).toMatchObject({ kind: 'error', code: 'no-key' });
  });

  it('refuses requests from elsewhere, for another contract, or a second on one port', async () => {
    const { servePlanner } = await import('./planner.ts');
    const stranger = port('https://example.com');
    servePlanner(stranger.handle);
    expect(await stranger.post(message(request()))).toMatchObject({ code: 'failed' });
    const forged = port();
    servePlanner(forged.handle);
    const other = { ...request(), contract: { id: 'acme-payments', hash: 'other' } };
    expect(await forged.post(message(other))).toMatchObject({ code: 'failed' });
    const twice = port();
    servePlanner(twice.handle);
    expect(await twice.post(message(request()))).toMatchObject({ code: 'no-key' });
    expect(await twice.post(message(request()))).toMatchObject({ code: 'failed' });
  });

  it("stops at this month's token budget", async () => {
    const { servePlanner } = await import('./planner.ts');
    const { TOKEN_BUDGET } = await import('./limits.ts');
    await chrome.storage.local.set({
      [`meter:tokens:${new Date().toISOString().slice(0, 7)}`]: TOKEN_BUDGET,
    });
    const opened = port();
    servePlanner(opened.handle);
    expect(await opened.post(message(request()))).toMatchObject({
      kind: 'error',
      code: 'over-budget',
      problem: expect.stringMatching(/tokens are used/),
    });
  });

  it('takes so many requests a minute', async () => {
    const { servePlanner } = await import('./planner.ts');
    const { PLANS_PER_MINUTE } = await import('./limits.ts');
    const codes: (string | undefined)[] = [];
    for (let index = 0; index <= PLANS_PER_MINUTE; index++) {
      const opened = port();
      servePlanner(opened.handle);
      const reply = await opened.post(message(request()));
      codes.push(reply?.kind === 'error' ? reply.code : reply?.kind);
    }
    expect(codes.slice(0, PLANS_PER_MINUTE).every((code) => code === 'no-key')).toBe(true);
    expect(codes.at(-1)).toBe('over-budget');
  });
});
