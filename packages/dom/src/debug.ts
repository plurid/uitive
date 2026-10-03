import {
  hash,
  operationKey,
  simulate,
  type Uitive,
  type Autonomy,
  type Persona,
  type SessionReport,
} from '@plurid/uitive-core';
import type { DebugClientLike } from './client-like.js';
import { UitiveElement } from './element.js';
import { escape, plural } from './html.js';

const TABS = {
  events: 'Events',
  summary: 'Summary',
  request: 'Request',
  definition: 'Definition',
  pending: 'Pending',
  history: 'History',
  controls: 'Controls',
} as const;

type Tab = keyof typeof TABS;

/** A persona's seed, stable across reloads, so a simulated week repeats exactly. */
const seedFor = (persona: Persona) => parseInt(hash(persona.name).slice(0, 8), 36) % 2147483647;

const cell = (value: unknown) => `<td>${escape(value)}</td>`;
const table = (heads: readonly string[], rows: readonly string[], empty: string) =>
  rows.length
    ? `<table><thead><tr>${heads.map((head) => `<th>${escape(head)}</th>`).join('')}</tr></thead>
       <tbody>${rows.join('')}</tbody></table>`
    : `<p class="muted">${escape(empty)}</p>`;

/**
 * `<uitive-debug>`: a developer panel over a client: usage events, the summary and the exact
 * request a planner receives, the definition, pending changes and history, with controls to
 * plan, start sessions, change autonomy and simulate personas.
 *
 * Set `personas` to offer "Simulate a week" buttons. Starts collapsed with the `collapsed`
 * attribute. Emits `uitive-simulated` (`detail.persona`, `detail.reports`) after a simulation.
 */
export class UitiveDebug extends UitiveElement<DebugClientLike> {
  #tab: Tab = 'events';
  #open = true;
  #busy: string | undefined;
  #status: string | undefined;
  #personas: readonly Persona[] = [];

  /** Personas offered for "Simulate a week". @default [] */
  get personas(): readonly Persona[] {
    return this.#personas;
  }

  set personas(personas: readonly Persona[] | undefined) {
    this.#personas = personas ?? [];
    this.update(true);
  }

  connectedCallback(): void {
    if (this.hasAttribute('collapsed')) this.#open = false;
    super.connectedCallback();
  }

  protected styles(): string {
    return `
      :host { font-size: 12px; }
      .panel {
        background: var(--_surface);
        border: 1px solid var(--_border);
        border-radius: var(--_radius);
        overflow: hidden;
      }
      .bar { display: flex; align-items: center; gap: 10px; padding: 6px 10px; }
      .bar button { font-weight: 600; }
      .bar .muted { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      nav { display: flex; flex-wrap: wrap; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--_border); }
      nav button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 4px 8px; background: transparent; }
      nav button[aria-selected='true'] { border-bottom-color: var(--_accent); color: var(--_accent); }
      .body { padding: 8px 10px; max-height: 340px; overflow: auto; display: grid; gap: 8px; }
      table { border-collapse: collapse; width: 100%; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
      th, td { text-align: left; padding: 2px 6px; border-bottom: 1px solid var(--_border); white-space: nowrap; }
      th { color: var(--_muted); font-weight: 500; position: sticky; top: 0; background: var(--_surface); }
      pre { margin: 0; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
      .caption { color: var(--_muted); }
      .history li { padding: 6px 0; border-top: 1px solid var(--_border); display: grid; gap: 2px; }
      .history li:first-child { border-top: 0; }
      .controls { display: grid; gap: 10px; }
      .personas { display: grid; gap: 6px; }
      .status { padding: 4px 8px; border: 1px solid var(--_border); border-radius: 6px; }
    `;
  }

  protected key(client: DebugClientLike): string {
    const snapshot = client.getSnapshot();
    const local = [
      this.#tab,
      this.#open,
      this.#busy ?? '',
      this.#status ?? '',
      this.#personas.length,
    ];
    if (!this.#open) return [...local, snapshot.session].join('|');
    const data: Record<Tab, unknown[]> = {
      events: [snapshot.usage, snapshot.session],
      summary: [snapshot.usage, snapshot.definition.version, snapshot.session],
      request: [
        snapshot.usage,
        snapshot.definition.version,
        snapshot.session,
        JSON.stringify(snapshot.contexts),
      ],
      definition: [snapshot.definition.version],
      pending: [
        snapshot.pending.map((operation) => `${operation.id}${operation.held ? '*' : ''}`).join(),
      ],
      history: [
        snapshot.adaptations.length,
        snapshot.latest?.id,
        snapshot.latest?.status,
        snapshot.definition.version,
      ],
      controls: [snapshot.autonomy, snapshot.session, snapshot.pending.length],
    };
    return [...local, snapshot.session, snapshot.autonomy, ...data[this.#tab]].join('|');
  }

  protected template(client: DebugClientLike): string {
    const snapshot = client.getSnapshot();
    const latest = snapshot.latest?.meta;
    const bar = `<header class="bar">
      <button class="quiet" data-act="toggle" aria-expanded="${this.#open}">${this.#open ? '▾' : '▸'} Uitive</button>
      <span class="muted">session ${snapshot.session} · ${escape(snapshot.autonomy)} · ${escape(
        client.contract.id,
      )}${latest ? ` · last plan: ${escape(latest.planner)}${latest.fellBack ? ' (fell back)' : ''}` : ''}</span>
    </header>`;
    if (!this.#open) return `<div class="panel">${bar}</div>`;
    const tabs = (Object.keys(TABS) as Tab[])
      .map(
        (tab) =>
          `<button role="tab" data-act="tab" data-arg="${tab}" aria-selected="${tab === this.#tab}">${TABS[tab]}</button>`,
      )
      .join('');
    return `<div class="panel">${bar}<nav role="tablist">${tabs}</nav>
      <div class="body" role="tabpanel">${this.#body(client)}</div></div>`;
  }

  #body(client: DebugClientLike): string {
    const snapshot = client.getSnapshot();
    switch (this.#tab) {
      case 'events':
        return table(
          ['action', 'via', 'session', 'contexts', 'typed'],
          [...client.events(50)].reverse().map(
            (event) =>
              `<tr>${cell(event.action)}${cell(event.via)}${cell(event.session)}${cell(
                Object.entries(event.contexts ?? {})
                  .map(([name, value]) => `${name}=${value}`)
                  .join(' '),
              )}${cell(event.typed ? '✓' : '')}</tr>`,
          ),
          'No usage yet.',
        );
      case 'summary':
        return table(
          [
            'surface',
            'context',
            'action',
            'place',
            'pinned',
            'uses',
            'sessions',
            'overflow',
            'idle',
            'placement',
            'activity',
          ],
          client
            .summary()
            .rows.map(
              (row) =>
                `<tr>${[
                  row.surface,
                  row.context ?? '',
                  row.action,
                  row.place,
                  row.pinned ? '✓' : '',
                  row.uses,
                  row.activeSessions,
                  row.viaOverflow,
                  row.idleSessions,
                  row.placement,
                  row.activity,
                ]
                  .map(cell)
                  .join('')}</tr>`,
            ),
          'No rows: nothing visible has usage yet.',
        );
      case 'request':
        return `<p class="caption">Everything a planner receives: all that leaves the device</p>
          <pre>${escape(JSON.stringify(client.request('plan'), null, 2))}</pre>`;
      case 'definition':
        return table(
          ['id', 'origin', 'layer', 'status', 'session', 'key', 'change'],
          [...snapshot.definition.operations]
            .reverse()
            .map(
              (operation) =>
                `<tr>${[
                  operation.id,
                  operation.origin,
                  operation.layer,
                  operation.status,
                  operation.session,
                  operationKey(operation.change),
                  client.explain(operation.id)?.title ?? '',
                ]
                  .map(cell)
                  .join('')}</tr>`,
            ),
          'The standard interface: no operations applied.',
        );
      case 'pending':
        return table(
          ['key', 'origin', 'strength', 'held', 'change'],
          snapshot.pending.map(
            (operation) =>
              `<tr>${[
                operation.key,
                operation.origin,
                operation.strength.toFixed(2),
                operation.held ? 'held' : 'ready',
                client.explain(operation)?.title ?? '',
              ]
                .map(cell)
                .join('')}</tr>`,
          ),
          'Nothing pending.',
        );
      case 'history':
        return snapshot.adaptations.length
          ? `<ul class="history">${[...snapshot.adaptations]
              .reverse()
              .map((adaptation) => {
                const meta = adaptation.meta;
                const usage = meta?.usage;
                const details = [
                  `${adaptation.kind} · session ${adaptation.session}`,
                  plural(adaptation.applied.length, 'applied', 'applied'),
                  adaptation.pending ? `${adaptation.pending} pending` : '',
                  adaptation.status ? `status ${adaptation.status}` : '',
                ].filter(Boolean);
                const planner = meta
                  ? [
                      meta.planner,
                      meta.model ?? '',
                      `${meta.ms} ms`,
                      meta.fellBack ? `fell back: ${meta.fellBack}` : '',
                      usage
                        ? `tokens in ${usage.input} · out ${usage.output} · cache read ${usage.cacheRead} · cache write ${usage.cacheWrite}`
                        : '',
                      meta.cost !== undefined ? `$${meta.cost.toFixed(4)}` : '',
                    ].filter(Boolean)
                  : [];
                return `<li>
                  <span>${escape(details.join(' · '))}</span>
                  ${adaptation.text ? `<span class="muted">“${escape(adaptation.text)}”</span>` : ''}
                  ${planner.length ? `<span class="muted">${escape(planner.join(' · '))}</span>` : ''}
                  ${adaptation.rejected
                    .map(
                      (rejection) =>
                        `<span class="muted">✕ ${escape(rejection.rule)}: ${escape(rejection.message)}</span>`,
                    )
                    .join('')}
                </li>`;
              })
              .join('')}</ul>`
          : '<p class="muted">No adaptations yet.</p>';
      case 'controls':
        return this.#controls(snapshot.autonomy);
    }
  }

  #controls(autonomy: Autonomy): string {
    const busy = this.#busy !== undefined;
    const disabled = busy ? ' disabled' : '';
    const personas = this.#personas
      .map(
        (persona, index) =>
          `<div><button data-act="simulate" data-arg="${index}"${disabled}>${
            this.#busy === persona.name
              ? 'Simulating…'
              : `Simulate a week as ${escape(persona.name)}`
          }</button> <span class="muted">${escape(persona.description)}</span></div>`,
      )
      .join('');
    return `<div class="controls">
      <div class="actions">
        <button data-act="plan"${disabled}>${this.#busy === 'plan' ? 'Planning…' : 'Plan now'}</button>
        <button data-act="next"${disabled}>Next session</button>
        <button data-act="apply"${disabled}>Apply now</button>
        <label>Autonomy <select data-act="autonomy" data-on="change" data-key="autonomy">${(
          ['suggest', 'mixed', 'auto'] as const
        )
          .map(
            (level) =>
              `<option value="${level}"${level === autonomy ? ' selected' : ''}>${level}</option>`,
          )
          .join('')}</select></label>
        <button data-act="reset"${disabled}>Reset</button>
        <button class="danger" data-act="clear"${this.armed('clear') ? ' data-armed' : ''}${disabled}>${
          this.armed('clear') ? 'Press again to clear' : 'Clear data'
        }</button>
      </div>
      ${personas ? `<div class="personas">${personas}</div>` : ''}
      ${this.#status ? `<p class="status" role="status">${escape(this.#status)}</p>` : ''}
    </div>`;
  }

  /** Simulates a week of use as a persona, where the client lives. */
  async simulatePersona(persona: Persona): Promise<readonly SessionReport[]> {
    const client = this.client;
    if (!client) return [];
    this.#busy = persona.name;
    this.update(true);
    try {
      const options = { sessions: 7, seed: seedFor(persona) };
      const reports = client.simulate
        ? await client.simulate(persona, options)
        : await simulate(client as unknown as Uitive, persona, options);
      const applied = reports.reduce(
        (sum, report) => sum + (report.applied?.applied.length ?? 0),
        0,
      );
      const waiting = client.getSnapshot().pending.length;
      this.#status = `Simulated ${plural(reports.length, 'session')} as ${persona.name}: ${plural(
        applied,
        'change',
      )} applied, ${waiting} waiting.`;
      this.emit('uitive-simulated', { persona, reports });
      return reports;
    } finally {
      this.#busy = undefined;
      this.update(true);
    }
  }

  protected async act(action: string, argument: string | undefined, target: HTMLElement) {
    const client = this.client;
    if (!client) return;
    const run = async (label: string, work: () => Promise<string> | string) => {
      this.#busy = label;
      this.update(true);
      try {
        this.#status = await work();
      } catch (error) {
        this.#status = `Failed: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        this.#busy = undefined;
        this.update(true);
      }
    };
    switch (action) {
      case 'toggle':
        this.#open = !this.#open;
        this.update(true);
        return;
      case 'tab':
        if (argument !== undefined && argument in TABS) this.#tab = argument as Tab;
        this.update(true);
        return;
      case 'plan':
        await run('plan', async () => {
          const adaptation = await client.plan();
          const meta = adaptation.meta;
          return `Plan by ${meta?.planner ?? 'planner'}${
            meta?.fellBack ? ` (fell back: ${meta.fellBack})` : ''
          }: ${adaptation.pending} pending, ${adaptation.applied.length} suggested, ${
            adaptation.rejected.length
          } rejected.`;
        });
        return;
      case 'next':
      case 'apply':
        await run(action, () => {
          const adaptation = action === 'next' ? client.nextSession() : client.apply();
          const session = client.getSnapshot().session;
          return adaptation
            ? `Session ${session}: ${plural(adaptation.applied.length, 'change')} applied.`
            : `Session ${session}: nothing to apply.`;
        });
        return;
      case 'autonomy':
        client.setAutonomy((target as HTMLSelectElement).value as Autonomy);
        return;
      case 'reset':
        client.reset();
        this.#status = 'Back to the standard interface.';
        this.update(true);
        return;
      case 'clear':
        if (this.confirm('clear')) {
          client.clearData();
          this.#status = 'All data cleared.';
          this.update(true);
        }
        return;
      case 'simulate': {
        const persona = this.#personas[Number(argument)];
        if (persona) {
          await this.simulatePersona(persona).catch((error: unknown) => {
            this.#status = `Failed: ${error instanceof Error ? error.message : String(error)}`;
            this.update(true);
          });
        }
        return;
      }
    }
  }
}

/** Registers `<uitive-debug>`. Safe to call more than once, and a no-op without a DOM. */
export function defineDebugElement(): void {
  const registry = (globalThis as { customElements?: CustomElementRegistry }).customElements;
  if (registry && !registry.get('uitive-debug')) registry.define('uitive-debug', UitiveDebug);
}

declare global {
  interface HTMLElementTagNameMap {
    'uitive-debug': UitiveDebug;
  }
}
