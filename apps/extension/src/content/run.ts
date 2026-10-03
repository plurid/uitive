import { compileEffects, routeOf } from '@plurid/uitive-adapter';
import type { Adapter, Effect, Strategy, Values } from '@plurid/uitive-adapter';
import { buildPath, createUitive, heuristicPlanner } from '@plurid/uitive-core';
import type {
  AnyContract,
  AnyPage,
  Uitive,
  Environment,
  ListValue,
  PlanRequest,
  Store,
} from '@plurid/uitive-core';
import { toContent } from '../messages.ts';
import type { PageReport } from '../messages.ts';
import { resolveAnchors, unmapped } from './anchors.ts';
import type { Resolution } from './anchors.ts';
import { fallback, workerFetch, workerPlanner } from './bridge.ts';
import { createEngine } from './engine.ts';
import { lookOf, mountMore } from './more.tsx';
import type { More } from './more.tsx';
import { mountOverlay, themeOf } from './overlay.tsx';
import type { Overlay } from './overlay.tsx';
import { pick as pickElement, propose } from './repair.ts';

export interface RunOptions {
  window: Window;
  adapter: Adapter;
  contract: AnyContract;
  store: Store;
  /** Anchors the person repaired on this device, tried before the adapter's own strategies. */
  overrides?: Record<string, Strategy>;
}

/** The interface the client holds now, in the shape effects are compiled from. */
function valuesOf(client: Uitive<AnyContract>, adapter: Adapter): Values {
  const lists: Record<string, { visible: string[]; overflow: string[] }> = {};
  for (const surface of Object.keys(adapter.lists)) {
    const value = client.surface(surface) as ListValue;
    lists[surface] = {
      visible: value.visible.map((item) => item.id),
      overflow: value.overflow.map((item) => item.id),
    };
  }
  const pages: Record<string, { value: AnyPage; standard: AnyPage }> = {};
  for (const surface of Object.keys(adapter.pages)) {
    pages[surface] = {
      value: client.surface(surface) as AnyPage,
      standard: client.standard(surface) as AnyPage,
    };
  }
  return { lists, pages };
}

/**
 * Runs Uitive on a page it doesn't own: finds the adapter's anchors, keeps the client's
 * location in step with the page, and applies the person's interface as effects, again whenever
 * the page re-renders. Page text never leaves the page: requests carry structure only.
 */
export function run({ window, adapter, contract, store, overrides: initial = {} }: RunOptions) {
  const document = window.document;
  let overrides = initial;
  const repairsKey = `overrides:${adapter.id}`;
  const anchorsNow = () => ({
    anchors: Object.fromEntries(
      Object.entries(adapter.anchors).map(([name, anchor]) => {
        const repaired = overrides[name];
        return [name, repaired ? { ...anchor, match: [repaired, ...anchor.match] } : anchor];
      }),
    ),
  });
  const connector = Object.values(adapter.connectors)[0];
  const mode = () =>
    connector?.testMode && new RegExp(connector.testMode).test(window.location.pathname)
      ? 'test'
      : 'live';
  let anchors = new Map<string, Resolution>();
  let route: string | null = null;
  let lastRequest: PlanRequest | null = null;

  const environment = (): Environment => ({
    route,
    anchors: Object.fromEntries([...anchors].map(([name, entry]) => [name, entry.state])),
    sources: Object.fromEntries(
      contract.sourceIds.map((id) => [
        id,
        Object.values(adapter.connectors).some((entry) => entry.sources[id])
          ? 'live'
          : 'unavailable',
      ]),
    ),
    unmapped: unmapped(document, anchors),
  });

  const client = createUitive({
    contract,
    store,
    planner: fallback(
      workerPlanner(adapter.id, (request) => {
        lastRequest = request;
      }),
      heuristicPlanner(),
    ),
    bindings: {
      fetch: workerFetch(adapter.id, mode),
      // Links go through the page's own links where it has one, so its router handles them.
      navigate: (href) => {
        const link = [...document.querySelectorAll('a[href]')].find((element) =>
          new URL(element.getAttribute('href') ?? '', document.baseURI).pathname.endsWith(href),
        );
        if (link instanceof HTMLElement) link.click();
        else window.location.assign(href);
      },
    },
    environment,
    onError: (error) => console.warn('[uitive]', error),
  });

  const engine = createEngine(document);
  const overlays = new Map<string, Overlay>();
  const mores = new Map<string, More>();
  let forwarding = false;
  const label = (action: string) => contract.actions[action]?.label ?? action;
  const pick = (surface: string, action: string) => {
    const element = anchors.get(adapter.lists[surface]?.items[action] ?? '')?.element;
    client.record(action, { via: 'overflow', surface });
    if (!(element instanceof HTMLElement)) return;
    // The page's own handlers take the click, hidden or not; it isn't counted twice.
    forwarding = true;
    try {
      element.click();
    } finally {
      forwarding = false;
    }
  };
  let failed: { effect: Effect['kind']; target: string; reason: string }[] = [];
  let syncing = false;
  let path = '';

  const sync = () => {
    if (syncing) return;
    syncing = true;
    try {
      anchors = resolveAnchors(anchorsNow(), document);
      const matched = routeOf(adapter, window.location.pathname);
      route = matched?.route ?? null;
      const next =
        (matched ? buildPath(contract, matched.route, matched.params) : undefined) ??
        window.location.pathname;
      if (next !== path) {
        path = next;
        client.setLocation(next);
      }
      const effects = compileEffects(adapter, valuesOf(client, adapter), route);
      failed = engine.apply(effects, anchors).failed;
      const wanted = new Set<string>();
      for (const effect of effects) {
        if (effect.kind !== 'overlay') continue;
        const region = anchors.get(effect.region)?.element;
        if (!region) continue;
        wanted.add(effect.surface);
        const regionName = adapter.pages[effect.surface]?.region ?? '';
        const existing = overlays.get(effect.surface);
        if (existing) {
          existing.place(region);
          existing.update(effect.page);
        } else {
          overlays.set(
            effect.surface,
            mountOverlay({
              region,
              regionName,
              client,
              page: effect.page,
              theme: themeOf(document, region),
              onShowOriginal: () => engine.original(true),
            }),
          );
        }
      }
      for (const [surface, overlay] of overlays) {
        if (wanted.has(surface)) continue;
        overlay.remove();
        overlays.delete(surface);
      }
      const listed = new Set<string>();
      for (const effect of effects) {
        if (effect.kind !== 'more') continue;
        const container = anchors.get(effect.container)?.element;
        const surface = Object.keys(adapter.lists).find(
          (name) => adapter.lists[name]?.container === effect.container,
        );
        if (!container || !surface) continue;
        listed.add(surface);
        const items = effect.items.map((item) => ({
          action: item.action,
          label: label(item.action),
        }));
        const existing = mores.get(surface);
        if (existing) {
          existing.place(container);
          existing.update(items);
        } else {
          const visible = Object.values(adapter.lists[surface]?.items ?? {})
            .map((name) => anchors.get(name)?.element)
            .find((element) => element && !element.hasAttribute('data-uitive'));
          mores.set(
            surface,
            mountMore({
              container,
              items,
              look: lookOf(visible),
              onPick: (action) => pick(surface, action),
            }),
          );
        }
      }
      for (const [surface, more] of mores) {
        if (listed.has(surface)) continue;
        more.remove();
        mores.delete(surface);
      }
      for (const more of mores.values())
        more.host.style.display = engine.showingOriginal ? 'none' : '';
      for (const overlay of overlays.values()) {
        overlay.host.style.display = engine.showingOriginal ? 'none' : '';
      }
    } finally {
      syncing = false;
    }
  };

  // What people use teaches the interface: action IDs only, never what the page shows.
  document.addEventListener(
    'click',
    (event) => {
      if (forwarding || !(event.target instanceof Element)) return;
      for (const [surface, list] of Object.entries(adapter.lists)) {
        for (const [action, name] of Object.entries(list.items)) {
          const element = anchors.get(name)?.element;
          if (element && element.contains(event.target)) {
            client.record(action, { via: 'region', surface });
            return;
          }
        }
      }
    },
    true,
  );

  // A page that changes faster than the engine can follow gets the engine out of its way: after
  // three seconds over budget in a minute, it shows the original page and says so.
  const BUDGET = 8;
  const timings: number[] = [];
  let over: { at: number; ms: number }[] = [];
  let paused: string | null = null;
  const observer = new MutationObserver(() => follow());
  const watch = () =>
    observer.observe(document.documentElement, { childList: true, subtree: true });
  const follow = () => {
    if (paused) return;
    const started = performance.now();
    sync();
    const took = performance.now() - started;
    timings.push(took);
    if (timings.length > 200) timings.shift();
    if (took <= BUDGET) return;
    const now = Date.now();
    over = [...over.filter((entry) => now - entry.at < 60_000), { at: now, ms: took }];
    if (over.reduce((total, entry) => total + entry.ms, 0) > 3_000) {
      paused = 'This page changes faster than Uitive can follow, so it shows the page as it is.';
      observer.disconnect();
      engine.original(true);
      sync();
    }
  };
  const resume = () => {
    paused = null;
    over = [];
    engine.original(false);
    watch();
    sync();
  };
  const p95 = () => {
    const sorted = [...timings].sort((a, b) => a - b);
    return Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10;
  };

  // Mutation callbacks run before the next paint, so re-rendered elements are marked unseen.
  watch();
  client.subscribe(follow);
  window.addEventListener('popstate', sync);
  // A new session may bring changes learned from use, planned once a session however many pages
  // it spans.
  client.resume();
  void client.learn();
  window.addEventListener('keydown', (event) => {
    if (event.altKey && event.shiftKey && event.code === 'KeyA') {
      engine.original(!engine.showingOriginal);
      sync();
    }
  });
  sync();

  const report = (): PageReport => ({
    adapter: { id: adapter.id, label: adapter.label },
    route,
    mode: mode(),
    anchors: Object.fromEntries([...anchors].map(([name, entry]) => [name, entry.state])),
    changes: client.getSnapshot().definition.operations.map((operation) => {
      const explained = client.explain(operation.id);
      return {
        operation: operation.id,
        title: explained?.title ?? operation.id,
        reason: explained?.reason ?? '',
        origin: operation.origin,
      };
    }),
    lastRequest,
    original: engine.showingOriginal,
    paused,
    timing: { syncs: timings.length, p95: p95() },
    repairs: Object.keys(overrides),
  });

  chrome.runtime.onMessage.addListener((raw, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;
    const parsed = toContent.safeParse(raw);
    if (!parsed.success) return false;
    const message = parsed.data;
    if (message.kind === 'snapshot') {
      reply({ ok: true, value: { ...report(), failed } });
    } else if (message.kind === 'ask') {
      client.ask(message.text).then(
        (adaptation) =>
          reply({
            ok: true,
            value: {
              status: adaptation.status ?? 'done',
              applied: adaptation.applied.length,
              candidates: adaptation.candidates ?? [],
              meta: adaptation.meta ?? null,
              report: report(),
            },
          }),
        (error: unknown) => reply({ ok: false, problem: (error as Error).message }),
      );
      return true;
    } else if (message.kind === 'revert') {
      client.revert(message.operation);
      reply({ ok: true, value: report() });
    } else if (message.kind === 'reset') {
      client.reset();
      reply({ ok: true, value: report() });
    } else if (message.kind === 'pick') {
      const anchor = adapter.anchors[message.anchor];
      if (!anchor) {
        reply({ ok: false, problem: `No part named ${message.anchor}` });
        return false;
      }
      const action = Object.values(adapter.lists)
        .flatMap((list) => Object.entries(list.items))
        .find(([, name]) => name === message.anchor)?.[0];
      const label = action ? `"${contract.actions[action]?.label ?? action}"` : message.anchor;
      void pickElement(document, label).then(async (element) => {
        if (!element) {
          reply({ ok: false, problem: 'Cancelled' });
          return;
        }
        const scope = anchor.within ? (anchors.get(anchor.within)?.element ?? document) : document;
        const strategy = propose(element, scope, connector?.testMode);
        if (!strategy) {
          reply({
            ok: false,
            problem: "That element can't be told apart from others; try its link or label",
          });
          return;
        }
        overrides = { ...overrides, [message.anchor]: strategy };
        await chrome.storage.local.set({ [repairsKey]: overrides });
        sync();
        reply({ ok: true, value: { strategy, report: report() } });
      });
      return true;
    } else if (message.kind === 'repairs.clear') {
      overrides = {};
      void chrome.storage.local.remove(repairsKey);
      sync();
      reply({ ok: true, value: report() });
    } else if (message.kind === 'resume') {
      resume();
      reply({ ok: true, value: report() });
    } else if (message.kind === 'page') {
      const adaptation = client.setPage(message.surface, message.value as AnyPage);
      reply({
        ok: true,
        value: {
          applied: adaptation.applied.length,
          rejected: adaptation.rejected.map((entry) => entry.message),
          report: report(),
        },
      });
    } else {
      engine.original(message.on);
      sync();
      reply({ ok: true, value: report() });
    }
    return false;
  });

  return { client, sync, report };
}
