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
import { resolveAnchors, unmapped, withRepairs } from './anchors.ts';
import type { Resolution } from './anchors.ts';
import { lastOf, remember } from './boot.ts';
import { fallback, workerFetch, workerPlanner } from './bridge.ts';
import { createEngine } from './engine.ts';
import type { Engine } from './engine.ts';
import { lookOf, mountMore } from './more.tsx';
import type { More } from './more.tsx';
import { linkTo, modePrefix, targetOf } from './navigate.ts';
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
  /** The engine that applied the last effects at page start, before storage answered. */
  engine?: Engine;
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

const OURS = ['data-uitive-more', 'data-uitive-overlay', 'data-uitive-pick'];

/** Whether a change is only our own elements coming or going, which needs no new sync. */
const ours = (record: MutationRecord) => {
  const nodes = [...record.addedNodes, ...record.removedNodes];
  return (
    nodes.length > 0 &&
    nodes.every(
      (node) => node.nodeType === 1 && OURS.some((name) => (node as Element).hasAttribute(name)),
    )
  );
};

/** Whether a key press is typing, where a shortcut must not fire. */
const typing = (event: KeyboardEvent) => {
  const target = event.composedPath()[0];
  if (!target || (target as Node).nodeType !== 1) return false;
  const element = target as HTMLElement;
  return (
    element.isContentEditable ||
    /^(input|textarea|select)$/i.test(element.tagName) ||
    // Our overlays are closed: what has focus inside them can't be seen, so assume a field.
    element.hasAttribute('data-uitive-overlay')
  );
};

/**
 * Runs Uitive on a page it doesn't own: finds the adapter's anchors, keeps the client's
 * location in step with the page, and applies the person's interface as effects, again whenever
 * the page re-renders. Page text never leaves the page: requests carry structure only.
 */
export function run({
  window,
  adapter,
  contract,
  store,
  overrides: initial = {},
  engine = createEngine(window.document),
}: RunOptions) {
  const document = window.document;
  let overrides = initial;
  const repairsKey = `overrides:${adapter.id}`;
  const connector = Object.values(adapter.connectors)[0];
  const mode = () =>
    modePrefix(connector?.testMode, window.location.pathname) !== '' ? 'test' : 'live';
  let anchors = new Map<string, Resolution>();
  let route: string | null = null;
  let lastRequest: PlanRequest | null = null;
  // Which connectors have a key, by mode, as the worker last said: whether a source can be read.
  let keys: Record<string, { test: boolean; live: boolean }> = {};
  const refreshKeys = async () => {
    try {
      const reply = (await chrome.runtime.sendMessage({ kind: 'keys', adapter: adapter.id })) as
        { ok: true; value: typeof keys } | { ok: false } | undefined;
      if (reply?.ok) keys = reply.value;
    } catch {
      // The worker is restarting; the last answer stands.
    }
  };

  const environment = (): Environment => ({
    route,
    anchors: Object.fromEntries([...anchors].map(([name, entry]) => [name, entry.state])),
    sources: Object.fromEntries(
      contract.sourceIds.map((id) => {
        const reader = Object.entries(adapter.connectors).find(([, entry]) => entry.sources[id]);
        return [id, reader && keys[reader[0]]?.[mode()] ? 'live' : 'unavailable'];
      }),
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
        const target = targetOf(href, connector?.testMode, window.location);
        const link = linkTo(document, target.path);
        if (link instanceof HTMLElement) link.click();
        else window.location.assign(target.href);
      },
    },
    environment,
    onError: (error) => console.warn('[uitive]', error),
  });

  const overlays = new Map<string, Overlay>();
  const mores = new Map<string, More>();
  const label = (action: string) => contract.actions[action]?.label ?? action;
  const pick = (surface: string, action: string) => {
    const element = anchors.get(adapter.lists[surface]?.items[action] ?? '')?.element;
    client.record(action, { via: 'overflow', surface });
    // The page's own handlers take the click, hidden or not; untrusted, it isn't counted twice.
    if (element instanceof HTMLElement) element.click();
  };
  let failed: { effect: Effect['kind']; target: string; reason: string }[] = [];
  let syncing = false;
  let path = '';
  let frame: number | undefined;
  let remembered = '';

  const sync = () => {
    if (syncing) return;
    syncing = true;
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame);
      frame = undefined;
    }
    try {
      anchors = resolveAnchors(withRepairs(adapter, overrides), document);
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
      const last = lastOf(effects, overrides);
      const text = JSON.stringify(last);
      if (text !== remembered) {
        remembered = text;
        remember(window, adapter, last);
      }
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

  // What people use teaches the interface: action IDs only, never what the page shows. Only the
  // person's own clicks count: never a script's, nor the More list forwarding one.
  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
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
  // A burst of changes is followed once, in the frame before it paints.
  const later = () => {
    if (paused || frame !== undefined) return;
    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      follow();
    });
  };
  const observer = new MutationObserver((records) => {
    if (!records.every(ours)) later();
  });
  const watch = () =>
    observer.observe(document.documentElement, { childList: true, subtree: true });
  const follow = () => {
    // Inside a sync, as when it moves the client's location, the sync already covers it.
    if (paused || syncing) return;
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

  watch();
  client.subscribe(follow);
  window.addEventListener('popstate', sync);
  // Forgetting everything, from the side panel or another tab, reaches this page too: the
  // definition through the store, repairs here.
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[repairsKey];
    if (area !== 'local' || !change) return;
    overrides = (change.newValue ?? {}) as Record<string, Strategy>;
    sync();
  });
  // A new session may bring changes learned from use, planned once a session however many pages
  // it spans.
  client.resume();
  void client.learn();
  void refreshKeys();
  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted || typing(event)) return;
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
      // Keys may have changed in the side panel since the page loaded.
      refreshKeys()
        .then(() => client.ask(message.text))
        .then(
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
          reply({ ok: false, problem: 'Canceled' });
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
