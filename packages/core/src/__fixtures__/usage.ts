import type { AnyContract } from '../contract.js';
import {
  emptyDefinition,
  type Change,
  type Definition,
  type Evidence,
  type Operation,
} from '../definition.js';
import { summarise, type UsageEvent, type UsageSummary, type Via } from '../usage.js';
import { editor } from './editor.js';

export type Use = [action: string, via: Via, session: number, contexts?: Record<string, string>];

/** A summary of hand-written usage, as of `session`. */
export function summaryOf(
  uses: readonly Use[],
  options: { session?: number; definition?: Definition; contract?: AnyContract } = {},
): UsageSummary {
  const contract = options.contract ?? editor;
  const session = options.session ?? 5;
  const events: UsageEvent[] = uses.map(([action, via, at, contexts]) => ({
    action,
    via,
    session: at,
    ...(contexts === undefined ? {} : { contexts }),
  }));
  const sessions = Array.from({ length: session + 1 }, (_, index) => {
    const contexts: Record<string, string[]> = {};
    for (const event of events.filter((entry) => entry.session === index)) {
      for (const [name, value] of Object.entries(event.contexts ?? {})) {
        contexts[name] = [...new Set([...(contexts[name] ?? []), value])];
      }
    }
    return { index, startedAt: 0, contexts };
  });
  return summarise(
    contract,
    options.definition ?? emptyDefinition(contract),
    events,
    sessions,
    session,
  );
}

let counter = 0;

/** An operation as a planner or the user would produce it, before policy. */
export function operation(
  change: Change,
  options: { origin?: Operation['origin']; evidence?: Evidence[]; note?: string } = {},
): Operation {
  const origin = options.origin ?? 'model';
  const target = change.kind === 'list' ? change.target : '';
  return {
    id: `t${++counter}`,
    change,
    origin,
    layer: origin === 'user' ? 'user' : 'model',
    evidence:
      options.evidence ??
      (origin === 'user' ? [] : [{ action: target, metric: 'uses', value: 99 }]),
    ...(options.note === undefined ? {} : { note: options.note }),
    basedOn: { version: 0, summary: '', session: 5 },
  };
}

export const emptyEditor = () => emptyDefinition(editor);
