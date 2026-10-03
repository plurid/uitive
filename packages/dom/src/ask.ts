import type { Adaptation, Aptuitive } from '@plurid/aptuitive-core';
import { commandHeading } from './banner.js';
import type { ClientLike } from './client-like.js';
import { AptElement } from './element.js';
import { escape } from './html.js';

/** What `<apt-ask>` needs from a client. */
export type AskClientLike = ClientLike & Pick<Aptuitive, 'ask'>;

/** What a command did, in a line. */
function outcome(adaptation: Adaptation, client: AskClientLike): string {
  const heading = commandHeading(adaptation.status ?? 'done', client.contract);
  if (adaptation.status === 'ambiguous' && adaptation.candidates?.length) {
    return `${heading} ${adaptation.candidates.join(', ')}`;
  }
  const reason = adaptation.rejected[0]?.message;
  return adaptation.status === 'not_allowed' && reason ? `${heading}: ${reason}` : heading;
}

/**
 * `<apt-ask>`: where the person asks for a change in their own words, such as "hide Print". Simple
 * commands work without a model; with a planner, so do requests like "make my home a morning
 * check". What happened shows here in a line, and in full in `<apt-banner>` when there is one.
 * Emits `apt-asked` (`detail.adaptation`). The `placeholder` attribute replaces the hint.
 */
export class AptAsk extends AptElement<AskClientLike> {
  #pending = false;
  #status = '';

  static get observedAttributes(): string[] {
    return ['placeholder'];
  }

  attributeChangedCallback(): void {
    this.update(true);
  }

  protected styles(): string {
    return `
      form { display: flex; gap: 6px; }
      input { flex: 1; min-width: 0; padding: 6px 10px; }
      button { padding: 6px 12px; cursor: pointer; }
      button:disabled { cursor: progress; opacity: 0.6; }
      .status { margin-top: 4px; color: var(--_muted); font-size: 12px; min-height: 1.45em; }
    `;
  }

  protected key(): string {
    return JSON.stringify([this.#pending, this.#status, this.getAttribute('placeholder')]);
  }

  protected template(): string {
    const hint = this.getAttribute('placeholder') ?? 'Ask for a change, such as "hide Print"';
    return `<form data-act="ask" data-on="submit">
      <input data-key="ask" name="text" type="text" autocomplete="off" aria-label="Ask for a change to this interface" placeholder="${escape(hint)}">
      <button type="submit"${this.#pending ? ' disabled' : ''}>Ask</button>
    </form>
    <p class="status" role="status" aria-live="polite">${escape(this.#status)}</p>`;
  }

  protected async act(action: string): Promise<void> {
    const client = this.client;
    const input = this.content.querySelector('input');
    const text = input?.value.trim() ?? '';
    if (action !== 'ask' || !client || this.#pending || text === '') return;
    this.#pending = true;
    this.#status = 'Working on it';
    this.update();
    try {
      const adaptation = await client.ask(text);
      this.#status = outcome(adaptation, client);
      const current = this.content.querySelector('input');
      if (current && (adaptation.status === 'done' || adaptation.status === 'partial')) {
        current.value = '';
      }
      this.emit('apt-asked', { adaptation });
    } catch (error) {
      this.#status = commandHeading('unavailable', client.contract);
      throw error;
    } finally {
      this.#pending = false;
      this.update();
    }
  }
}
