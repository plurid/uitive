import { formatValue, type Confirmation, type Field, type Uitive } from '@plurid/uitive-core';
import type { ClientLike } from './client-like.js';
import { UitiveElement } from './element.js';
import { escape } from './html.js';

/** What `<uitive-confirm>` needs from a client. */
export type ConfirmClientLike = ClientLike & Pick<Uitive, 'confirm' | 'cancel' | 'confirmations'>;

const normal = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** The currency a money param is in: its fixed code, or the value of its currency param. */
function currencyOf(field: Field, params: Readonly<Record<string, unknown>>): string | undefined {
  if (field.code !== undefined) return field.code;
  const value = field.currency === undefined ? undefined : params[field.currency];
  return typeof value === 'string' && value.trim() !== '' ? value.trim().toUpperCase() : undefined;
}

/** The focused element, looking into shadow roots, so focus can go back to it. */
function focused(root: Document): HTMLElement | null {
  let active = root.activeElement as HTMLElement | null;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement as HTMLElement;
  return active;
}

/**
 * `<uitive-confirm>`: asks the person before an action changes data: what it does and to what, and
 * for a destructive action, the phrase to type. Place it once. While it is in the page, actions
 * with effects wait for the person's answer; without it, they are refused. It asks in a modal
 * dialog that holds focus and gives it back when the run is answered.
 */
export class UitiveConfirm extends UitiveElement<ConfirmClientLike> {
  #shown: string | undefined;
  #opener: HTMLElement | null = null;
  readonly #escape = (event: Event) => {
    const confirmation = this.#confirmation();
    const escape = event.type === 'cancel' || (event as KeyboardEvent).key === 'Escape';
    if (!escape || !confirmation) return;
    event.preventDefault();
    this.client?.cancel(confirmation.id);
  };

  constructor() {
    super();
    // Escape on a modal dialog cancels it; the run is canceled with it.
    this.content.addEventListener('cancel', this.#escape, true);
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
      dialog {
        width: min(440px, calc(100vw - 32px));
        padding: 18px;
        color: var(--_text);
        background: var(--_surface);
        border: 1px solid var(--_border);
        border-radius: var(--_radius);
        box-shadow: 0 12px 40px rgb(0 0 0 / 0.2);
      }
      dialog::backdrop { background: rgb(0 0 0 / 0.32); }
      form { display: grid; gap: 12px; }
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
          `<dt>${escape(field.label)}</dt><dd>${escape(formatValue(field, confirmation.params[field.name], currencyOf(field, confirmation.params)))}</dd>`,
      )
      .join('');
    return `<dialog aria-labelledby="title">
      <form data-act="confirm" data-on="submit">
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
    </dialog>`;
  }

  protected update(force = false): void {
    const confirmation = this.#confirmation();
    const opening = confirmation !== undefined && this.#shown === undefined;
    if (opening) this.#opener = focused(this.ownerDocument);
    super.update(force);
    if (confirmation?.id === this.#shown) return;
    this.#shown = confirmation?.id;
    const dialog = this.content.querySelector('dialog');
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (dialog) {
      this.content.querySelector<HTMLElement>('input, button[type="submit"]')?.focus();
      return;
    }
    // Answered: focus goes back where it was.
    if (this.#opener?.isConnected) this.#opener.focus();
    this.#opener = null;
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
