import type { Effect } from '@plurid/uitive-adapter';
import { orders } from '@plurid/uitive-dom';
import type { Resolution } from './anchors.ts';

/** What the engine applies: effects, or a replaced region without its redesign, as at start. */
export type Marking = Effect | Omit<Extract<Effect, { kind: 'overlay' }>, 'page'>;

export interface Applied {
  /** Effects that couldn't apply, and why; hides apply one by one, so the rest still do. */
  failed: { effect: Effect['kind']; target: string; reason: string }[];
}

export interface Engine {
  apply(effects: readonly Marking[], anchors: ReadonlyMap<string, Resolution>): Applied;
  /** Shows the page as it is, until turned off. */
  original(on: boolean): void;
  readonly showingOriginal: boolean;
}

const quote = (value: string) => JSON.stringify(value);

/**
 * Applies effects without moving anything the page's framework owns: resolved elements get a
 * `data-uitive` attribute, and one constructable stylesheet hides and orders them.
 */
export function createEngine(document: Document): Engine {
  const view = document.defaultView;
  if (!view) throw new Error('No window');
  const sheet = new view.CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  let marked = new Map<Element, Set<string>>();
  let css = '';
  let original = false;
  let written = '';
  // Replacing a sheet restyles the whole page, so it happens only when the rules change.
  const write = () => {
    const next = original ? '' : css;
    if (next === written) return;
    sheet.replaceSync(next);
    written = next;
  };
  return {
    get showingOriginal() {
      return original;
    },
    original(on) {
      original = on;
      write();
    },
    apply(effects, anchors) {
      const next = new Map<Element, Set<string>>();
      const rules: string[] = [];
      const failed: Applied['failed'] = [];
      const mark = (element: Element, name: string, value: string) => {
        if (element.getAttribute(name) !== value) element.setAttribute(name, value);
        next.set(element, (next.get(element) ?? new Set()).add(name));
      };
      for (const effect of effects) {
        if (effect.kind === 'hide') {
          const element = anchors.get(effect.anchor)?.element;
          if (!element) {
            failed.push({ effect: 'hide', target: effect.anchor, reason: 'not found' });
            continue;
          }
          mark(element, 'data-uitive', effect.anchor);
          rules.push(`[data-uitive=${quote(effect.anchor)}] { display: none !important; }`);
        } else if (effect.kind === 'order') {
          const container = anchors.get(effect.container)?.element;
          if (!container) {
            failed.push({ effect: 'order', target: effect.container, reason: 'not found' });
            continue;
          }
          if (!/flex|grid/.test(view.getComputedStyle(container).display)) {
            failed.push({
              effect: 'order',
              target: effect.container,
              reason: "isn't a flex or grid box",
            });
            continue;
          }
          const items = effect.items.flatMap((name) => anchors.get(name)?.element ?? []);
          // Children that contain an item follow it; the More list and others keep their place.
          const children = [...container.children];
          const values = orders(
            children.map((child) =>
              items.findIndex((item) => child === item || child.contains(item)),
            ),
          );
          children.forEach((child, index) =>
            mark(child, 'data-uitive-order', String(values[index])),
          );
          for (const value of new Set(values)) {
            rules.push(
              `[data-uitive-order=${quote(String(value))}] { order: ${value} !important; }`,
            );
          }
        } else if (effect.kind === 'overlay' && effect.mode === 'replace') {
          const element = anchors.get(effect.region)?.element;
          if (!element) continue;
          mark(element, 'data-uitive-replaced', effect.surface);
          rules.push(`[data-uitive-replaced] { display: none !important; }`);
        }
      }
      // Marks no effect asks for any more come off, one attribute at a time.
      for (const [element, names] of marked) {
        for (const name of names) if (!next.get(element)?.has(name)) element.removeAttribute(name);
      }
      marked = next;
      css = [...new Set(rules)].join('\n');
      write();
      return { failed };
    },
  };
}
