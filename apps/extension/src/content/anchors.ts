import { computeAccessibleName, getRole } from 'dom-accessibility-api';
import type { Adapter, Strategy } from '@plurid/aptuitive-adapter';

export type AnchorState = 'found' | 'missing' | 'ambiguous';

export interface Resolution {
  state: AnchorState;
  element?: Element;
  /** Which strategy found it, for repairs and drift reports. */
  strategy?: number;
}

const ROLES: Readonly<Record<string, string>> = {
  navigation: 'nav, [role="navigation"]',
  main: 'main, [role="main"]',
  link: 'a[href], [role="link"]',
  button: 'button, [role="button"], input[type="button"], input[type="submit"]',
  alert: '[role="alert"]',
  heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
  table: 'table, [role="table"], [role="grid"]',
  banner: 'header, [role="banner"]',
  complementary: 'aside, [role="complementary"]',
  tab: '[role="tab"]',
  menuitem: '[role="menuitem"]',
};

const normal = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Innermost matches only, so a list item and the link inside it don't count twice. */
const innermost = (elements: Element[]) =>
  elements.filter(
    (element) => !elements.some((other) => other !== element && element.contains(other)),
  );

/** Every element a strategy finds within a scope. */
export function candidates(scope: ParentNode, strategy: Strategy, base: string): Element[] {
  if ('href' in strategy) {
    const pattern = new RegExp(strategy.href);
    return [...scope.querySelectorAll('a[href]')].filter((link) => {
      try {
        return pattern.test(new URL(link.getAttribute('href') ?? '', base).pathname);
      } catch {
        return false;
      }
    });
  }
  if ('testId' in strategy) {
    const id = JSON.stringify(strategy.testId);
    return [
      ...scope.querySelectorAll(`[data-testid=${id}], [data-test-id=${id}], [data-test=${id}]`),
    ];
  }
  if ('role' in strategy) {
    const names = strategy.name?.map(normal);
    const selector = ROLES[strategy.role] ?? `[role=${JSON.stringify(strategy.role)}]`;
    return [...scope.querySelectorAll(selector)].filter(
      (element) =>
        getRole(element) === strategy.role &&
        (names === undefined || names.includes(normal(computeAccessibleName(element)))),
    );
  }
  if ('text' in strategy) {
    const texts = strategy.text.map(normal);
    return innermost(
      [
        ...scope.querySelectorAll('a, button, [role], h1, h2, h3, h4, h5, h6, label, li, span'),
      ].filter((element) => texts.includes(normal(element.textContent ?? ''))),
    );
  }
  return [...scope.querySelectorAll(strategy.css)];
}

/**
 * Finds each anchor in the page: within its parent anchor, the first strategy with exactly one
 * match wins. Several matches make it ambiguous; never a guess.
 */
export function resolveAnchors(
  adapter: Pick<Adapter, 'anchors'>,
  document: Document,
): Map<string, Resolution> {
  const results = new Map<string, Resolution>();
  const base = document.baseURI;
  const resolve = (name: string, depth: number): Resolution => {
    const known = results.get(name);
    if (known) return known;
    const anchor = adapter.anchors[name];
    let result: Resolution = { state: 'missing' };
    if (anchor && depth < 8) {
      const parent = anchor.within === undefined ? undefined : resolve(anchor.within, depth + 1);
      if (parent === undefined || parent.element) {
        const scope: ParentNode = parent?.element ?? document;
        let ambiguous = false;
        for (const [index, strategy] of anchor.match.entries()) {
          const found = candidates(scope, strategy, base);
          if (found.length === 1 && found[0]) {
            result = { state: 'found', element: found[0], strategy: index };
            break;
          }
          if (found.length > 1) ambiguous = true;
        }
        if (result.state !== 'found' && ambiguous) result = { state: 'ambiguous' };
      }
    }
    results.set(name, result);
    return result;
  };
  for (const name of Object.keys(adapter.anchors)) resolve(name, 0);
  return results;
}

/** What the adapter doesn't know about, counted and never named. */
export function unmapped(document: Document, anchors: Map<string, Resolution>) {
  const known = new Set(
    [...anchors.values()].flatMap((entry) => (entry.element ? [entry.element] : [])),
  );
  const count = (selector: string) =>
    [...document.querySelectorAll(selector)].filter((element) => !known.has(element)).length;
  return {
    links: count('a[href]'),
    buttons: count('button, [role="button"]'),
    tables: count('table, [role="grid"]'),
  };
}
