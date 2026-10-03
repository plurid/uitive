import { formatValue, type Aptuitive, type Confirmation } from '@plurid/aptuitive-core';
import type { ClientLike } from './client-like.js';
import { AptElement } from './element.js';
import { escape } from './html.js';

/** What `<apt-confirm>` needs from a client. */
export type ConfirmClientLike = ClientLike &
  Pick<Aptuitive, 'confirm' | 'cancel' | 'confirmations'>;

const normal = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * `<apt-confirm>`: asks the person before an action changes data: what it does and to what, and
 * for a destructive action, the phrase to type. Place it once. While it is in the page, actions
 * with effects wait for the person's answer; without it, they are refused.
 */
export class AptConfirm extends AptElement<ConfirmClientLike> {
  #shown: string | undefined;
  readonly #escape = (event: Event) => {
    const confirmation = this.#confirmation();
    if ((event as KeyboardEvent).key !== 'Escape' || !confirmation) return;
    event.preventDefault();
    this.client?.cancel(confirmation.id);
  };

  constructor() {
    super();
    // Typing the phrase enables the button without rendering again, so nothing typed is lost.
    this.content.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      const expected = this.#confirmation()?.phrase;
      if (input.name !== 'phrase' || expected === undefined) return;
      const submit = this.content.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit) submit.disabled = normal(input.value) !== normal(expected);
    });
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('keydown', this.#escape);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.#escape);
  }

  protected attached(client: ConfirmClientLike): () => void {
    return client.confirmations();
  }

  #confirmation(): Confirmation | undefined {
    return this.client?.getSnapshot().confirmation;
  }

  protected styles(): string {
    return `
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: grid;
        place-items: center;
        padding: 16px;
        background: rgb(0 0 0 / 0.32);
      }
      .dialog {
        width: min(440px, 100%);
        display: grid;
        gap: 12px;
        padding: 18px;
        background: var(--_surface);
        border: 1px solid var(--_border);
        border-radius: var(--_radius);
        box-shadow: 0 12px 40px rgb(0 0 0 / 0.2);
      }
      h2 { font-size: 15px; }
      dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
      dt { color: var(--_muted); }
      dd { margin: 0; overflow-wrap: anywhere; }
      label { display: grid; gap: 4px; }
      input { padding: 6px 10px; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; }
      .actions button { padding: 6px 12px; cursor: pointer; }
      button.danger { background: var(--_danger); border-color: var(--_danger); color: var(--_surface); }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
  }

  protected key(client: ConfirmClientLike): string {
    return client.getSnapshot().confirmation?.id ?? '';
  }

  protected template(client: ConfirmClientLike): string {
    const confirmation = client.getSnapshot().confirmation;
    if (!confirmation) return '';
    const { phrase } = confirmation;
    const fields = confirmation.fields
      .map(
        (field) =>
          `<dt>${escape(field.label)}</dt><dd>${escape(formatValue(field, confirmation.params[field.name]))}</dd>`,
      )
      .join('');
    return `<div class="backdrop">
      <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="title" data-act="confirm" data-on="submit">
        <h2 id="title" part="heading">${escape(confirmation.label)}</h2>
        <p>${escape(confirmation.description)}</p>
        ${fields ? `<dl>${fields}</dl>` : ''}
        ${
          phrase === undefined
            ? ''
            : `<label>Type "${escape(phrase)}" to confirm<input data-key="phrase" name="phrase" autocomplete="off" spellcheck="false"></label>`
        }
        <div class="actions">
          <button type="button" data-act="cancel">Cancel</button>
          <button type="submit" class="${confirmation.effect === 'destructive' ? 'danger' : 'primary'}"${phrase === undefined ? '' : ' disabled'}>${escape(confirmation.label)}</button>
        </div>
      </form>
    </div>`;
  }

  protected update(force = false): void {
    super.update(force);
    const confirmation = this.#confirmation();
    if (confirmation?.id === this.#shown) return;
    this.#shown = confirmation?.id;
    this.content.querySelector<HTMLElement>('input, button[type="submit"]')?.focus();
  }

  protected act(action: string): void {
    const client = this.client;
    const confirmation = this.#confirmation();
    if (!client || !confirmation) return;
    if (action === 'cancel') client.cancel(confirmation.id);
    else if (action === 'confirm') {
      const phrase = this.content.querySelector<HTMLInputElement>('input[name="phrase"]')?.value;
      client.confirm(confirmation.id, phrase);
    }
  }
}
