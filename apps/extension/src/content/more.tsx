import { useState } from 'react';
import { createRoot } from 'react-dom/client';

export interface MoreItem {
  action: string;
  label: string;
}

export interface More {
  readonly host: HTMLElement;
  update(items: readonly MoreItem[]): void;
  /** Puts the list back at the end of its container, after the page re-rendered it. */
  place(container: Element): void;
  remove(): void;
}

const style = `
.more { font: inherit; }
.more > button, .more li button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; text-align: start; width: 100%; padding: var(--item-padding, 6px 10px); border-radius: 6px; }
.more > button:hover, .more li button:hover { background: rgba(127, 127, 127, 0.12); }
.more ul { list-style: none; margin: 0; padding: 0 0 0 8px; }
`;

function MoreList(props: { items: readonly MoreItem[]; onPick(action: string): void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="more">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        More ({props.items.length})
      </button>
      {open ? (
        <ul>
          {props.items.map((item) => (
            <li key={item.action}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.onPick(item.action);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Lists what a list hides, at the end of its container, in a closed shadow root that takes the
 * look of the container's own items. A pick forwards a click to the hidden original, so the
 * page's own router handles it.
 */
export function mountMore(options: {
  container: Element;
  items: readonly MoreItem[];
  look: Readonly<Record<string, string>>;
  onPick(action: string): void;
}): More {
  const document = options.container.ownerDocument;
  const host = document.createElement('div');
  host.setAttribute('data-uitive-more', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = document.createElement('style');
  sheet.textContent = style;
  const root = document.createElement('div');
  for (const [name, value] of Object.entries(options.look)) root.style.setProperty(name, value);
  shadow.append(sheet, root);
  options.container.append(host);
  const react = createRoot(root);
  const render = (items: readonly MoreItem[]) =>
    react.render(<MoreList items={items} onPick={options.onPick} />);
  render(options.items);
  return {
    host,
    update: render,
    place(container) {
      if (host.parentElement === container && container.lastElementChild === host) return;
      container.append(host);
    },
    remove() {
      react.unmount();
      host.remove();
    },
  };
}

/** How the container's items look, so More looks like one of them. */
export function lookOf(item: Element | undefined): Record<string, string> {
  const view = item?.ownerDocument.defaultView;
  if (!item || !view) return {};
  const style = view.getComputedStyle(item);
  return {
    'font-family': style.fontFamily,
    'font-size': style.fontSize,
    color: style.color,
    '--item-padding': style.padding,
  };
}
