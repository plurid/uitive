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
      '<nav><a href="/connect">Connect</a><a href="/billing">Billing</a></nav>';
    const [connect, billing] = [...document.querySelectorAll('a')];
    const anchors = new Map<string, Resolution>([
      ['nav.connect', { state: 'found', element: connect }],
      ['nav.billing', { state: 'found', element: billing }],
    ]);
    const replace = vi.spyOn(CSSStyleSheet.prototype, 'replaceSync');
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
    const engine = createEngine(document);
    const hide = [{ kind: 'hide', anchor: 'nav.connect' }] as const;
    engine.apply(hide, anchors);
    engine.apply(hide, anchors);
    engine.apply(hide, anchors);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(setAttribute).toHaveBeenCalledTimes(1);
    engine.apply([...hide, { kind: 'hide', anchor: 'nav.billing' }], anchors);
    expect(replace).toHaveBeenCalledTimes(2);
    engine.original(true);
    engine.original(true);
    expect(replace).toHaveBeenCalledTimes(3);
  });
});
