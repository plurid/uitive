import type { AnyContract, ListSpec } from './contract.js';
import type { ListChange } from './definition.js';
import type {
  ClaimedEvidence,
  CommandStatus,
  Planner,
  PlanRequest,
  PlanResult,
  ProposedOperation,
} from './planner.js';
import type { UsageRow } from './usage.js';

/** A placement score worth about two recent uses: the least that earns a promotion. */
export const MIN_PROMOTE = 2;
/**
 * How much more an item must be used than the one it replaces: one recent use, plus a quarter
 * of the other's use, so two items used about equally never trade places on noise.
 */
export const MARGIN = 1;
const swapMargin = (weakest: UsageRow) => MARGIN + 0.25 * weakest.activity;
/** Promotions proposed per surface in one plan; the stabiliser applies fewer. */
const PER_SURFACE = 3;

/**
 * The deterministic planner: swaps rising overflow items with idle visible ones, under
 * capacity pressure and past a margin; understands keyword commands; and matches goals by
 * shared words: a deliberately naive stand-in that shows what a model adds.
 */
export function heuristicPlanner(): Planner {
  return {
    name: 'heuristic',
    async plan(request, contract) {
      const started = Date.now();
      const result =
        request.kind === 'command'
          ? command(request, contract)
          : { operations: swaps(request, contract) };
      return {
        origin: 'heuristic',
        ...result,
        meta: { planner: 'heuristic', ms: Date.now() - started },
      };
    },
  };
}

function swaps(request: PlanRequest, contract: AnyContract): ProposedOperation[] {
  const groups = new Map<string, UsageRow[]>();
  for (const row of request.summary.rows) {
    const key = `${row.surface}|${row.context ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const operations: ProposedOperation[] = [];
  for (const rows of groups.values()) {
    const first = rows[0] as UsageRow;
    const spec = contract.surfaces[first.surface] as ListSpec;
    const order = contract.items(first.surface, first.context);
    const required = new Set(spec.required ?? []);
    const visible = rows.filter((row) => row.place === 'visible');
    const candidates = rows
      .filter((row) => row.place === 'overflow' && row.placement >= MIN_PROMOTE)
      .sort((a, b) => b.placement - a.placement || a.action.localeCompare(b.action))
      .slice(0, PER_SURFACE);
    const evictable = visible
      .filter((row) => !row.pinned && !required.has(row.action))
      .sort((a, b) => a.activity - b.activity || order.indexOf(b.action) - order.indexOf(a.action));

    let room = spec.capacity - visible.length;
    for (const candidate of candidates) {
      const evidence: ClaimedEvidence[] = [
        { action: candidate.action, metric: 'activeSessions' },
        ...(candidate.viaOverflow > 0
          ? [{ action: candidate.action, metric: 'viaOverflow' } as const]
          : []),
      ];
      const change: ListChange = {
        kind: 'list',
        surface: first.surface,
        op: 'promote',
        target: candidate.action,
        ...(first.context === undefined ? {} : { context: first.context }),
      };
      if (room > 0) {
        room--;
        operations.push({ change, evidence });
        continue;
      }
      const weakest = evictable.shift();
      if (!weakest || candidate.activity - weakest.activity < swapMargin(weakest)) break;
      operations.push({
        change,
        evidence: [...evidence, { action: weakest.action, metric: 'idleSessions' }],
      });
    }
  }
  return operations;
}

/**
 * What the deterministic planner makes of a command: the operations, its status, and the candidates
 * when it was ambiguous.
 */
export type CommandResult = Pick<PlanResult, 'operations' | 'status' | 'candidates'>;

/** Commands that name an item. `show` pins it, or undoes the person's own hide of it. */
const LIST_COMMANDS: [RegExp, ListChange['op'] | 'show'][] = [
  [/^(?:please\s+)?(?:hide|remove|get rid of)\s+(.+)$/i, 'hide'],
  [/^(?:please\s+)?(?:show|bring back|unhide|add)\s+(.+)$/i, 'show'],
  [/^(?:please\s+)?pin\s+(.+)$/i, 'pin'],
  [/^(?:please\s+)?unpin\s+(.+)$/i, 'unpin'],
  [/^(?:please\s+)?restore\s+(.+)$/i, 'restore'],
];

/** "move Reporting to the top", "put Customers first", "move Print to the end". */
const MOVE =
  /^(?:please\s+)?(?:move|put)\s+(.+?)\s+(?:to\s+(?:the\s+)?)?(top|start|front|beginning|first|bottom|end|last)$/i;

const FILLER = /^(?:the|my|this|that)\s+|\s+(?:button|item|tool|action|option|please)$/gi;

/**
 * Keyword commands. Words are matched against items only for a stated goal; anything else
 * needs a model to understand, and guessing from shared words would only add noise.
 */
export function command(request: PlanRequest, contract: AnyContract): CommandResult {
  const keyword = keywordCommand(request, contract);
  if (keyword) return keyword;
  const text = (request.text ?? '').trim();
  if (request.goal !== undefined && text === request.goal) return goal(text, request, contract);
  return { operations: [], status: 'unsupported' };
}

/**
 * Commands that name what to change ("hide share", "pin export", "compact"), answered
 * locally and instantly. Returns nothing for anything else.
 */
export function keywordCommand(
  request: PlanRequest,
  contract: AnyContract,
): CommandResult | undefined {
  const text = (request.text ?? '').trim();
  if (/^(?:please\s+)?(?:reset|restore|undo)\s+(?:this|the|my)?\s*(?:page|layout)$/i.test(text)) {
    return resetPages(request);
  }
  const move = MOVE.exec(text);
  if (move) {
    const end = /^(?:bottom|end|last)$/i.test(move[2] ?? '');
    return named('move', (move[1] ?? '').replace(FILLER, '').trim(), request, contract, end);
  }
  for (const [pattern, op] of LIST_COMMANDS) {
    const match = pattern.exec(text);
    if (match) return named(op, (match[1] ?? '').replace(FILLER, '').trim(), request, contract);
  }
  return choose(text, contract);
}

/** Puts the pages in view back to standard: the current context's, else the context-free ones. */
function resetPages(request: PlanRequest): CommandResult {
  const operations: ProposedOperation[] = request.state.pages.map((entry) => ({
    change: {
      kind: 'page',
      surface: entry.surface,
      op: 'reset',
      ...(entry.context === undefined ? {} : { context: entry.context }),
    },
    evidence: [{ intent: true }],
    scope: 'explicit',
  }));
  const keyed = operations.filter((entry) => entry.change.kind === 'page' && entry.change.context);
  const chosen = keyed.length > 0 ? keyed : operations;
  return { operations: chosen, status: chosen.length > 0 ? 'done' : 'unsupported' };
}

interface Placement {
  surface: string;
  context?: string;
  action: string;
}

/** The list placements of the action a phrase names, preferring exact labels. */
function find(
  phrase: string,
  request: PlanRequest,
  contract: AnyContract,
): Placement[] | { candidates: string[] } {
  const wanted = phrase.toLowerCase();
  const tiers: Placement[][] = [[], [], []];
  for (const surface of contract.surfaceIds) {
    const spec = contract.surfaces[surface];
    if (spec?.kind !== 'list') continue;
    const context = spec.context === undefined ? undefined : request.contexts[spec.context];
    if (spec.context !== undefined && context === undefined) continue;
    for (const action of contract.items(surface, context)) {
      const label = (contract.actions[action]?.label ?? action).toLowerCase();
      const tier =
        label === wanted || action === wanted
          ? 0
          : label.startsWith(wanted) || wanted.startsWith(label)
            ? 1
            : label.includes(wanted)
              ? 2
              : -1;
      if (tier >= 0) {
        tiers[tier]?.push({ surface, action, ...(context === undefined ? {} : { context }) });
      }
    }
  }
  const best = tiers.find((tier) => tier.length > 0) ?? [];
  const actions = [...new Set(best.map((placement) => placement.action))];
  if (actions.length > 1) {
    return { candidates: actions.map((action) => contract.actions[action]?.label ?? action) };
  }
  return best;
}

function named(
  op: ListChange['op'] | 'show',
  phrase: string,
  request: PlanRequest,
  contract: AnyContract,
  toEnd = false,
): CommandResult {
  const found = find(phrase, request, contract);
  if ('candidates' in found) {
    return { operations: [], status: 'ambiguous', candidates: found.candidates };
  }
  if (found.length === 0) return { operations: [], status: 'unsupported' };
  return {
    operations: found.flatMap((placement) => {
      const change = (kind: ListChange['op'], index?: number): ProposedOperation => ({
        change: {
          kind: 'list',
          surface: placement.surface,
          op: kind,
          target: placement.action,
          ...(index === undefined ? {} : { index }),
          ...(placement.context === undefined ? {} : { context: placement.context }),
        },
        evidence: [{ intent: true }],
        scope: 'explicit',
      });
      const key = `${placement.surface}|${placement.context ?? ''}|hide|${placement.action}`;
      if (op === 'show') return [change(request.state.user.includes(key) ? 'restore' : 'pin')];
      if (op !== 'move') return [change(op)];
      // A position past the last item puts it last.
      const index = toEnd ? contract.items(placement.surface, placement.context).length : 0;
      const list = request.state.lists.find(
        (entry) => entry.surface === placement.surface && entry.context === placement.context,
      );
      const spec = contract.surfaces[placement.surface] as ListSpec;
      // Moving an item from overflow brings it into view first, as the person asked.
      const hidden = list !== undefined && !list.visible.includes(placement.action);
      return hidden && spec.reorderable
        ? [change('pin'), change('move', index)]
        : [change('move', index)];
    }),
    status: 'done',
  };
}

/** Words around a choice's value that change nothing: "use the dark theme", "set density to compact". */
const CHOICE_FILLER = new Set(
  'a an as be change colour color go in into it make mode my on please scheme set style switch the theme to turn use view layout'.split(
    ' ',
  ),
);

/**
 * A choice command: one of a choice's values, and otherwise only filler or the choice's own name.
 * Anything more ("dark mode for invoices") is left to a model.
 */
function choose(text: string, contract: AnyContract): CommandResult | undefined {
  const spoken = text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
  const joined = spoken.join('-');
  const found: { surface: string; value: string }[] = [];
  for (const surface of contract.surfaceIds) {
    const spec = contract.surfaces[surface];
    if (spec?.kind !== 'choice') continue;
    const own = new Set(
      `${surface} ${spec.label}`
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/),
    );
    for (const value of spec.values) {
      const parts = value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      if (!`-${joined}-`.includes(`-${parts.join('-')}-`)) continue;
      const rest = spoken.filter((word) => !parts.includes(word));
      if (rest.every((word) => CHOICE_FILLER.has(word) || own.has(word)))
        found.push({ surface, value });
    }
  }
  const surfaces = [...new Set(found.map((entry) => entry.surface))];
  if (surfaces.length === 0) return undefined;
  if (surfaces.length > 1) {
    return {
      operations: [],
      status: 'ambiguous',
      candidates: surfaces.map((surface) => contract.surfaces[surface]?.label ?? surface),
    };
  }
  // The longest value named wins, so "high-contrast" beats "contrast".
  const chosen = found.sort((a, b) => b.value.length - a.value.length)[0] as (typeof found)[number];
  return {
    operations: [
      {
        change: { kind: 'choice', surface: chosen.surface, op: 'set', value: chosen.value },
        evidence: [{ intent: true }],
        scope: 'explicit',
      },
    ],
    status: 'done',
  };
}

const STOP = new Set(
  'about also and are but can for from have into just like manage mostly need only our over some that the their them then they this use uses using want with work works your'.split(
    ' ',
  ),
);

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP.has(word))
      .map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)),
  );

/** Promotes the items whose words overlap the goal's: literal matches only. */
function goal(text: string, request: PlanRequest, contract: AnyContract): CommandResult {
  const wanted = words(text);
  const operations: ProposedOperation[] = [];
  for (const surface of contract.surfaceIds) {
    const spec = contract.surfaces[surface];
    if (spec?.kind !== 'list' || spec.context !== undefined) continue;
    const visible = new Set(
      request.state.lists.find((list) => list.surface === surface && list.context === undefined)
        ?.visible ?? [],
    );
    const scored = spec.items
      .map((action) => {
        const entry = contract.actions[action];
        const own = words(
          `${entry?.label ?? ''} ${entry?.description ?? ''} ${entry?.group ?? ''}`,
        );
        return { action, score: [...wanted].filter((word) => own.has(word)).length };
      })
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) => b.score - a.score || spec.items.indexOf(a.action) - spec.items.indexOf(b.action),
      )
      .slice(0, spec.capacity);
    for (const { action } of scored) {
      if (visible.has(action)) continue;
      operations.push({
        change: { kind: 'list', surface, op: 'promote', target: action },
        evidence: [{ intent: true }],
        scope: 'goal',
      });
    }
  }
  const status: CommandStatus = operations.length > 0 ? 'done' : 'unsupported';
  return { operations, status };
}
