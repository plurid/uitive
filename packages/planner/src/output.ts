import {
  USER_PAGES,
  type Change,
  type ClaimedEvidence,
  type Metric,
  type OutputRejection,
  type PlanRequest,
  type ProposedOperation,
} from '@plurid/uitive-core';

/**
 * What the model writes, in the schema `outputSchema` compiles: a status, candidates for ambiguous
 * requests, a note and flat operations. Policy checks it after `toOperations`.
 */
export interface PlannerOutput {
  /** Whether the model answered the request, found it ambiguous, or couldn't answer it. */
  status: 'done' | 'ambiguous' | 'unsupported';
  /** For an ambiguous request: what the words could mean. */
  candidates: string[];
  /** A short note for the person, shown with the changes. */
  note: string;
  /** Changes to lists, each with what it is based on. */
  lists?: {
    surface: string;
    context: string;
    op: 'promote' | 'demote' | 'move' | 'pin' | 'unpin' | 'hide' | 'restore';
    target: string;
    index: number;
    basis: 'request' | 'goal' | 'usage';
    metric: 'none' | Metric;
  }[];
  /** Values for choices, each with what it is based on. */
  choices?: { surface: string; value: string; basis: 'request' | 'goal' | 'usage' }[];
  /** Pages to redesign, reset, or, for the person's own pages, create, rename or delete. */
  pages?: {
    surface: string;
    context: string;
    op: 'set' | 'reset' | 'create' | 'rename' | 'delete';
    slug?: string;
    title?: string;
    root: string;
    elements: { id: string; block: string; props: unknown; children: string[] }[];
    data?: { name: string; query: unknown }[];
    basis: 'request' | 'goal' | 'usage';
  }[];
}

const scopeOf = (basis: string, kind: PlanRequest['kind']): Pick<ProposedOperation, 'scope'> => {
  if (basis === 'goal') return { scope: 'goal' };
  // Nobody asked for anything in an unprompted plan, whatever basis the model claims.
  return basis === 'request' && kind === 'command' ? { scope: 'explicit' } : {};
};

const contextOf = (value: string) => (value === 'none' ? {} : { context: value });

/**
 * Turns the model's flat output into proposed operations for policy to check. Only a command's
 * operations can be explicit: in a plan (`kind: 'plan'`), basis `request` counts for nothing.
 */
export function toOperations(
  output: PlannerOutput,
  kind: PlanRequest['kind'] = 'command',
): ProposedOperation[] {
  const note = output.note.trim() || undefined;
  const operations: ProposedOperation[] = [];
  for (const entry of output.lists ?? []) {
    const evidence: ClaimedEvidence[] =
      entry.basis === 'usage' && entry.metric !== 'none'
        ? [{ action: entry.target, metric: entry.metric }]
        : [{ intent: true }];
    operations.push({
      change: {
        kind: 'list',
        surface: entry.surface,
        op: entry.op,
        target: entry.target,
        ...contextOf(entry.context),
        ...(entry.op === 'move' && entry.index >= 0 ? { index: entry.index } : {}),
      },
      evidence,
      ...scopeOf(entry.basis, kind),
    });
  }
  for (const entry of output.choices ?? []) {
    operations.push({
      change: { kind: 'choice', surface: entry.surface, op: 'set', value: entry.value },
      evidence: [{ intent: true }],
      ...scopeOf(entry.basis, kind),
    });
  }
  for (const entry of output.pages ?? []) {
    const value = { root: entry.root, elements: entry.elements, data: (entry.data ?? []) as never };
    if (entry.surface === USER_PAGES) {
      if (entry.op === 'reset' || !entry.slug) continue;
      operations.push({
        change: {
          kind: 'userPage',
          surface: USER_PAGES,
          op: entry.op,
          slug: entry.slug,
          ...(entry.op === 'create' || entry.op === 'rename' ? { title: entry.title ?? '' } : {}),
          ...(entry.op === 'create' || entry.op === 'set' ? { value } : {}),
        },
        evidence: [{ intent: true }],
        ...scopeOf(entry.basis, kind),
      });
      continue;
    }
    if (entry.op !== 'set' && entry.op !== 'reset') continue;
    operations.push({
      change: {
        kind: 'page',
        surface: entry.surface,
        op: entry.op,
        ...contextOf(entry.context),
        ...(entry.op === 'set' ? { value } : {}),
      },
      evidence: [{ intent: true }],
      ...scopeOf(entry.basis, kind),
    });
  }
  if (note !== undefined && operations[0]) operations[0] = { ...operations[0], note };
  return operations;
}

/** What policy rejected, for the model to repair. */
export function repairText(rejected: readonly OutputRejection[]): string {
  return [
    'The application rejected part of that plan:',
    ...rejected.map((entry) => `- ${changeText(entry.operation.change)}: ${entry.message}`),
    'Return the whole plan again, with these parts fixed or left out.',
  ].join('\n');
}

function changeText(change: Change): string {
  if (change.kind === 'list') return `${change.op} ${change.target} on ${change.surface}`;
  if (change.kind === 'choice') return `${change.surface} set to ${change.value}`;
  if (change.kind === 'page')
    return `page ${change.surface}${change.context ? ` (${change.context})` : ''}`;
  if (change.kind === 'userPage') return `their page ${change.slug}`;
  return `${change.op} in ${change.surface}`;
}
