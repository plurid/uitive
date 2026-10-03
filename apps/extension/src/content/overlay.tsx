import { UitiveProvider, Page } from '@plurid/uitive-react';
import type { AnyContract, AnyPage, Uitive } from '@plurid/uitive-core';
import { createRoot } from 'react-dom/client';

export interface Overlay {
  readonly host: HTMLElement;
  update(page: AnyPage): void;
  /** Puts the overlay back beside its region, after the page re-rendered it. */
  place(region: Element): void;
  remove(): void;
}

const frame = `
.uitive-overlay { font: inherit; color: var(--uitive-text, inherit); display: grid; gap: 12px; margin-block-end: 16px; }
.uitive-overlay-bar { display: flex; gap: 8px; align-items: center; font-size: 0.85em; opacity: 0.75; }
.uitive-overlay-bar button { font: inherit; background: none; border: 0; color: var(--uitive-accent, inherit); cursor: pointer; padding: 0; text-decoration: underline; }
`;

/** How the region sits in the page's layout, so the overlay takes the same place. */
const LAYOUT = [
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-self',
  'grid-column',
  'grid-row',
  'order',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'max-width',
  'min-width',
  'box-sizing',
] as const;

function fit(host: HTMLElement, region: Element) {
  const view = region.ownerDocument.defaultView;
  if (!view) return;
  const style = view.getComputedStyle(region);
  for (const name of LAYOUT) host.style.setProperty(name, style.getPropertyValue(name));
  host.style.display = 'block';
  host.style.minWidth = '0';
}

/**
 * Draws a redesigned page beside the region it is about, in a closed shadow root: the page's
 * styles and scripts can't reach into it, and nothing it draws can reach out.
 */
export function mountOverlay(options: {
  region: Element;
  regionName: string;
  client: Uitive<AnyContract>;
  page: AnyPage;
  theme: Readonly<Record<string, string>>;
  onShowOriginal(): void;
}): Overlay {
  const document = options.region.ownerDocument;
  const host = document.createElement('div');
  host.setAttribute('data-uitive-overlay', '');
  fit(host, options.region);
  options.region.before(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = frame;
  const container = document.createElement('div');
  container.className = 'uitive-overlay';
  for (const [name, value] of Object.entries(options.theme))
    container.style.setProperty(name, value);
  shadow.append(style, container);
  const root = createRoot(container);
  const render = (page: AnyPage) =>
    root.render(
      <UitiveProvider client={options.client}>
        <div className="uitive-overlay-bar">
          <span>Your page</span>
          <button type="button" onClick={options.onShowOriginal}>
            Show the original
          </button>
        </div>
        <Page value={page} blocks={{}} regions={{ [options.regionName]: () => null }} />
      </UitiveProvider>,
    );
  render(options.page);
  return {
    host,
    update: render,
    place(region) {
      if (host.isConnected && host.nextElementSibling === region) return;
      fit(host, region);
      region.before(host);
    },
    remove() {
      root.unmount();
      host.remove();
    },
  };
}

/** The page's look, read from its computed styles, so overlays sit in naturally. */
export function themeOf(document: Document, region: Element | undefined): Record<string, string> {
  const view = document.defaultView;
  if (!view) return {};
  const body = view.getComputedStyle(document.body);
  const link = document.querySelector('main a[href], a[href]');
  const surface = region ? view.getComputedStyle(region).backgroundColor : body.backgroundColor;
  return {
    'font-family': body.fontFamily,
    'font-size': body.fontSize,
    '--uitive-text': body.color,
    ...(link ? { '--uitive-accent': view.getComputedStyle(link).color } : {}),
    ...(surface && surface !== 'rgba(0, 0, 0, 0)' ? { '--uitive-surface': surface } : {}),
  };
}
