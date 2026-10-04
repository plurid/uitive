import type { AnyContract, ListSpec } from './contract.js';
import {
  isApplied,
  operationKey,
  resolveList,
  type AppliedOperation,
  type Change,
  type Definition,
  type Operation,
} from './definition.js';
import { check, MIN_IDLE, rowFor, type Rejection } from './policy.js';
import type { UsageSummary } from './usage.js';

/**
 * How cautiously planned changes apply, so the interface never moves while someone works and
 * settles rather than churns.
 */
export interface StabilizerOptions {
  /** Structural changes applied at one safe moment. @default 2 */
  budget: number;
  /** Sessions an item keeps its place after it moves. @default 3 */
  dwell: number;
  /** Sessions a reverted change waits before it may return. @default 5 */
  cooldown: number;
  /** Sessions a pending change stays valid. @default 5 */
  expiry: number;
  /** Strength at which a model change applies without waiting for a second plan. @default 1 */
  margin: number;
}

/**
 * The stabilizer's defaults: two changes per safe moment, three sessions of dwell, five of cooldown
 * and expiry.
 */
export const DEFAULT_STABILIZER: StabilizerOptions = {
  budget: 2,
  dwell: 3,
  cooldown: 5,
  expiry: 5,
  margin: 1,
};

/** A checked operation waiting for a safe moment. */
export interface Pending extends Operation {
  /** What it does, regardless of when or by whom, for cooldowns and repeats. */
  key: string;
  /** How strong its evidence is; past the margin, a model's change needs no second plan. */
  strength: number;
  /** Held until a second plan proposes it again, unless its strength clears the margin. */
  held: boolean;
}

const activity = (summary: UsageSummary, change: Change, action: string) =>
  change.kind === 'list'
    ? (rowFor(summary, change.surface, change.context, action)?.activity ?? 0)
    : 0;

/** How strongly the evidence supports an operation, compared against the margin. */
export function strength(
  operation: Operation,
  contract: AnyContract,
  definition: Definition,
  summary: UsageSummary,
  options: StabilizerOptions,
): number {
  if (operation.evidence.some((entry) => 'intent' in entry)) return options.margin;
  const change = operation.change;
  if (change.kind !== 'list') return options.margin;
  if (change.op === 'demote') {
    const row = rowFor(summary, change.surface, change.context, change.target);
    return (row?.idleSessions ?? 0) / MIN_IDLE;
  }
  const evict = evictFor(contract, definition, change, summary, operation.basedOn.session);
  return activity(summary, change, change.target) - (evict ? activity(summary, change, evict) : 0);
}

/**
 * Turns a plan's accepted operations into the pending set, tracking how many plans in a row
 * proposed each one: a model change waits for a second plan unless it is strong enough.
 */
export function stage(
  accepted: readonly Operation[],
  seen: Readonly<Record<string, number>>,
  strengths: readonly number[],
  options: StabilizerOptions & { hysteresis: boolean },
): { pending: Pending[]; seen: Record<string, number> } {
  const next: Record<string, number> = {};
  const pending = accepted.map((operation, index) => {
    const key = operationKey(operation.change);
    next[key] = (seen[key] ?? 0) + 1;
    const power = strengths[index] ?? 0;
    const held =
      options.hysteresis &&
      operation.origin === 'model' &&
      (next[key] ?? 0) < 2 &&
      power < options.margin;
    return { ...operation, key, strength: power, held };
  });
  return { pending, seen: next };
}

/**
 * The item a list change would push into overflow: the least used evictable visible one, then
 * the last in standard order. Items that moved since `protectSince` are spared while any other
 * candidate remains, so changes made together never undo each other.
 */
export function evictFor(
  contract: AnyContract,
  definition: Definition,
  change: Change,
  summary: UsageSummary,
  protectSince = Number.POSITIVE_INFINITY,
): string | undefined {
  if (change.kind !== 'list' || !['promote', 'pin', 'restore'].includes(change.op))
    return undefined;
  const spec = contract.surfaces[change.surface] as ListSpec;
  const state = resolveList(contract, definition, change.surface, change.context);
  if (state.visible.has(change.target) || state.visible.size < spec.capacity) return undefined;
  const required = new Set(spec.required ?? []);
  const order = contract.items(change.surface, change.context);
  const fresh = new Set(
    definition.operations
      .filter((operation) => {
        const other = operation.change;
        return (
          isApplied(operation) &&
          operation.session >= protectSince &&
          other.kind === 'list' &&
          other.surface === change.surface &&
          other.context === change.context
        );
      })
      .map((operation) => (operation.change as Extract<Change, { kind: 'list' }>).target),
  );
  const candidates = [...state.visible]
    .filter((item) => item !== change.target && !state.pinned.has(item) && !required.has(item))
    .sort(
      (a, b) =>
        Number(fresh.has(a)) - Number(fresh.has(b)) ||
        activity(summary, change, a) - activity(summary, change, b) ||
        order.indexOf(b) - order.indexOf(a),
    );
  return candidates[0];
}

/** Records an operation as applied, fixing which item made room for it. */
export function applyOperation(
  definition: Definition,
  operation: Operation,
  context: {
    contract: AnyContract;
    summary: UsageSummary;
    session: number;
    adaptation: string;
    /** @default DEFAULT_STABILIZER */
    options?: StabilizerOptions;
  },
  status: AppliedOperation['status'] = 'active',
): Definition {
  // Undoing a change, as "restore" after "hide" or "unpin" after "pin", reverts it: an opposite
  // change on top would let Revert bring back what the person had just undone.
  const undo = operation.change;
  if (undo.kind === 'list' && (undo.op === 'restore' || undo.op === 'unpin')) {
    const undone = definition.operations.filter(
      (entry) =>
        (entry.status === 'active' || entry.status === 'kept') &&
        entry.change.kind === 'list' &&
        entry.change.op === (undo.op === 'restore' ? 'hide' : 'pin') &&
        entry.change.surface === undo.surface &&
        entry.change.target === undo.target &&
        entry.change.context === undo.context,
    );
    if (undone.length > 0) {
      return undone.reduce(
        (next, entry) =>
          revert(next, entry.id, context.session, context.options ?? DEFAULT_STABILIZER),
        definition,
      );
    }
  }
  const evict = evictFor(
    context.contract,
    definition,
    operation.change,
    context.summary,
    context.session,
  );
  const change: Change =
    operation.change.kind === 'list'
      ? (() => {
          const { evict: _proposed, ...rest } = operation.change;
          return evict === undefined ? rest : { ...rest, evict };
        })()
      : operation.change;
  const { key: _key, strength: _strength, held: _held, ...plain } = operation as Pending;
  const applied: AppliedOperation = {
    ...plain,
    change,
    status,
    session: context.session,
    adaptation: context.adaptation,
  };
  // A later choice of the same setting replaces the earlier one: keeping both only fills the list
  // of changes with values nobody sees any more.
  const kept =
    change.kind === 'choice'
      ? definition.operations.filter(
          (entry) =>
            !(
              entry.layer === operation.layer &&
              (entry.status === 'active' || entry.status === 'kept') &&
              entry.change.kind === 'choice' &&
              entry.change.surface === change.surface
            ),
        )
      : definition.operations;
  return {
    ...definition,
    version: definition.version + 1,
    operations: [...kept, applied],
  };
}

export interface Settled {
  definition: Definition;
  applied: AppliedOperation[];
  /** Still pending: waiting for budget, dwell time or a second plan. */
  pending: Pending[];
  dropped: { operation: Pending; reason: string }[];
  rejected: Rejection[];
}

/**
 * Applies pending operations at a safe moment: drops expired ones, re-checks the rest against
 * the current definition, and applies the strongest within the budget and dwell rules.
 */
export function settle(
  input: {
    contract: AnyContract;
    definition: Definition;
    pending: readonly Pending[];
    summary: UsageSummary;
    session: number;
    adaptation: string;
  },
  options: StabilizerOptions,
): Settled {
  const { contract, summary, session, adaptation } = input;
  let definition = input.definition;
  const applied: AppliedOperation[] = [];
  const waiting: Pending[] = [];
  const dropped: Settled['dropped'] = [];
  const rejected: Rejection[] = [];
  let budget = options.budget;
  const demoted = new Set<string>();

  const ordered = [...input.pending].sort(
    (a, b) => b.strength - a.strength || a.key.localeCompare(b.key),
  );
  for (const operation of ordered) {
    if (session - operation.basedOn.session > options.expiry) {
      dropped.push({ operation, reason: 'expired' });
      continue;
    }
    if (definition.contract !== contract.hash) {
      dropped.push({ operation, reason: 'contract changed' });
      continue;
    }
    if (operation.held) {
      waiting.push(operation);
      continue;
    }
    const recheck = check([operation], { contract, definition, summary, session });
    if (recheck.rejected.length > 0) {
      rejected.push(...recheck.rejected);
      continue;
    }
    const change = operation.change;
    const structural = change.kind !== 'collection';
    const surfaceKey = `${change.surface}|${change.kind === 'list' ? (change.context ?? '') : ''}`;
    const isDemotion = change.kind === 'list' && change.op === 'demote';
    if (structural && (budget <= 0 || (isDemotion && demoted.has(surfaceKey)))) {
      waiting.push(operation);
      continue;
    }
    if (change.kind === 'list' && recentlyMoved(definition, change, session, options.dwell)) {
      waiting.push(operation);
      continue;
    }
    // Apply the re-checked operation: its evidence is restated from today's summary, so an
    // explanation never shows numbers from the session the plan was made in.
    definition = applyOperation(
      definition,
      recheck.accepted[0] ?? operation,
      { contract, summary, session, adaptation },
      change.kind === 'collection' ? 'suggested' : 'active',
    );
    applied.push(definition.operations[definition.operations.length - 1] as AppliedOperation);
    if (structural) budget--;
    if (isDemotion) demoted.add(surfaceKey);
  }
  return { definition, applied, pending: waiting, dropped, rejected };
}

/** Whether a list item moved within the last `dwell` sessions: moving it again would churn. */
function recentlyMoved(
  definition: Definition,
  change: Extract<Change, { kind: 'list' }>,
  session: number,
  dwell: number,
): boolean {
  return definition.operations.some((operation) => {
    const other = operation.change;
    if (!isApplied(operation) || other.kind !== 'list' || other.surface !== change.surface) {
      return false;
    }
    if (other.context !== change.context || session - operation.session >= dwell) return false;
    return other.target === change.target || other.evict === change.target;
  });
}

/**
 * Reverts an applied operation. A planned change then cools down; reverting the same change a
 * second time blocks it for good.
 */
export function revert(
  definition: Definition,
  id: string,
  session: number,
  options: StabilizerOptions,
): Definition {
  const target = definition.operations.find((operation) => operation.id === id);
  if (!target || !(isApplied(target) || target.status === 'suggested')) return definition;
  const operations = definition.operations.map((operation) =>
    operation.id === id ? { ...operation, status: 'reverted' as const } : operation,
  );
  let { cooldowns, blocked } = definition;
  if (target.origin !== 'user') {
    const key = operationKey(target.change);
    const before = definition.operations.some(
      (operation) =>
        operation.id !== id &&
        operation.status === 'reverted' &&
        operationKey(operation.change) === key,
    );
    cooldowns = cooldowns.filter((entry) => entry.key !== key);
    if (before) blocked = [...blocked, key];
    else cooldowns = [...cooldowns, { key, until: session + options.cooldown }];
  }
  return { ...definition, version: definition.version + 1, operations, cooldowns, blocked };
}

/** Sets an operation's status, for Keep, accepting a suggestion or dismissing one. */
export function setStatus(
  definition: Definition,
  id: string,
  status: AppliedOperation['status'],
  from: readonly AppliedOperation['status'][],
): Definition {
  const target = definition.operations.find((operation) => operation.id === id);
  if (!target || !from.includes(target.status)) return definition;
  return {
    ...definition,
    version: definition.version + 1,
    operations: definition.operations.map((operation) =>
      operation.id === id ? { ...operation, status } : operation,
    ),
  };
}
