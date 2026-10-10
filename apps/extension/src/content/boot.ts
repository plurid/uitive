import type { Adapter, Strategy } from '@plurid/uitive-adapter';
import { z } from 'zod';
import { resolveAnchors, withRepairs } from './anchors.ts';
import { createEngine } from './engine.ts';
import type { Engine, Marking } from './engine.ts';

/** What the page showed last: the hides, orders and replaced regions, and the repairs they used. */
export interface Last {
  effects: Marking[];
  overrides: Record<string, Strategy>;
}

const last = z.object({
  effects: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('hide'), anchor: z.string() }),
        z.object({ kind: z.literal('order'), container: z.string(), items: z.array(z.string()) }),
        z.object({
          kind: z.literal('overlay'),
          surface: z.string(),
          region: z.string(),
          mode: z.literal('replace'),
        }),
      ]),
    )
    .max(500),
  overrides: z.record(z.string(), z.unknown()),
});

const keyOf = (adapter: Pick<Adapter, 'id'>) => `uitive:${adapter.id}`;

const storage = (window: Window): Storage | undefined => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

/** The effects worth applying before the extension's storage answers. */
export const lastOf = (effects: readonly Marking[], overrides: Record<string, Strategy>): Last => ({
  effects: effects.flatMap((effect): Marking[] => {
    if (effect.kind === 'hide' || effect.kind === 'order') return [effect];
    if (effect.kind === 'overlay' && effect.mode === 'replace') {
      return [{ kind: 'overlay', surface: effect.surface, region: effect.region, mode: 'replace' }];
    }
    return [];
  }),
  overrides,
});

/**
 * Keeps what the page shows in the tab's session storage, which a content script reads without
 * waiting, and which goes when the tab closes. The page can read it, as it can read the marks.
 */
export function remember(window: Window, adapter: Pick<Adapter, 'id'>, value: Last): void {
  try {
    if (value.effects.length === 0) storage(window)?.removeItem(keyOf(adapter));
    else storage(window)?.setItem(keyOf(adapter), JSON.stringify(value));
  } catch {
    // Storage is full or blocked: the page just waits for the extension's storage.
  }
}

/**
 * Applies what the page showed last, before the extension's storage answers, so a reload hides
 * what the person hid before the page first paints. The run takes the engine over and stops this.
 */
export function early(
  window: Window,
  adapter: Pick<Adapter, 'id' | 'anchors'>,
): { engine: Engine; stop(): void } {
  const document = window.document;
  const engine = createEngine(document);
  let found: Last | undefined;
  try {
    const text = storage(window)?.getItem(keyOf(adapter));
    const parsed = text ? last.safeParse(JSON.parse(text)) : undefined;
    if (parsed?.success) found = parsed.data as Last;
  } catch {
    found = undefined;
  }
  if (!found) return { engine, stop: () => undefined };
  const { effects, overrides } = found;
  const apply = () => {
    try {
      engine.apply(effects, resolveAnchors(withRepairs(adapter, overrides), document));
    } catch {
      // A stored strategy that no longer parses: the run applies the real thing soon.
    }
  };
  let frame: number | undefined;
  const observer = new MutationObserver(() => {
    frame ??= window.requestAnimationFrame(() => {
      frame = undefined;
      apply();
    });
  });
  observer.observe(document, { childList: true, subtree: true });
  apply();
  return {
    engine,
    stop: () => {
      observer.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    },
  };
}
