import type { Uitive, ListSpec, ListValue } from '@plurid/uitive-core';
import { orders } from './order.js';

/** What adapting markup needs from a client; a client from `createUitive` fits as it is. */
export type MarkupClientLike = Pick<
  Uitive,
  'contract' | 'surface' | 'standard' | 'subscribe' | 'record'
>;

/**
 * How `adaptMarkup` and `startUitive` work: where the markup is, whether clicks count as use,
 * and who hears of problems.
 */
export interface MarkupOptions {
  /** Where the markup lives. @default document */
  root?: Document | ShadowRoot;
  /** Whether clicks on items record usage. @default true */
  record?: boolean;
  /**
   * Told once about each list that can't adapt as the person asked, such as a reordered list whose
   * container isn't a flex or grid box.
   * @default console.warn
   */
  onProblem?: (problem: string) => void;
}

const quote = (value: string) => JSON.stringify(value);
const LIST = '[data-uitive-list]';
const ITEM = '[data-uitive-item]';

let forwarding = false;

/** Clicks an item the person's interface hides, as if they had, without recording it twice. */
export function forward(element: HTMLElement): void {
  forwarding = true;
  try {
    element.click();
  } finally {
    forwarding = false;
  }
}

/** The items the person moved out of a list: the markup shows them unless told otherwise. */
export function movedOut(client: Pick<Uitive, 'surface' | 'standard'>, list: string) {
  const standard = new Set((client.standard(list) as ListValue).overflow.map((view) => view.id));
  return (client.surface(list) as ListValue).overflow.filter((view) => !standard.has(view.id));
}

/**
 * Adapts an application's own markup to the person's interface, for applications without React.
 * Mark each list's container with `data-uitive-list="<list>"` and each item inside it with
 * `data-uitive-item="<action>"`. Items the person moves out are hidden by one stylesheet, so markup
 * rendered later, such as a menu's, adapts too; reordered lists set CSS `order` on their
 * container's children, which needs a flex or grid box. Nothing is moved, so the application's
 * framework keeps its nodes. Clicks on items record usage. Returns a function that undoes it all.
 */
export function adaptMarkup(client: MarkupClientLike, options: MarkupOptions = {}): () => void {
  const root = options.root ?? document;
  const owner = root.nodeType === 9 ? (root as Document) : (root as ShadowRoot).ownerDocument;
  const view = owner.defaultView;
  if (!view) return () => {};
  const lists = Object.entries(client.contract.surfaces).flatMap(([id, spec]) =>
    spec.kind === 'list' ? [{ id, spec: spec as ListSpec }] : [],
  );
  const reported = new Set<string>();
  const problem = (text: string) => {
    if (reported.has(text)) return;
    reported.add(text);
    (options.onProblem ?? ((message: string) => console.warn(`Uitive: ${message}`)))(text);
  };

  // Constructable stylesheets also work under a strict style-src policy; a style element elsewhere.
  let sheet: CSSStyleSheet | undefined;
  let style: HTMLStyleElement | undefined;
  try {
    sheet = new view.CSSStyleSheet();
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } catch {
    sheet = undefined;
    style = owner.createElement('style');
    style.setAttribute('data-uitive', '');
    (root.nodeType === 9 ? (owner.head ?? owner.documentElement) : root).append(style);
  }

  let hidden: string[] = [];
  let reordered = new Map<string, readonly string[]>();
  const used = new Set<number>();
  const marked = new Set<Element>();
  const write = () => {
    const css = [
      ...hidden.map((rule) => `${rule} { display: none !important; }`),
      ...[...used].map(
        (value) => `${LIST} > [data-uitive-order="${value}"] { order: ${value} !important; }`,
      ),
    ].join('\n');
    if (sheet) sheet.replaceSync(css);
    else if (style) style.textContent = css;
  };

  const mark = (container: Element, order: readonly string[], list: string) => {
    if (!/flex|grid/.test(view.getComputedStyle(container).display)) {
      problem(`the list "${list}" can't be reordered: its container isn't a flex or grid box`);
      return;
    }
    const children = [...container.children];
    const values = orders(
      children.map((child) => {
        const item = child.matches(ITEM) ? child : child.querySelector(ITEM);
        return item ? order.indexOf(item.getAttribute('data-uitive-item') ?? '') : -1;
      }),
    );
    children.forEach((child, index) => {
      const value = values[index] ?? 0;
      child.setAttribute('data-uitive-order', String(value));
      marked.add(child);
      used.add(value);
    });
  };

  const containers = (list: string) =>
    root.querySelectorAll(`[data-uitive-list=${quote(list)}]`) as NodeListOf<Element>;

  // Only while a list is reordered: new children, or new containers, need their order.
  const observer = new view.MutationObserver((records) => {
    const touched = new Set<Element>();
    for (const record of records) {
      const target = record.target as Element;
      if (target.nodeType === 1 && target.matches(LIST)) touched.add(target);
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;
        if (element.matches(LIST)) touched.add(element);
        if (element.childElementCount > 0) {
          for (const found of element.querySelectorAll(LIST)) touched.add(found);
        }
      }
    }
    const before = used.size;
    for (const container of touched) {
      const list = container.getAttribute('data-uitive-list') ?? '';
      const order = reordered.get(list);
      if (order) mark(container, order, list);
    }
    if (used.size !== before) write();
  });

  const render = () => {
    hidden = lists.flatMap(({ id }) =>
      movedOut(client, id).map(
        (item) => `[data-uitive-list=${quote(id)}] [data-uitive-item=${quote(item.id)}]`,
      ),
    );
    reordered = new Map(
      lists.flatMap(({ id, spec }) => {
        const visible = (client.surface(id) as ListValue).visible.map((item) => item.id);
        const shown = new Set(visible);
        const standard = spec.items.filter((item) => shown.has(item));
        return visible.some((item, index) => item !== standard[index]) ? [[id, visible]] : [];
      }),
    );
    for (const element of marked) element.removeAttribute('data-uitive-order');
    marked.clear();
    for (const [list, order] of reordered) {
      for (const container of containers(list)) mark(container, order, list);
    }
    observer.disconnect();
    if (reordered.size > 0) observer.observe(root, { childList: true, subtree: true });
    write();
  };

  const click = (event: Event) => {
    if (forwarding) return;
    const item = (event.target as Element | null)?.closest?.(ITEM);
    const action = item?.getAttribute('data-uitive-item');
    if (!item || !action || !(action in client.contract.actions)) return;
    const list = item.closest(LIST)?.getAttribute('data-uitive-list') ?? undefined;
    client.record(action, {
      via: 'region',
      ...(list && list in client.contract.surfaces ? { surface: list } : {}),
    });
  };

  render();
  const unsubscribe = client.subscribe(render);
  if (options.record ?? true) root.addEventListener('click', click, true);
  return () => {
    unsubscribe();
    observer.disconnect();
    root.removeEventListener('click', click, true);
    for (const element of marked) element.removeAttribute('data-uitive-order');
    marked.clear();
    if (sheet) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((entry) => entry !== sheet);
    style?.remove();
  };
}
