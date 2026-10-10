import type { AnyPage } from './contract.js';
import {
  CHANGE_OPS,
  METRICS,
  USER_PAGES,
  type AppliedOperation,
  type Change,
  type Definition,
  type Evidence,
  type Operation,
  type Origin,
  type Status,
} from './definition.js';
import { toPage } from './page.js';
import { NOTE_LENGTH } from './policy.js';
import { VIAS, type SessionRecord, type UsageEvent } from './usage.js';

/** Longest goal a person may state: as long as a command. */
export const GOAL_LENGTH = 500;
/** Cooldowns and blocked keys a definition keeps at most. */
const MAX_KEYS = 1000;
const MAX_EVIDENCE = 20;
const ID_LENGTH = 200;
const KEY_LENGTH = 400;

const ORIGINS: readonly Origin[] = ['heuristic', 'model', 'user'];
const STATUSES: readonly Status[] = ['active', 'kept', 'reverted', 'suggested', 'dismissed'];

/** Whether a value is a plain object, as JSON parses one. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a value is a string of at most `max` characters. */
export const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

/** Whether a value is a whole number from zero up: a session, a count or a version. */
export const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const optional = <T>(value: unknown, keep: (value: unknown) => value is T) =>
  keep(value) ? value : undefined;

/** A person's goal as it may be kept: trimmed, at most `GOAL_LENGTH` long, and blank is none. */
export function cleanGoal(goal: unknown): string | undefined {
  if (typeof goal !== 'string') return undefined;
  const text = goal.trim().slice(0, GOAL_LENGTH).trim();
  return text === '' ? undefined : text;
}

/**
 * A change read from storage or a file, with only the fields its kind has, each of its type; or
 * nothing when it isn't one. `migrate` converts version 1 pages, kept as sections, to elements.
 */
export function reviveChange(raw: unknown, migrate = false): Change | undefined {
  if (
    !isRecord(raw) ||
    typeof raw.kind !== 'string' ||
    !Object.keys(CHANGE_OPS).includes(raw.kind)
  ) {
    return undefined;
  }
  const kind = raw.kind as Change['kind'];
  if (!isText(raw.surface, ID_LENGTH) || typeof raw.op !== 'string') return undefined;
  if (!CHANGE_OPS[kind].includes(raw.op)) return undefined;
  const surface = raw.surface;
  const context = optional(raw.context, (value) => isText(value, ID_LENGTH));
  const scoped = context === undefined ? {} : { context };
  if (raw.context !== undefined && context === undefined) return undefined;
  if (kind === 'list') {
    if (!isText(raw.target, ID_LENGTH)) return undefined;
    if (raw.index !== undefined && !isFinite(raw.index)) return undefined;
    return {
      kind,
      surface,
      ...scoped,
      op: raw.op as Extract<Change, { kind: 'list' }>['op'],
      target: raw.target,
      ...(raw.index === undefined ? {} : { index: raw.index as number }),
      ...(isText(raw.evict, ID_LENGTH) ? { evict: raw.evict } : {}),
    };
  }
  if (kind === 'choice') {
    return isText(raw.value, ID_LENGTH)
      ? { kind, surface, op: 'set', value: raw.value }
      : undefined;
  }
  if (kind === 'collection') {
    if (!isText(raw.item, ID_LENGTH)) return undefined;
    return {
      kind,
      surface,
      op: raw.op as Extract<Change, { kind: 'collection' }>['op'],
      item: raw.item,
      ...(raw.value === undefined ? {} : { value: raw.value }),
    };
  }
  if (kind === 'page') {
    let value: unknown = raw.value;
    if (migrate && value !== undefined) {
      try {
        value = toPage(value);
      } catch {
        return undefined;
      }
    }
    return {
      kind,
      surface,
      ...scoped,
      op: raw.op as 'set' | 'reset',
      ...(value === undefined ? {} : { value: value as AnyPage }),
    };
  }
  if (!isText(raw.slug, ID_LENGTH)) return undefined;
  if (raw.title !== undefined && typeof raw.title !== 'string') return undefined;
  return {
    kind: 'userPage',
    surface: USER_PAGES,
    op: raw.op as Extract<Change, { kind: 'userPage' }>['op'],
    slug: raw.slug,
    ...(raw.title === undefined ? {} : { title: raw.title as string }),
    ...(raw.value === undefined ? {} : { value: raw.value as AnyPage }),
  };
}

function reviveEvidence(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  const evidence: Evidence[] = [];
  for (const entry of raw.slice(0, MAX_EVIDENCE)) {
    if (!isRecord(entry)) continue;
    if (typeof entry.intent === 'string') {
      evidence.push({ intent: entry.intent.slice(0, GOAL_LENGTH) });
      continue;
    }
    const metric = METRICS.find((name) => name === entry.metric);
    if (isText(entry.action, ID_LENGTH) && metric !== undefined && isFinite(entry.value)) {
      evidence.push({
        action: entry.action,
        metric,
        value: entry.value,
        ...(isFinite(entry.window) ? { window: entry.window } : {}),
      });
    }
  }
  return evidence;
}

/**
 * An operation read from storage or a file, with only the fields an operation has, its layer
 * following from its origin; or nothing when it isn't one.
 */
export function reviveOperation(raw: unknown, migrate = false): Operation | undefined {
  if (!isRecord(raw) || !isText(raw.id, ID_LENGTH) || raw.id === '') return undefined;
  const change = reviveChange(raw.change, migrate);
  const origin = ORIGINS.find((entry) => entry === raw.origin);
  if (change === undefined || origin === undefined) return undefined;
  const based = isRecord(raw.basedOn) ? raw.basedOn : {};
  const note = isText(raw.note, NOTE_LENGTH) ? raw.note : undefined;
  return {
    id: raw.id,
    change,
    origin,
    layer: origin === 'user' ? 'user' : 'model',
    evidence: reviveEvidence(raw.evidence),
    ...(note === undefined ? {} : { note }),
    basedOn: {
      version: isCount(based.version) ? based.version : 0,
      summary: isText(based.summary, ID_LENGTH) ? based.summary : '',
      session: isCount(based.session) ? based.session : 0,
    },
  };
}

/** An applied operation read from storage or a file: an operation with its status and session. */
export function reviveApplied(raw: unknown, migrate = false): AppliedOperation | undefined {
  const operation = reviveOperation(raw, migrate);
  if (operation === undefined || !isRecord(raw)) return undefined;
  const status = STATUSES.find((entry) => entry === raw.status);
  if (status === undefined || !isCount(raw.session)) return undefined;
  return {
    ...operation,
    status,
    session: raw.session,
    adaptation: isText(raw.adaptation, ID_LENGTH) ? raw.adaptation : '',
  };
}

/** Keys of operations, such as cooldowns and blocks name: strings, each once, a bounded few. */
function reviveKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys = raw.filter((key): key is string => isText(key, KEY_LENGTH) && key !== '');
  return [...new Set(keys)].slice(-MAX_KEYS);
}

/**
 * A definition read from storage or a file: each field of its type, its goal trimmed and capped,
 * cooldowns within `cooldown` sessions of `session`, and only operations that are well formed.
 * Returns nothing when it isn't a definition at all; `malformed` counts the operations left out.
 */
export function reviveDefinition(
  raw: unknown,
  options: { session: number; cooldown: number },
): { definition: Definition; malformed: number } | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.operations)) return undefined;
  // Version 1 kept pages as sections of blocks; they convert to flat elements.
  const migrate = raw.schemaVersion === 1;
  const operations: AppliedOperation[] = [];
  let malformed = 0;
  for (const entry of raw.operations) {
    const operation = reviveApplied(entry, migrate);
    if (operation === undefined) malformed++;
    else operations.push(operation);
  }
  const until = new Map<string, number>();
  for (const entry of Array.isArray(raw.cooldowns) ? raw.cooldowns : []) {
    if (!isRecord(entry) || !isText(entry.key, KEY_LENGTH) || !isFinite(entry.until)) continue;
    // A cooldown from another device counts sessions there: it never outlasts one set here.
    const capped = Math.min(Math.floor(entry.until), options.session + options.cooldown);
    if (capped > options.session) until.set(entry.key, capped);
  }
  const goal = cleanGoal(raw.goal);
  return {
    definition: {
      schemaVersion: 2,
      contract: isText(raw.contract, ID_LENGTH) ? raw.contract : '',
      version: isCount(raw.version) ? raw.version : 0,
      operations,
      cooldowns: [...until].slice(-MAX_KEYS).map(([key, session]) => ({ key, until: session })),
      blocked: reviveKeys(raw.blocked),
      frozen: raw.frozen === true,
      ...(goal === undefined ? {} : { goal }),
    },
    malformed,
  };
}

/** Usage events read from storage: only well-formed ones, each with only an event's fields. */
export function reviveEvents(raw: unknown): UsageEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: UsageEvent[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !isText(entry.action, ID_LENGTH) || !isCount(entry.session)) continue;
    const via = VIAS.find((path) => path === entry.via);
    if (via === undefined) continue;
    const contexts = isRecord(entry.contexts)
      ? Object.fromEntries(
          Object.entries(entry.contexts).filter(
            (pair): pair is [string, string] => typeof pair[1] === 'string',
          ),
        )
      : undefined;
    events.push({
      action: entry.action,
      via,
      session: entry.session,
      ...(isText(entry.surface, ID_LENGTH) ? { surface: entry.surface } : {}),
      ...(isText(entry.element, ID_LENGTH) ? { element: entry.element } : {}),
      ...(contexts === undefined || Object.keys(contexts).length === 0 ? {} : { contexts }),
      ...(typeof entry.typed === 'boolean' ? { typed: entry.typed } : {}),
    });
  }
  return events;
}

/** Session records read from storage: only well-formed ones. */
export function reviveSessions(raw: unknown): SessionRecord[] {
  if (!Array.isArray(raw)) return [];
  const sessions: SessionRecord[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !isCount(entry.index) || !isFinite(entry.startedAt)) continue;
    const contexts: Record<string, string[]> = {};
    for (const [name, values] of Object.entries(isRecord(entry.contexts) ? entry.contexts : {})) {
      if (Array.isArray(values)) {
        contexts[name] = values.filter((value): value is string => typeof value === 'string');
      }
    }
    sessions.push({ index: entry.index, startedAt: entry.startedAt, contexts });
  }
  return sessions;
}
