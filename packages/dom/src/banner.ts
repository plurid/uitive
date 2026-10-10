import type { Adaptation, AnyContract, AppliedOperation, CommandStatus } from '@plurid/uitive-core';
import { accept } from './accept.js';
import type { ClientLike } from './client-like.js';
import { UitiveElement } from './element.js';
import { escape, plural } from './html.js';

const COMMAND: Record<Exclude<CommandStatus, 'unavailable'>, string> = {
  done: 'Done',
  partial: 'Partly done',
  not_allowed: 'Not allowed',
  ambiguous: 'Which one did you mean?',
  unsupported: "That isn't something this app can change",
};

/** A simple command this application understands, such as "hide Import", for hints. */
function example(contract: AnyContract): string {
  for (const id of contract.surfaceIds) {
    const spec = contract.surfaces[id];
    const first = spec?.kind === 'list' ? spec.items[0] : undefined;
    if (first !== undefined) return `hide ${contract.actions[first]?.label ?? first}`;
  }
  return 'hide …';
}

/** What a command's status means, in a line. */
export function commandHeading(status: CommandStatus, contract: AnyContract): string {
  return status === 'unavailable'
    ? `The planner is offline. Simple commands like “${example(contract)}” still work.`
    : COMMAND[status];
}

/** Whether an adaptation is worth telling the user about. */
const notable = (adaptation: Adaptation) =>
  adaptation.kind === 'command' || adaptation.applied.length > 0;

function heading(
  adaptation: Adaptation,
  operations: readonly AppliedOperation[],
  contract: AnyContract,
): string {
  if (adaptation.kind === 'command') return commandHeading(adaptation.status ?? 'done', contract);
  if (adaptation.kind === 'user') return 'Done';
  if (adaptation.kind === 'import') return 'Definition imported';
  const suggestions = operations.every(
    (operation) => operation.status === 'suggested' || operation.status === 'dismissed',
  );
  return operations.length > 0 && suggestions ? 'New suggestions' : 'Your interface changed';
}

/**
 * `<uitive-banner>`: tells the user what just changed in their interface and why, with Revert and
 * Keep for each change, and answers their commands, including refusals and their reasons.
 * Floats at the bottom right by default; restyle `:host` to place it elsewhere, or add `docked`
 * to put it in the page's flow, such as inside the application's own notification area.
 *
 * Emits `uitive-dismiss` (`detail.adaptation`: the adaptation's ID) when closed.
 */
export class UitiveBanner extends UitiveElement {
  #dismissed = new Set<string>();
  #seen: { client: ClientLike; ids: Set<string> } | undefined;
  /** Why the last Accept pressed here couldn't apply, for the adaptation it was pressed in. */
  #refusal: { adaptation: string; text: string } | undefined;

  connectedCallback(): void {
    this.content.setAttribute('role', 'status');
    this.content.setAttribute('aria-live', 'polite');
    super.connectedCallback();
  }

  protected styles(): string {
    return `
      :host {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483000;
        width: min(400px, calc(100vw - 32px));
      }
      :host([docked]) { position: static; width: auto; z-index: auto; }
      .card {
        background: var(--_surface);
        border: 1px solid var(--_border);
        border-radius: var(--_radius);
        box-shadow: 0 8px 28px rgb(0 0 0 / 0.14);
        padding: 12px 14px;
        display: grid;
        gap: 10px;
        /* A long list of changes scrolls inside the card, never past the screen's edge. */
        max-height: calc(100vh - 32px);
        overflow-y: auto;
      }
      /* On a phone the card keeps to half the screen, so the application stays reachable above it. */
      @media (max-width: 720px) {
        :host(:not([docked])) .card { max-height: 50vh; }
      }
      header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      header h2::before {
        content: '';
        display: inline-block;
        width: 7px;
        height: 7px;
        margin-right: 8px;
        border-radius: 50%;
        background: var(--_accent);
        vertical-align: 1px;
      }
      .said { color: var(--_muted); }
      .changes { display: grid; gap: 8px; }
      .change { display: grid; gap: 2px; }
      .change.done .title { color: var(--_muted); text-decoration: line-through; }
      .change .actions { margin-top: 4px; }
      .rejected li::before { content: '· '; color: var(--_muted); }
      .refusal { color: var(--_danger); }
      footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      footer:empty { display: none; }
    `;
  }

  /** The most recent notable adaptation, unless the user closed it. */
  #current(client: ClientLike): Adaptation | undefined {
    const { adaptations } = client.getSnapshot();
    // What happened before this banner first showed the client, such as before a reload, isn't news.
    if (this.#seen?.client !== client) {
      this.#seen = { client, ids: new Set(adaptations.map((adaptation) => adaptation.id)) };
    }
    for (let index = adaptations.length - 1; index >= 0; index--) {
      const adaptation = adaptations[index] as Adaptation;
      if (!notable(adaptation)) continue;
      const old = this.#dismissed.has(adaptation.id) || this.#seen.ids.has(adaptation.id);
      return old ? undefined : adaptation;
    }
    return undefined;
  }

  protected key(client: ClientLike): string {
    const snapshot = client.getSnapshot();
    const current = this.#current(client);
    return [
      current ? `${current.id}:${current.status ?? ''}:${current.applied.length}` : '',
      snapshot.definition.version,
      snapshot.autonomy,
      snapshot.pending.map((operation) => `${operation.id}${operation.held ? '*' : ''}`).join(),
      snapshot.preview ?? '',
      this.#refusal?.adaptation === current?.id ? this.#refusal?.text : '',
    ].join('|');
  }

  protected template(client: ClientLike): string {
    const adaptation = this.#current(client);
    if (!adaptation) return '';
    const snapshot = client.getSnapshot();
    const operations = adaptation.applied
      .map((id) => snapshot.definition.operations.find((operation) => operation.id === id))
      .filter((operation): operation is AppliedOperation => operation !== undefined);
    const active = operations.filter((operation) => operation.status === 'active');

    const changes = operations.map((operation) => {
      const explanation = client.explain(operation.id);
      const finished = ['reverted', 'dismissed'].includes(operation.status);
      let actions: string;
      if (operation.status === 'active') {
        actions = `<button data-act="revert" data-arg="${escape(operation.id)}">Revert</button>${
          operation.origin === 'user'
            ? ''
            : `<button data-act="keep" data-arg="${escape(operation.id)}">Keep</button>`
        }`;
      } else if (operation.status === 'suggested') {
        const id = escape(operation.id);
        actions = `<button class="primary" data-act="accept" data-arg="${id}">Accept</button>
          <button data-act="dismiss" data-arg="${id}">Dismiss</button>${
            operation.change.kind === 'page'
              ? `<button data-act="preview" data-arg="${id}">${
                  client.getSnapshot().preview === operation.id ? 'Stop preview' : 'Preview'
                }</button>`
              : ''
          }`;
      } else {
        const label = { kept: 'Kept', reverted: 'Reverted', dismissed: 'Dismissed' }[
          operation.status as 'kept' | 'reverted' | 'dismissed'
        ];
        actions = `<span class="chip">${escape(label)}</span>`;
      }
      return `<li class="change${finished ? ' done' : ''}">
        <span class="title">${escape(explanation?.title ?? operation.id)}</span>
        ${explanation?.reason ? `<span class="reason">${escape(explanation.reason)}</span>` : ''}
        ${explanation?.note ? `<span class="note">${escape(explanation.note)}</span>` : ''}
        <div class="actions">${actions}</div>
      </li>`;
    });

    const refusals = adaptation.rejected.filter(
      (rejection) => adaptation.kind === 'command' || rejection.rule !== 'noop',
    );
    const waiting = snapshot.pending.filter((operation) => !operation.held).length;
    const hint =
      waiting === 0
        ? ''
        : snapshot.autonomy === 'mixed'
          ? `${plural(waiting, 'more change')} will apply at your next session`
          : snapshot.autonomy === 'suggest'
            ? `${plural(waiting, 'change')} ${waiting === 1 ? 'is' : 'are'} waiting for you`
            : '';

    return `<section class="card" aria-label="Interface changes">
      <header>
        <h2 part="heading">${escape(heading(adaptation, operations, client.contract))}</h2>
        <button class="quiet" data-act="close" aria-label="Close">✕</button>
      </header>
      ${adaptation.text ? `<p class="said">“${escape(adaptation.text)}”</p>` : ''}
      ${
        adaptation.candidates?.length
          ? `<ul class="candidates">${adaptation.candidates
              .map((candidate) => `<li>${escape(candidate)}</li>`)
              .join('')}</ul>`
          : ''
      }
      ${changes.length ? `<ul class="changes">${changes.join('')}</ul>` : ''}
      ${
        this.#refusal?.adaptation === adaptation.id
          ? `<p class="refusal">${escape(this.#refusal.text)}</p>`
          : ''
      }
      ${
        refusals.length
          ? `<div><h3>Not changed</h3><ul class="rejected">${refusals
              .map((rejection) => `<li>${escape(rejection.message)}</li>`)
              .join('')}</ul></div>`
          : ''
      }
      <footer>${
        active.length > 1
          ? `<button data-act="revert-all" data-arg="${escape(adaptation.id)}">Revert all</button>`
          : ''
      }${hint ? `<span class="muted small">${escape(hint)}</span>` : ''}</footer>
    </section>`;
  }

  protected act(action: string, argument: string | undefined): void {
    const client = this.client;
    if (!client) return;
    if (action === 'close') {
      const current = this.#current(client);
      if (!current) return;
      this.#dismissed.add(current.id);
      this.emit('uitive-dismiss', { adaptation: current.id });
      this.update(true);
      return;
    }
    if (argument === undefined) return;
    if (action === 'revert') client.revert(argument);
    else if (action === 'keep') client.keep(argument);
    else if (action === 'accept') {
      const text = accept(client, argument);
      const current = this.#current(client);
      if (text !== undefined && current) {
        this.#refusal = { adaptation: current.id, text };
        this.update(true);
      }
    } else if (action === 'dismiss') client.dismiss(argument);
    else if (action === 'preview') {
      client.preview(client.getSnapshot().preview === argument ? undefined : argument);
    } else if (action === 'revert-all') client.revertAdaptation(argument);
  }
}
