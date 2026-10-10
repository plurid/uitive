import type { Adaptation, AppliedOperation, Operation, Origin } from '@plurid/uitive-core';
import { accept } from './accept.js';
import type { ClientLike } from './client-like.js';
import { UitiveElement } from './element.js';
import { escape, plural } from './html.js';

const ORIGIN: Record<Origin, string> = {
  user: 'You',
  heuristic: 'Learned',
  model: 'Suggested by model',
};

/**
 * `<uitive-your-interface>`: the user's own definition, in plain words: every change, who made
 * it and why, what is suggested and what is waiting, with the controls to keep, revert,
 * freeze, reset, export and import it, or forget it altogether.
 *
 * Emits `uitive-export` (`detail.document`) when exporting, and `uitive-import` (`detail.adaptation`,
 * or `detail.error`) after an import. Its heading is `::part(heading)`, for hosts that title it
 * themselves.
 */
export class UitiveYourInterface extends UitiveElement {
  #editing = false;
  #message: string | undefined;

  protected styles(): string {
    return `
      .panel { display: grid; gap: 16px; }
      .top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .top h2 { flex: 1; font-size: 15px; }
      .segmented { display: inline-flex; }
      .segmented button:first-child { border-radius: 6px 0 0 6px; }
      .segmented button:last-child { border-radius: 0 6px 6px 0; margin-left: -1px; }
      section { display: grid; gap: 8px; }
      .goal form { display: flex; gap: 6px; }
      .goal input { flex: 1; min-width: 0; }
      .goal q { font-style: italic; }
      .rows { display: grid; gap: 2px; }
      .row {
        display: grid;
        gap: 2px;
        padding: 8px 0;
        border-top: 1px solid var(--_border);
      }
      .row:first-child { border-top: 0; }
      .row .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .row .actions { margin-top: 4px; }
      footer { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 12px; border-top: 1px solid var(--_border); }
      .message { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--_border); }
    `;
  }

  protected key(client: ClientLike): string {
    const snapshot = client.getSnapshot();
    return [
      snapshot.definition.version,
      snapshot.view,
      snapshot.session,
      snapshot.autonomy,
      snapshot.pending.map((operation) => `${operation.id}${operation.held ? '*' : ''}`).join(),
      snapshot.preview ?? '',
      this.#editing,
      this.#message ?? '',
    ].join('|');
  }

  protected template(client: ClientLike): string {
    const snapshot = client.getSnapshot();
    const { definition } = snapshot;
    const changes = definition.operations
      .filter((operation) => operation.status === 'active' || operation.status === 'kept')
      .reverse();
    const suggestions = definition.operations
      .filter((operation) => operation.status === 'suggested')
      .reverse();
    const cooling = definition.cooldowns.filter((entry) => entry.until > snapshot.session).length;
    const counts = [
      cooling ? `${plural(cooling, 'reverted change')} cooling down` : '',
      definition.blocked.length
        ? `${plural(definition.blocked.length, 'change')} blocked for good`
        : '',
    ].filter(Boolean);

    return `<div class="panel">
      <header class="top">
        <h2 part="heading">Your interface</h2>
        <div class="segmented" role="group" aria-label="Show">
          ${(['yours', 'standard'] as const)
            .map(
              (view) =>
                `<button data-act="view" data-arg="${view}" aria-pressed="${snapshot.view === view}">${
                  view === 'yours' ? 'Yours' : 'Standard'
                }</button>`,
            )
            .join('')}
        </div>
        <button data-act="freeze" aria-pressed="${definition.frozen}">${
          definition.frozen ? 'Frozen' : 'Freeze'
        }</button>
      </header>
      <p class="muted">${
        definition.frozen
          ? 'Frozen: nothing changes on its own until you unfreeze it.'
          : snapshot.view === 'standard'
            ? 'You are looking at the application as it ships. Your changes are kept for when you switch back.'
            : 'Every change to your interface, and why. It is yours to keep, revert or reset.'
      }</p>
      ${this.#goal(definition.goal)}
      <section>
        <h3>Changes</h3>
        ${
          changes.length
            ? `<ul class="rows">${changes.map((operation) => this.#row(client, operation)).join('')}</ul>`
            : '<p class="muted">Nothing has changed yet. As you work, changes appear here, each with its reason.</p>'
        }
      </section>
      ${
        suggestions.length
          ? `<section><h3>Suggestions</h3><ul class="rows">${suggestions
              .map((operation) => this.#row(client, operation))
              .join('')}</ul></section>`
          : ''
      }
      ${
        snapshot.pending.length
          ? `<section><h3>Waiting</h3><ul class="rows">${snapshot.pending
              .map((operation) =>
                this.#row(client, operation, {
                  state: operation.held
                    ? 'Waiting for a second plan'
                    : snapshot.autonomy === 'suggest'
                      ? 'Waiting for you'
                      : 'Applies at your next session',
                }),
              )
              .join('')}</ul></section>`
          : ''
      }
      ${counts.length ? `<p class="muted small">${escape(counts.join(' · '))}</p>` : ''}
      ${this.#message ? `<p class="message" role="status">${escape(this.#message)}</p>` : ''}
      <footer>
        <button data-act="export">Export</button>
        <button data-act="choose">Import</button>
        <input class="visually-hidden" type="file" accept="application/json,.json" tabindex="-1"
          aria-label="Definition file" data-act="import" data-on="change">
        <button class="danger" data-act="reset"${this.armed('reset') ? ' data-armed' : ''}>${
          this.armed('reset') ? 'Press again to reset' : 'Back to standard'
        }</button>
        <button class="danger" data-act="forget"${this.armed('forget') ? ' data-armed' : ''}>${
          this.armed('forget') ? 'Press again to forget everything' : 'Forget my data'
        }</button>
      </footer>
    </div>`;
  }

  #goal(goal: string | undefined): string {
    if (this.#editing) {
      return `<section class="goal"><h3>Your goal</h3>
        <form data-act="save-goal" data-on="submit">
          <input name="goal" data-key="goal" maxlength="500" value="${escape(goal ?? '')}"
            placeholder="What do you use this app for?" aria-label="Your goal">
          <button class="primary" type="submit">Save</button>
          <button type="button" data-act="cancel-goal">Cancel</button>
        </form></section>`;
    }
    if (goal === undefined) {
      return `<section class="goal"><h3>Your goal</h3>
        <p class="muted">You haven't said what you use this app for. Saying so helps it adapt sooner.</p>
        <div class="actions"><button data-act="edit-goal">Add a goal</button></div></section>`;
    }
    return `<section class="goal"><h3>Your goal</h3>
      <p><q>${escape(goal)}</q></p>
      <div class="actions"><button data-act="edit-goal">Edit</button>
      <button data-act="clear-goal">Clear</button></div></section>`;
  }

  #row(
    client: ClientLike,
    operation: AppliedOperation | (Operation & { held?: boolean }),
    options: { state?: string } = {},
  ): string {
    const explanation = client.explain(operation);
    const id = escape(operation.id);
    const status = 'status' in operation ? operation.status : undefined;
    let actions: string;
    if (options.state !== undefined) {
      actions = `<button data-act="accept" data-arg="${id}">Accept now</button>
        <button data-act="dismiss" data-arg="${id}">Dismiss</button>`;
    } else if (status === 'suggested') {
      actions = `<button class="primary" data-act="accept" data-arg="${id}">Accept</button>
        <button data-act="dismiss" data-arg="${id}">Dismiss</button>${
          operation.change.kind === 'page'
            ? `<button data-act="preview" data-arg="${id}">${
                client.getSnapshot().preview === operation.id ? 'Stop preview' : 'Preview'
              }</button>`
            : ''
        }`;
    } else {
      actions = `<button data-act="revert" data-arg="${id}">Revert</button>${
        operation.origin !== 'user' && status === 'active'
          ? `<button data-act="keep" data-arg="${id}">Keep</button>`
          : ''
      }`;
    }
    return `<li class="row">
      <div class="meta">
        <span class="chip${operation.origin === 'user' ? '' : ' accent'}">${escape(ORIGIN[operation.origin])}</span>
        ${status === 'kept' ? '<span class="chip">Kept</span>' : ''}
        ${options.state ? `<span class="chip">${escape(options.state)}</span>` : ''}
      </div>
      <span class="title">${escape(explanation?.title ?? operation.id)}</span>
      ${explanation?.reason ? `<span class="reason">${escape(explanation.reason)}</span>` : ''}
      ${explanation?.note ? `<span class="note">${escape(explanation.note)}</span>` : ''}
      <div class="actions">${actions}</div>
    </li>`;
  }

  /** Downloads the user's definition as JSON, and returns it. */
  exportDocument(): ReturnType<ClientLike['export']> | undefined {
    const client = this.client;
    if (!client) return undefined;
    const document_ = client.export();
    this.emit('uitive-export', { document: document_ });
    const create = (globalThis as { URL?: { createObjectURL?(blob: Blob): string } }).URL
      ?.createObjectURL;
    if (typeof create === 'function') {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(document_, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `uitive-${client.contract.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
    return document_;
  }

  /** Imports a definition, reporting what applied and what was skipped. */
  importDocument(document_: unknown): Adaptation | undefined {
    const client = this.client;
    if (!client) return undefined;
    const adaptation = client.import(document_);
    this.#message =
      adaptation.status === 'not_allowed'
        ? `That file isn't a definition for ${client.contract.id}.`
        : `Imported ${plural(adaptation.applied.length, 'change')}${
            adaptation.rejected.length
              ? `; skipped ${adaptation.rejected.length} that no longer fit`
              : ''
          }.`;
    this.emit('uitive-import', { adaptation });
    this.update(true);
    return adaptation;
  }

  protected async act(action: string, argument: string | undefined, target: HTMLElement) {
    const client = this.client;
    if (!client) return;
    switch (action) {
      case 'view':
        client.setView(argument === 'standard' ? 'standard' : 'yours');
        return;
      case 'freeze':
        client.freeze(!client.getSnapshot().definition.frozen);
        return;
      case 'edit-goal':
        this.#editing = true;
        this.update(true);
        this.content.querySelector<HTMLInputElement>('[data-key="goal"]')?.focus();
        return;
      case 'cancel-goal':
        this.#editing = false;
        this.update(true);
        return;
      case 'save-goal': {
        const value = (
          target.querySelector<HTMLInputElement>('input[name="goal"]')?.value ?? ''
        ).trim();
        this.#editing = false;
        client.setGoal(value === '' ? undefined : value);
        this.update(true);
        return;
      }
      case 'clear-goal':
        client.setGoal(undefined);
        return;
      case 'revert':
      case 'keep':
      case 'dismiss':
        if (argument !== undefined) client[action](argument);
        return;
      case 'preview':
        if (argument !== undefined) {
          client.preview(client.getSnapshot().preview === argument ? undefined : argument);
        }
        return;
      case 'accept': {
        const refusal = argument === undefined ? undefined : accept(client, argument);
        if (refusal !== undefined) {
          this.#message = refusal;
          this.update(true);
        }
        return;
      }
      case 'export':
        this.exportDocument();
        return;
      case 'choose':
        this.content.querySelector<HTMLInputElement>('input[type="file"]')?.click();
        return;
      case 'import': {
        const file = (target as HTMLInputElement).files?.[0];
        if (!file) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(await file.text());
        } catch (error) {
          this.#message = "That file isn't valid JSON.";
          this.emit('uitive-import', { error });
          this.update(true);
          return;
        }
        this.importDocument(parsed);
        return;
      }
      case 'reset':
        if (this.confirm('reset')) {
          client.reset();
          this.#message = 'Back to the standard interface. What you used is remembered.';
          this.update(true);
        }
        return;
      case 'forget':
        if (this.confirm('forget')) {
          client.clearData();
          this.#message = 'Everything is forgotten: usage, changes and history.';
          this.update(true);
        }
        return;
    }
  }
}
