import type { Uitive } from '@plurid/uitive-core';
import type { ClientLike } from './client-like.js';
import { UitiveElement } from './element.js';
import { escape } from './html.js';
import { forward, movedOut } from './markup.js';

/** What `<uitive-more>` needs from a client. */
export type MoreClientLike = ClientLike & Pick<Uitive, 'surface' | 'standard' | 'record'>;

const quote = (value: string) => JSON.stringify(value);

/**
 * `<uitive-more list="toolbar">`: a menu of the items the person moved out of a list adapted with
 * `adaptMarkup`, so nothing is ever out of reach. Choosing one clicks the hidden original, so the
 * application's own handler runs; when the original isn't in the page, it emits `uitive-open`
 * (`detail: { list, action }`) for the application to run. Shows nothing while no item is out.
 * The `label` attribute names its button (default "More").
 */
export class UitiveMore extends UitiveElement<MoreClientLike> {
  #open = false;
  readonly #outside = (event: Event) => {
    if (this.#open && !event.composedPath().includes(this)) this.#toggle(false);
  };
  readonly #escape = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape' && this.#open) this.#toggle(false);
  };

  static get observedAttributes(): string[] {
    return ['list', 'label'];
  }

  attributeChangedCallback(): void {
    this.update(true);
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.ownerDocument.addEventListener('pointerdown', this.#outside, true);
    this.addEventListener('keydown', this.#escape);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ownerDocument.removeEventListener('pointerdown', this.#outside, true);
    this.removeEventListener('keydown', this.#escape);
  }

  protected styles(): string {
    return `
      :host { display: inline-block; position: relative; }
      .menu {
        position: absolute;
        inset-inline-start: 0;
        top: calc(100% + 4px);
        z-index: 2147483000;
        min-width: 180px;
        display: grid;
        padding: 4px;
        background: var(--_surface);
        border: 1px solid var(--_border);
        border-radius: var(--_radius);
        box-shadow: 0 8px 28px rgb(0 0 0 / 0.14);
      }
      .menu button { border: 0; text-align: start; padding: 6px 8px; }
      .menu button:hover, .menu button:focus-visible { background: color-mix(in srgb, var(--_accent) 12%, transparent); }
      .toggle { padding: 4px 10px; cursor: pointer; }
    `;
  }

  #list(): string {
    return this.getAttribute('list') ?? '';
  }

  #items(client: MoreClientLike) {
    const list = this.#list();
    const spec = client.contract.surfaces[list];
    return spec?.kind === 'list' ? movedOut(client, list) : [];
  }

  #toggle(open: boolean): void {
    this.#open = open;
    this.update(true);
  }

  protected key(client: MoreClientLike): string {
    const items = this.#items(client).map((item) => `${item.id}:${item.label}`);
    return JSON.stringify([items, this.#open, this.getAttribute('label')]);
  }

  protected template(client: MoreClientLike): string {
    const items = this.#items(client);
    if (items.length === 0) return '';
    const label = this.getAttribute('label') ?? 'More';
    return `<button type="button" class="toggle" data-act="toggle" aria-haspopup="menu" aria-expanded="${this.#open}">${escape(label)}</button>${
      this.#open
        ? `<div class="menu" role="menu">${items
            .map(
              (item) =>
                `<button type="button" role="menuitem" data-act="open" data-arg="${escape(item.id)}" title="${escape(item.description)}">${escape(item.label)}</button>`,
            )
            .join('')}</div>`
        : ''
    }`;
  }

  protected act(action: string, argument: string | undefined): void {
    if (action === 'toggle') {
      this.#toggle(!this.#open);
      return;
    }
    const client = this.client;
    if (action !== 'open' || !argument || !client) return;
    this.#toggle(false);
    const list = this.#list();
    client.record(argument, { via: 'overflow', surface: list });
    const root = this.getRootNode() as Document | ShadowRoot;
    const original = root.querySelector<HTMLElement>(
      `[data-uitive-list=${quote(list)}] [data-uitive-item=${quote(argument)}]`,
    );
    if (original) forward(original);
    else this.emit('uitive-open', { list, action: argument });
  }
}
