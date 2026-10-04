import type { AnyContract, ListSpec } from './contract.js';
import { isApplied, resolveList, type Definition } from './definition.js';
import { hash } from './hash.js';

/** The path a user took to an action. */
export type Via = 'region' | 'overflow' | 'suggested' | 'palette' | 'shortcut' | 'command';

/** Every way an action may be reached. */
export const VIAS: readonly Via[] = [
  'region',
  'overflow',
  'suggested',
  'palette',
  'shortcut',
  'command',
];

/** One activation. Never text typed into the application, never page content. */
export interface UsageEvent {
  /** The action used. */
  action: string;
  /** How it was reached. */
  via: Via;
  /** The session it happened in. */
  session: number;
  /** The surface it was reached on, when known. */
  surface?: string;
  /** The page element it came from, for actions run from generated pages. */
  element?: string;
  /** Context values active when it happened, by context name. */
  contexts?: Record<string, string>;
  /** For palette picks: whether the user typed a search first. */
  typed?: boolean;
}

/** One session: when it started, and the context values it saw. */
export interface SessionRecord {
  /** The session's number, counted from the first. */
  index: number;
  /** When it started, in milliseconds. */
  startedAt: number;
  /** Context values active during the session, by context name. */
  contexts: Record<string, string[]>;
}

/** Each session back weighs this much less. */
export const DECAY = 0.85;
/** Sessions the summary looks back over, including the current one. */
export const WINDOW = 10;

/**
 * How strongly a path signals that an action belongs on a surface. Digging an item out of
 * overflow is the strongest sign; using a suggestion says nothing about placement, or
 * suggestions would lock themselves in; shortcut and command users don't need the button.
 */
function placementWeight(event: UsageEvent): number {
  switch (event.via) {
    case 'region':
      return 1;
    case 'overflow':
      return 1.5;
    case 'palette':
      return event.typed ? 1 : 0.3;
    default:
      return 0;
  }
}

/** How strongly a path signals that an action should rank high in a palette. */
function rankingWeight(event: UsageEvent): number {
  if (event.via === 'suggested') return 0.5;
  if (event.via === 'palette' && !event.typed) return 0.5;
  return 1;
}

/**
 * One action's usage on one surface, as planners see it: uses, sessions, and how it was reached.
 */
export interface UsageRow {
  /** The surface. */
  surface: string;
  /** The context value, for surfaces keyed by context. */
  context?: string;
  /** The action. */
  action: string;
  /** Where it is now. */
  place: 'visible' | 'overflow';
  /** Whether the person pinned it. */
  pinned: boolean;
  /** Uses within the window. */
  uses: number;
  /** Sessions within the window with at least one use. */
  activeSessions: number;
  /** Uses reached from overflow, within the window. */
  viaOverflow: number;
  /** Uses reached by searching, within the window. */
  viaPalette: number;
  /** Uses reached through a suggestion, within the window. */
  viaSuggested: number;
  /** Consecutive recent sessions it was visible and unused, while its surface was in use. */
  idleSessions: number;
  /** Decayed placement score, with overflow use weighing most: decides who deserves a place. */
  placement: number;
  /**
   * Decayed use with every path weighing the same: compares items for a swap. Comparing
   * placement instead would oscillate: an item used from overflow always outscores its equal.
   */
  activity: number;
  /** Decayed ranking score, rounded to hundredths. */
  ranking: number;
}

/** The deterministic statistics a planner sees: the only usage that leaves the device. */
export interface UsageSummary {
  /** The current session. */
  session: number;
  /** Sessions the window covers. */
  window: number;
  /** One row per action and surface. */
  rows: readonly UsageRow[];
  /** Changes when the leading items of any surface change. */
  hash: string;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Whether an event belongs to a list (and context value) for placement purposes. */
function belongs(event: UsageEvent, spec: ListSpec, context: string | undefined): boolean {
  if (spec.context === undefined || context === undefined) return true;
  return event.contexts?.[spec.context] === context;
}

/** Sessions in which a surface was in use: any activity, or its context value was active. */
function activeSessions(
  sessions: readonly SessionRecord[],
  events: readonly UsageEvent[],
  spec: ListSpec,
  context: string | undefined,
): number[] {
  if (spec.context === undefined || context === undefined) {
    return [...new Set(events.map((event) => event.session))].sort((a, b) => a - b);
  }
  const name = spec.context;
  return sessions
    .filter((session) => session.contexts[name]?.includes(context))
    .map((session) => session.index);
}

/** The session an item last became visible through an operation, or 0 for the standard layout. */
function visibleSince(
  definition: Definition,
  surface: string,
  context: string | undefined,
  item: string,
) {
  let since = 0;
  for (const operation of definition.operations) {
    const change = operation.change;
    if (
      isApplied(operation) &&
      change.kind === 'list' &&
      change.surface === surface &&
      change.context === context &&
      change.target === item &&
      ['promote', 'pin', 'restore'].includes(change.op)
    ) {
      since = Math.max(since, operation.session);
    }
  }
  return since;
}

/**
 * Summarizes usage per action and surface over recent sessions, with older sessions weighing less.
 */
export function summarize(
  contract: AnyContract,
  definition: Definition,
  events: readonly UsageEvent[],
  sessions: readonly SessionRecord[],
  session: number,
): UsageSummary {
  const start = session - WINDOW + 1;
  const rows: UsageRow[] = [];
  const leaders: string[] = [];

  for (const surface of [...contract.surfaceIds].sort()) {
    const spec = contract.surfaces[surface];
    if (spec?.kind !== 'list') continue;
    const values =
      spec.context === undefined
        ? [undefined]
        : [
            ...new Set(
              sessions
                .filter((record) => record.index >= start)
                .flatMap((record) => record.contexts[spec.context as string] ?? []),
            ),
          ].sort();

    for (const context of values) {
      const state = resolveList(contract, definition, surface, context);
      const own = events.filter((event) => belongs(event, spec, context));
      const active = activeSessions(sessions, own, spec, context).filter(
        (index) => index < session,
      );
      const scored: UsageRow[] = [];
      for (const action of contract.items(surface, context)) {
        const mine = own.filter((event) => event.action === action);
        const recent = mine.filter((event) => event.session >= start);
        const visible = state.visible.has(action);
        if (!visible && recent.length === 0) continue;

        let idleSessions = 0;
        if (visible) {
          const since = visibleSince(definition, surface, context, action);
          const used = new Set(mine.map((event) => event.session));
          for (let index = active.length - 1; index >= 0; index--) {
            const past = active[index] as number;
            if (past < since || used.has(past)) break;
            idleSessions++;
          }
        }
        const decay = (event: UsageEvent) => DECAY ** Math.max(0, session - event.session);
        scored.push({
          surface,
          ...(context === undefined ? {} : { context }),
          action,
          place: visible ? 'visible' : 'overflow',
          pinned: state.pinned.has(action),
          uses: recent.length,
          activeSessions: new Set(recent.map((event) => event.session)).size,
          viaOverflow: recent.filter((event) => event.via === 'overflow').length,
          viaPalette: recent.filter((event) => event.via === 'palette').length,
          viaSuggested: recent.filter((event) => event.via === 'suggested').length,
          idleSessions,
          placement: round(
            mine.reduce((sum, event) => sum + placementWeight(event) * decay(event), 0),
          ),
          activity: round(
            mine.reduce((sum, event) => sum + (placementWeight(event) > 0 ? decay(event) : 0), 0),
          ),
          ranking: round(mine.reduce((sum, event) => sum + rankingWeight(event) * decay(event), 0)),
        });
      }
      rows.push(...scored);
      const top = [...scored]
        .sort((a, b) => b.placement - a.placement || a.action.localeCompare(b.action))
        .slice(0, spec.capacity)
        .map((row) => row.action)
        .sort();
      leaders.push(`${surface}|${context ?? ''}|${top.join(',')}`);
    }
  }

  return {
    session,
    window: Math.min(WINDOW, session + 1),
    rows,
    hash: hash(leaders),
  };
}

/** Every action ranked for a palette: decayed ranking score, then contract order. */
export function rank(
  contract: AnyContract,
  events: readonly UsageEvent[],
  session: number,
): string[] {
  const score = new Map<string, number>();
  for (const event of events) {
    const weight = rankingWeight(event) * DECAY ** Math.max(0, session - event.session);
    score.set(event.action, (score.get(event.action) ?? 0) + weight);
  }
  const order = new Map(contract.actionIds.map((id, index) => [id, index]));
  return [...contract.actionIds].sort(
    (a, b) =>
      (score.get(b) ?? 0) - (score.get(a) ?? 0) || (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
}
