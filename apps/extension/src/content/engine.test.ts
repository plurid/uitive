// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Resolution } from './anchors.ts';
import { createEngine } from './engine.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the engine', () => {
  it('rewrites its stylesheet only when the rules change', () => {
    document.body.innerHTML =
      '<nav><a href="/partners">Partners</a><a href="/invoices">Invoices</a></nav>';
    const [partners, invoices] = [...document.querySelectorAll('a')];
    const anchors = new Map<string, Resolution>([
      ['nav.partners', { state: 'found', element: partners }],
      ['nav.invoices', { state: 'found', element: invoices }],
    ]);
    const replace = vi.spyOn(CSSStyleSheet.prototype, 'replaceSync');
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
    const engine = createEngine(document);
    const hide = [{ kind: 'hide', anchor: 'nav.partners' }] as const;
    engine.apply(hide, anchors);
    engine.apply(hide, anchors);
    engine.apply(hide, anchors);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(setAttribute).toHaveBeenCalledTimes(1);
    engine.apply([...hide, { kind: 'hide', anchor: 'nav.invoices' }], anchors);
    expect(replace).toHaveBeenCalledTimes(2);
    engine.original(true);
    engine.original(true);
    expect(replace).toHaveBeenCalledTimes(3);
  });
});
