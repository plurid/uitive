import type { Adaptation, Uitive, RecordOptions } from './client.js';
import type { AnyContract, ListValue } from './contract.js';

/** A seeded pseudo-random generator (mulberry32), so a simulation repeats exactly. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A simulated user: how often they use each action, and how they reach it. */
export interface Persona {
  /** Its name, as reports show it. */
  name: string;
  /** Who it stands for. */
  description: string;
  /** Relative frequencies of the actions this persona uses. */
  weights: Readonly<Record<string, number>>;
  /** Actions per session, inclusive. @default [12, 24] */
  actions?: readonly [number, number];
  /** Context values active for an action, such as the service a verb happens on. */
  contexts?: (action: string, draw: () => number) => Record<string, string> | undefined;
  /** From this session on, these weights apply instead: a change of behavior. */
  shift?: { session: number; weights: Readonly<Record<string, number>> };
  /** How often an overflow item is reached through the palette rather than overflow. @default 0.3 */
  palette?: number;
}

/** One simulated session: what each list showed at its start, and what changed then and after. */
export interface SessionReport {
  /** The session's number. */
  session: number;
  /** Visible items of each list at the session's start, keyed `surface` or `surface|context`. */
  visible: Record<string, readonly string[]>;
  /** The adaptation applied at the session's start, if any. */
  applied?: Adaptation;
  /** The plan made at the session's end, if any. */
  planned?: Adaptation;
}

function pick(weights: Readonly<Record<string, number>>, draw: number): string {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let threshold = draw * total;
  for (const [action, weight] of entries) {
    threshold -= weight;
    if (threshold < 0) return action;
  }
  return entries[entries.length - 1]?.[0] ?? '';
}

/** The visible items of every list, for reports and assertions. */
export function visibleLists<C extends AnyContract>(
  client: Uitive<C>,
): Record<string, readonly string[]> {
  const contract: AnyContract = client.contract;
  const surface = client.surface as (id: string, context?: string) => unknown;
  const visible: Record<string, readonly string[]> = {};
  for (const id of contract.surfaceIds) {
    const spec = contract.surfaces[id];
    if (spec?.kind !== 'list') continue;
    const values =
      spec.context === undefined ? [undefined] : (contract.contexts[spec.context] ?? []);
    for (const context of values) {
      const list = surface(id, context) as ListValue;
      visible[context === undefined ? id : `${id}|${context}`] = list.visible.map(
        (view) => view.id,
      );
    }
  }
  return visible;
}

/**
 * Drives a client through sessions as a persona would: each session starts (applying pending
 * changes at the safe moment), the persona works, and a plan is made at the end.
 */
export async function simulate<C extends AnyContract>(
  client: Uitive<C>,
  persona: Persona,
  options: { sessions: number; seed: number; plan?: boolean },
): Promise<SessionReport[]> {
  const draw = random(options.seed);
  const contract: AnyContract = client.contract;
  const surface = client.surface as (id: string, context?: string) => unknown;
  const record = client.record as (action: string, options?: RecordOptions) => void;
  const setContext = client.setContext as (name: string, value: string | undefined) => void;
  const [fewest, most] = persona.actions ?? [12, 24];
  const reports: SessionReport[] = [];

  for (let index = 0; index < options.sessions; index++) {
    const applied = client.nextSession();
    const visible = visibleLists(client);
    const session = client.getSnapshot().session;
    const weights =
      persona.shift && index >= persona.shift.session ? persona.shift.weights : persona.weights;
    const count = fewest + Math.floor(draw() * (most - fewest + 1));

    for (let step = 0; step < count; step++) {
      const action = pick(weights, draw());
      for (const [name, value] of Object.entries(persona.contexts?.(action, draw) ?? {})) {
        setContext(name, value);
      }
      let shown: boolean | undefined;
      for (const id of contract.surfaceIds) {
        const spec = contract.surfaces[id];
        if (spec?.kind !== 'list') continue;
        const list = surface(id) as ListValue;
        if (list.visible.some((view) => view.id === action)) shown = true;
        else if (list.overflow.some((view) => view.id === action)) shown ??= false;
      }
      const palette = draw() < (persona.palette ?? 0.3);
      record(action, {
        via: shown === false ? (palette ? 'palette' : 'overflow') : 'region',
        ...(shown === false && palette ? { typed: true } : {}),
      });
    }

    const planned = options.plan === false ? undefined : await client.plan();
    reports.push({
      session,
      visible,
      ...(applied === undefined ? {} : { applied }),
      ...(planned === undefined ? {} : { planned }),
    });
  }
  return reports;
}
