import type { AnyContract, CollectionSpec } from './contract.js';
import type { Evidence, Operation } from './definition.js';

/** What a person reads about an operation: what changed and why, with true numbers only. */
export interface Explanation {
  /** What changed, such as "Table added to Toolbar". */
  title: string;
  /** Why, with the evidence's true numbers. */
  reason: string;
  /** A short note from the model, if it wrote one. */
  note?: string;
}

const quote = (text: string) => `“${text.length > 80 ? `${text.slice(0, 79)}…` : text}”`;

const times = (count: number) => (count === 1 ? 'once' : `${count} times`);
const sessions = (count: number) => (count === 1 ? 'session' : `${count} sessions`);

function cite(evidence: Extract<Evidence, { metric: string }>, label: string): string {
  const window = evidence.window ?? 10;
  switch (evidence.metric) {
    case 'uses':
      return `${label} was used ${times(evidence.value)} in your last ${sessions(window)}`;
    case 'activeSessions':
      return `${label} was used in ${evidence.value} of your last ${sessions(window)}`;
    case 'viaOverflow':
      return `you opened ${label} from overflow ${times(evidence.value)}`;
    case 'viaPalette':
      return `you searched for ${label} ${times(evidence.value)}`;
    case 'idleSessions':
      return `${label} went unused for ${evidence.value === 1 ? 'a session' : sessions(evidence.value)}`;
  }
}

const sentence = (parts: string[]) => {
  const text = parts.join('; ');
  return text.length === 0 ? '' : `${text[0]?.toUpperCase()}${text.slice(1)}.`;
};

/**
 * Explains an operation in plain words: what changed and where, who proposed it, and on what
 * evidence.
 */
export function describe(operation: Operation, contract: AnyContract): Explanation {
  const change = operation.change;
  const surface = contract.surfaces[change.surface];
  const where = surface?.label ?? change.surface;
  const name = (id: string) => contract.actions[id]?.label ?? id;

  let title: string;
  if (change.kind === 'list') {
    const target = name(change.target);
    // Context values are often actions themselves, such as a service: show their label.
    const context = change.context === undefined ? undefined : name(change.context);
    const scope = context === undefined ? where : `${where} (${context})`;
    title = {
      promote: `${target} added to ${scope}`,
      demote: `${target} moved to overflow in ${scope}`,
      move: `${target} moved to position ${(change.index ?? 0) + 1} in ${scope}`,
      pin: `${target} pinned to ${scope}`,
      unpin: `${target} unpinned from ${scope}`,
      hide: `${target} hidden from ${scope}`,
      restore: `${target} restored to ${scope}`,
    }[change.op];
  } else if (change.kind === 'choice') {
    title = `${where} set to ${change.value}`;
  } else if (change.kind === 'page') {
    const scope =
      change.context === undefined
        ? where
        : change.context === '*'
          ? `${where}, everywhere`
          : `${where} for ${name(change.context)}`;
    title = change.op === 'set' ? `${scope} redesigned` : `${scope} back to standard`;
  } else if (change.kind === 'userPage') {
    const named = change.title ?? change.slug;
    title = {
      create: `Your page ${named} made`,
      rename: `Your page ${change.slug} renamed to ${named}`,
      set: `Your page ${change.slug} redesigned`,
      delete: `Your page ${change.slug} deleted`,
    }[change.op];
  } else {
    const spec = surface as CollectionSpec | undefined;
    const item =
      change.value === undefined ? change.item : (spec?.title(change.value) ?? change.item);
    title = {
      add: `New in ${where}: ${item}`,
      update: `${item} updated in ${where}`,
      remove: `${item} removed from ${where}`,
    }[change.op];
  }

  const parts: string[] = [];
  if (operation.origin === 'user') {
    const said = operation.evidence.find((entry) => 'intent' in entry);
    parts.push(said && 'intent' in said ? `you asked: ${quote(said.intent)}` : 'you did this');
  } else {
    for (const entry of operation.evidence) {
      if ('intent' in entry) {
        parts.push(`it fits what you said: ${quote(entry.intent)}`);
      } else if (change.kind === 'list' && entry.action === change.evict) {
        parts.push(
          `${name(entry.action)} moved to overflow to make room, since ${cite(entry, 'it')}`,
        );
      } else {
        parts.push(cite(entry, name(entry.action)));
      }
    }
    if (
      change.kind === 'list' &&
      change.evict !== undefined &&
      !operation.evidence.some((entry) => 'action' in entry && entry.action === change.evict)
    ) {
      parts.push(`${name(change.evict)} moved to overflow to make room`);
    }
  }

  return {
    title,
    reason: sentence(parts),
    ...(operation.note === undefined ? {} : { note: operation.note }),
  };
}
