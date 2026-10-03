import { computeAccessibleName, getRole } from 'dom-accessibility-api';
import type { Strategy } from '@plurid/aptuitive-adapter';
import { candidates } from './anchors.ts';

const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The most durable way to find exactly this element within its scope: its link's path (which
 * survives translation), a test id, its role and name, then its text. Each candidate must find
 * this element and nothing else.
 */
export function propose(
  element: Element,
  scope: ParentNode,
  testMode?: string,
): Strategy | undefined {
  const base = element.ownerDocument.baseURI;
  const link = element.closest('a[href]');
  const target = link ?? element;
  const options: Strategy[] = [];
  if (link) {
    let path = new URL(link.getAttribute('href') ?? '', base).pathname;
    // A test-mode prefix, such as /test/, stays optional so the anchor works in both modes.
    const prefix = testMode ? /^\^(\/[^()[\]*+?]+)\/$/.exec(testMode)?.[1] : undefined;
    if (prefix && path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
    options.push({
      href: `^${prefix ? `(${literal(prefix)})?` : ''}${literal(path.replace(/\/$/, ''))}/?$`,
    });
  }
  const testId = target.closest('[data-testid]')?.getAttribute('data-testid');
  if (testId) options.push({ testId });
  const role = getRole(target);
  const name = computeAccessibleName(target).trim();
  if (role && name) options.push({ role, name: [name] });
  const text = (target.textContent ?? '').trim();
  if (text !== '' && text.length <= 80) options.push({ text: [text] });
  return options.find((strategy) => {
    const found = candidates(scope, strategy, base);
    return found.length === 1 && found[0] === target;
  });
}

/**
 * Asks the person to click the element an anchor should name: a highlight follows the pointer,
 * the click is taken before the page sees it, and Escape cancels.
 */
export function pick(document: Document, label: string): Promise<Element | undefined> {
  const view = document.defaultView;
  return new Promise((resolve) => {
    if (!view) {
      resolve(undefined);
      return;
    }
    const host = document.createElement('div');
    host.setAttribute('data-aptuitive-pick', '');
    host.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .box { position: fixed; border: 2px solid #3b4cca; background: rgba(59, 76, 202, 0.12); border-radius: 4px; }
      .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: #1c1e21; color: #fff; font: 13px/1.4 system-ui, sans-serif; padding: 8px 12px; border-radius: 8px; }
    `;
    const box = document.createElement('div');
    box.className = 'box';
    box.hidden = true;
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = `Click ${label} on the page. Esc cancels.`;
    shadow.append(style, box, hint);
    document.documentElement.append(host);

    const move = (event: MouseEvent) => {
      if (!(event.target instanceof view.Element)) return;
      const rect = event.target.getBoundingClientRect();
      box.hidden = false;
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    };
    const finish = (element: Element | undefined) => {
      view.removeEventListener('mousemove', move, true);
      view.removeEventListener('click', click, true);
      view.removeEventListener('keydown', key, true);
      host.remove();
      resolve(element);
    };
    const click = (event: MouseEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(event.target instanceof view.Element ? event.target : undefined);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finish(undefined);
    };
    view.addEventListener('mousemove', move, true);
    view.addEventListener('click', click, true);
    view.addEventListener('keydown', key, true);
  });
}
