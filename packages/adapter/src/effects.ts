import type { AnyPage } from '@plurid/uitive-core';
import type { Adapter } from './format.js';

/** What to do to a page Uitive doesn't own. Pure data: the DOM side only applies it. */
export type Effect =
  | { kind: 'hide'; anchor: string }
  | { kind: 'order'; container: string; items: string[] }
  /** Hidden items, offered in a More list that forwards to the originals. */
  | { kind: 'more'; container: string; items: { action: string; anchor: string }[] }
  | {
      kind: 'overlay';
      surface: string;
      /** The anchor of the region the redesign is about. */
      region: string;
      /** Replace hides the original; augment keeps it and adds the redesign beside it. */
      mode: 'replace' | 'augment';
      page: AnyPage;
    };

/** The interface as the client holds it now, by surface. */
export interface Values {
  /** Each list's visible and overflow actions. */
  lists: Readonly<Record<string, { visible: readonly string[]; overflow: readonly string[] }>>;
  /** Each page's value, and its standard. */
  pages: Readonly<Record<string, { value: AnyPage; standard: AnyPage }>>;
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * The effects that make a page show the person's interface. Lists hide what moved to overflow
 * and order what stays; a redesigned page on the current route overlays its region. Required
 * anchors are never hidden, and a region holding one is never replaced, only augmented.
 */
export function compileEffects(
  adapter: Pick<Adapter, 'anchors' | 'lists' | 'regions' | 'pages'>,
  values: Values,
  route: string | null,
): Effect[] {
  const effects: Effect[] = [];
  const required = (name: string) => adapter.anchors[name]?.required === true;
  for (const [surface, list] of Object.entries(adapter.lists)) {
    const value = values.lists[surface];
    if (!value) continue;
    const standard = Object.keys(list.items);
    const hidden: { action: string; anchor: string }[] = [];
    for (const item of value.overflow) {
      const anchor = list.items[item];
      if (anchor === undefined || required(anchor)) continue;
      effects.push({ kind: 'hide', anchor });
      hidden.push({ action: item, anchor });
    }
    if (hidden.length > 0) effects.push({ kind: 'more', container: list.container, items: hidden });
    const order = value.visible.flatMap((item) => list.items[item] ?? []);
    // Hiding an item doesn't reorder the rest: only a change of their relative order does.
    const kept = standard.filter((item) => value.visible.includes(item));
    if (!same(value.visible, kept)) {
      effects.push({ kind: 'order', container: list.container, items: order });
    }
  }
  for (const [surface, page] of Object.entries(adapter.pages)) {
    if (page.route !== route) continue;
    const value = values.pages[surface];
    const region = adapter.regions[page.region];
    if (!value || !region || same(value.value, value.standard)) continue;
    const keepsOriginal = value.value.elements.some(
      (element) =>
        element.block === 'region' &&
        (element.props as { name?: string } | null)?.name === page.region,
    );
    const holdsRequired = Object.entries(adapter.anchors).some(([name, entry]) => {
      if (!entry.required) return false;
      for (
        let current = entry.within;
        current !== undefined;
        current = adapter.anchors[current]?.within
      ) {
        if (current === region.anchor) return true;
      }
      return name === region.anchor;
    });
    effects.push({
      kind: 'overlay',
      surface,
      region: region.anchor,
      mode: keepsOriginal || holdsRequired ? 'augment' : 'replace',
      page: value.value,
    });
  }
  return effects;
}
