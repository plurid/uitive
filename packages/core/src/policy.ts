import type { AnyContract, AnyPage, AnyPageSpec, CollectionSpec, ListSpec } from './contract.js';
import {
  EVERY,
  MAX_USER_PAGES,
  operationKey,
  redesigned,
  resolveUserPages,
  SLUG_PATTERN,
  USER_PAGES,
  resolveChoice,
  resolveCollection,
  resolveList,
  userDecides,
  type Change,
  type Definition,
  type Evidence,
  type ListChange,
  type Operation,
  type PageChange,
  type UserPageChange,
} from './definition.js';
import {
  longest,
  PageProblem,
  TEXT_LENGTH,
  TITLE_LENGTH,
  userPageSpec,
  validatePage,
} from './page.js';
import type { ProposedOperation } from './planner.js';
import type { UsageRow, UsageSummary } from './usage.js';

export { TEXT_LENGTH, TITLE_LENGTH } from './page.js';

/**
 * The rule an operation broke, named in its rejection: such as `required` for hiding a required
 * item, or `capacity` for a full list.
 */
export type Rule =
  | 'unknown'
  | 'kind'
  | 'required'
  | 'precedence'
  | 'frozen'
  | 'cooldown'
  | 'blocked'
  | 'evidence'
  | 'validator'
  | 'noop'
  | 'capacity';

/** An operation policy refused, the rule it broke, and why, in words people read. */
export interface Rejection {
  /** The operation refused. */
  operation: Operation;
  /** The rule it broke. */
  rule: Rule;
  /** Why, in words people read. */
  message: string;
}

/** What policy accepted, canonical, and what it refused, with reasons. */
export interface CheckResult {
  /** The operations that passed, in canonical form. */
  accepted: Operation[];
  /** The operations refused, with reasons. */
  rejected: Rejection[];
}

/**
 * What policy checks operations against: the contract, the person's definition, usage, the session
 * and any stated intent.
 */
export interface PolicyContext {
  /** The contract. */
  contract: AnyContract;
  /** The person's definition. */
  definition: Definition;
  /** Usage, as numbers. */
  summary: UsageSummary;
  /** The current session. */
  session: number;
  /** The user's own words behind this request: a command or their stated goal. */
  intent?: string;
}

/** Sessions an item must sit unused before usage alone justifies moving it to overflow. */
export const MIN_IDLE = 3;
/** Longest model note shown; notes with digits are dropped, since numbers come from the summary. */
export const NOTE_LENGTH = 140;

const MODEL_OPS: Record<Change['kind'], readonly string[]> = {
  list: ['promote', 'demote', 'move'],
  choice: ['set'],
  collection: ['add'],
  page: ['set', 'reset'],
  userPage: [],
};

class Violation extends Error {
  constructor(
    readonly rule: Rule,
    message: string,
  ) {
    super(message);
  }
}

const fail = (rule: Rule, message: string): never => {
  throw new Violation(rule, message);
};

/** Checks operations in order, each against the definition as if the earlier ones applied. */
export function check(operations: readonly Operation[], context: PolicyContext): CheckResult {
  const accepted: Operation[] = [];
  const rejected: Rejection[] = [];
  for (const operation of operations) {
    try {
      accepted.push(checkOne(operation, context));
    } catch (error) {
      if (!(error instanceof Violation)) throw error;
      rejected.push({ operation, rule: error.rule, message: error.message });
    }
  }
  return { accepted, rejected };
}

function checkOne(operation: Operation, context: PolicyContext): Operation {
  const { contract, definition } = context;
  const change = canonical(operation.change, contract);
  const planned = operation.origin !== 'user';

  if (planned) {
    if (!MODEL_OPS[change.kind].includes(change.op)) {
      fail(
        'kind',
        change.kind === 'userPage'
          ? `Only you can ${change.op} your pages`
          : `Only you can ${change.op} items`,
      );
    }
    if (definition.frozen) fail('frozen', 'Your interface is frozen');
    const key = operationKey(change);
    if (definition.blocked.includes(key)) fail('blocked', 'You reverted this change twice');
    const cooldown = definition.cooldowns.find((entry) => entry.key === key);
    if (cooldown && cooldown.until > context.session) {
      fail('cooldown', `You reverted this change; it can return after session ${cooldown.until}`);
    }
    const target =
      change.kind === 'list'
        ? change.target
        : change.kind === 'collection'
          ? change.item
          : undefined;
    const surfaceContext =
      change.kind === 'list' || change.kind === 'page' ? change.context : undefined;
    if (userDecides(definition, change.surface, surfaceContext, target)) {
      fail('precedence', 'You already decided this yourself');
    }
  }

  let checked: Change = change;
  if (change.kind === 'list') checkList(change, context);
  else if (change.kind === 'choice') checkChoice(change, context);
  else if (change.kind === 'collection') checkCollection(change, context);
  else if (change.kind === 'userPage') checked = checkUserPage(change, context);
  else checked = checkPage(change, context, planned);

  const evidence = planned
    ? supported(change, operation.evidence, context)
    : [...operation.evidence];
  const note = planned ? cleanNote(operation.note) : undefined;
  return {
    ...operation,
    change: checked,
    evidence,
    ...(note === undefined ? { note: undefined } : { note }),
  };
}

/** Resolves every ID in a change to the contract's canonical spelling. */
export function canonical(change: Change, contract: AnyContract): Change {
  if (change.kind === 'userPage') {
    const slug = change.slug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      fail('validator', 'Page addresses are short lowercase words joined by dashes');
    }
    return {
      ...change,
      surface: USER_PAGES,
      slug,
      ...(change.title === undefined ? {} : { title: change.title.trim() }),
    };
  }
  const surface =
    contract.surface(change.surface) ?? fail('unknown', `No surface "${change.surface}"`);
  const spec = contract.surfaces[surface];
  if (spec?.kind !== change.kind) fail('kind', `${surface} is not a ${change.kind}`);

  if (change.kind === 'list') {
    const list = spec as ListSpec;
    let context: string | undefined;
    if (list.context !== undefined) {
      if (change.context === undefined) fail('unknown', `${surface} needs a ${list.context}`);
      context =
        contract.contextValue(list.context, change.context as string) ??
        fail('unknown', `No ${list.context} "${change.context}"`);
    }
    const target =
      contract.action(change.target) ?? fail('unknown', `No action "${change.target}"`);
    if (!contract.items(surface, context).includes(target)) {
      fail('unknown', `${target} is not part of ${surface}`);
    }
    const result: ListChange = { kind: 'list', surface, op: change.op, target };
    if (context !== undefined) result.context = context;
    if (change.index !== undefined) result.index = change.index;
    if (change.evict !== undefined) result.evict = change.evict;
    return result;
  }
  if (change.kind === 'choice') {
    const values = (spec as { values: readonly string[] }).values;
    const value =
      values.find((entry) => entry.toLowerCase() === change.value.trim().toLowerCase()) ??
      fail('unknown', `${surface} has no value "${change.value}"`);
    return { ...change, surface, value };
  }
  if (change.kind === 'page') {
    const page = spec as AnyPageSpec;
    if (page.context === undefined) {
      const { context: _ignored, ...rest } = change;
      return { ...rest, surface };
    }
    if (change.context === undefined) fail('unknown', `${surface} needs a ${page.context} or *`);
    const context =
      change.context === EVERY
        ? EVERY
        : (contract.contextValue(page.context, change.context as string) ??
          fail('unknown', `No ${page.context} "${change.context}"`));
    return { ...change, surface, context };
  }
  return { ...change, surface };
}

function checkList(change: Extract<Change, { kind: 'list' }>, context: PolicyContext): void {
  const { contract, definition } = context;
  const spec = contract.surfaces[change.surface] as ListSpec;
  const state = resolveList(contract, definition, change.surface, change.context);
  const required = new Set(spec.required ?? []);
  const { target, op } = change;
  const visible = state.visible.has(target);

  if ((op === 'demote' || op === 'hide') && required.has(target)) {
    fail('required', `${label(contract, target)} is required by this application`);
  }
  if (op === 'move') {
    if (!spec.reorderable) fail('kind', `${spec.label} keeps its standard order`);
    if (!Number.isInteger(change.index) || (change.index ?? -1) < 0)
      fail('kind', 'Invalid position');
    if (!visible) fail('noop', `${label(contract, target)} is not visible`);
  }
  if (op === 'promote' && visible) fail('noop', `${label(contract, target)} is already visible`);
  if (op === 'demote' && !visible)
    fail('noop', `${label(contract, target)} is already in overflow`);
  if (op === 'pin' && state.pinned.has(target))
    fail('noop', `${label(contract, target)} is pinned`);
  if (op === 'hide' && state.hidden.has(target))
    fail('noop', `${label(contract, target)} is hidden`);
  if (op === 'restore' && !state.hidden.has(target) && (visible || !state.standard.has(target))) {
    fail('noop', `${label(contract, target)} is where it belongs`);
  }
  if (op === 'unpin' && !state.pinned.has(target)) {
    fail('noop', `${label(contract, target)} isn't pinned`);
  }
  if ((op === 'pin' || op === 'promote' || op === 'restore') && !visible) {
    const room =
      state.visible.size < spec.capacity ||
      [...state.visible].some((item) => !state.pinned.has(item) && !required.has(item));
    if (!room) fail('capacity', `${spec.label} is full of pinned and required items`);
  }
}

function checkChoice(change: Extract<Change, { kind: 'choice' }>, context: PolicyContext): void {
  if (resolveChoice(context.contract, context.definition, change.surface) === change.value) {
    fail('noop', `Already ${change.value}`);
  }
}

function checkCollection(
  change: Extract<Change, { kind: 'collection' }>,
  context: PolicyContext,
): void {
  const spec = context.contract.surfaces[change.surface] as CollectionSpec;
  const current = resolveCollection(context.contract, context.definition, change.surface);
  const exists = [...current.items, ...current.suggestions].some(
    (entry) => entry.id === change.item,
  );

  if (change.op === 'remove') {
    if (!exists) fail('noop', 'No such item');
    return;
  }
  if (change.op === 'add' && exists) fail('noop', 'Already suggested');
  if (change.op === 'update' && !exists) fail('noop', 'No such item');
  checkItem(spec, change.value);
}

/** An item against its collection's schema, title and text limits, and validator. */
function checkItem(spec: CollectionSpec, value: unknown): void {
  const parsed = spec.item.safeParse(value);
  if (!parsed.success) fail('validator', parsed.error.issues[0]?.message ?? 'Invalid item');
  const title = spec.title(parsed.data);
  if (title.trim().length === 0 || title.length > TITLE_LENGTH) {
    fail('validator', `Titles need 1 to ${TITLE_LENGTH} characters`);
  }
  if (longest(parsed.data) > TEXT_LENGTH) fail('validator', 'Text is too long');
  const problem = spec.validate?.(parsed.data);
  if (problem !== undefined) fail('validator', problem);
}

/** A proposed operation the static half of policy turned down, and why. */
export interface OutputRejection {
  /** The proposed operation refused. */
  operation: ProposedOperation;
  /** The rule it broke. */
  rule: Rule;
  /** Why, for the model to repair. */
  message: string;
}

/**
 * The half of policy that needs no user state: contract names, what planners may do, page and
 * query rules, and item schemas. The server runs it to give the model one chance to repair its
 * plan; the client still runs all of policy.
 */
export function validateOutput(
  contract: AnyContract,
  operations: readonly ProposedOperation[],
): { accepted: ProposedOperation[]; rejected: OutputRejection[] } {
  const accepted: ProposedOperation[] = [];
  const rejected: OutputRejection[] = [];
  for (const operation of operations) {
    try {
      const change = canonical(operation.change, contract);
      const planned = operation.scope !== 'explicit';
      if (planned && !MODEL_OPS[change.kind].includes(change.op)) {
        fail(
          'kind',
          change.kind === 'userPage'
            ? `Only the person can ${change.op} their pages`
            : `Only the person can ${change.op} items`,
        );
      }
      let checked: Change = change;
      if (change.kind === 'page' && change.op === 'set') {
        const spec = contract.surfaces[change.surface] as AnyPageSpec;
        checked = {
          ...change,
          value: checkPageValue(contract, spec, change.value, change.context, planned),
        };
      } else if (change.kind === 'userPage' && (change.op === 'create' || change.op === 'set')) {
        checked = { ...change, value: checkPageValue(contract, userPageSpec(), change.value) };
      } else if (change.kind === 'collection' && change.op !== 'remove') {
        checkItem(contract.surfaces[change.surface] as CollectionSpec, change.value);
      } else if (change.kind === 'list' && change.op === 'move') {
        if (!Number.isInteger(change.index) || (change.index ?? -1) < 0)
          fail('kind', 'Invalid position');
      }
      accepted.push({ ...operation, change: checked });
    } catch (error) {
      if (!(error instanceof Violation)) throw error;
      rejected.push({ operation, rule: error.rule, message: error.message });
    }
  }
  return { accepted, rejected };
}

/** Validates a page change and returns it with every element in canonical form. */
function checkPage(change: PageChange, context: PolicyContext, planned: boolean): PageChange {
  const spec = context.contract.surfaces[change.surface] as AnyPageSpec;
  if (change.op === 'reset') {
    if (!redesigned(context.definition, change.surface, change.context)) {
      fail('noop', `${spec.label} is already standard`);
    }
    return { kind: 'page', surface: change.surface, op: 'reset', ...contextOf(change) };
  }
  return {
    ...change,
    value: checkPageValue(context.contract, spec, change.value, change.context, planned),
  };
}

/** Checks a change to one of the user's own pages; returns it canonical. */
function checkUserPage(change: UserPageChange, context: PolicyContext): UserPageChange {
  const pages = resolveUserPages(context.definition);
  const existing = pages.find((entry) => entry.slug === change.slug);
  const base: UserPageChange = {
    kind: 'userPage',
    surface: USER_PAGES,
    op: change.op,
    slug: change.slug,
  };
  const title = () => {
    const text = change.title?.trim() ?? '';
    if (text.length === 0 || text.length > TITLE_LENGTH) {
      fail('validator', `Page titles need 1 to ${TITLE_LENGTH} characters`);
    }
    return text;
  };
  const value = () => checkPageValue(context.contract, userPageSpec(), change.value);
  if (change.op === 'create') {
    if (existing) fail('noop', `You already have a page at ${change.slug}`);
    if (pages.length >= MAX_USER_PAGES)
      fail('capacity', `You can keep up to ${MAX_USER_PAGES} pages`);
    return { ...base, title: title(), value: value() };
  }
  if (!existing) return fail('unknown', `You have no page at ${change.slug}`);
  if (change.op === 'rename') {
    const renamed = title();
    if (renamed === existing.title) fail('noop', `Already called ${renamed}`);
    return { ...base, title: renamed };
  }
  if (change.op === 'set') return { ...base, value: value() };
  return base;
}

const contextOf = (change: PageChange) =>
  change.context === undefined ? {} : { context: change.context };

/** Validates a whole page against its blocks, regions, limits and the application's rules. */
export function checkPageValue(
  contract: AnyContract,
  spec: AnyPageSpec,
  value: unknown,
  context?: string,
  planned = false,
): AnyPage {
  try {
    return validatePage(contract, spec, value, context, { planned });
  } catch (error) {
    if (error instanceof PageProblem) fail(error.rule, error.message);
    throw error;
  }
}

/**
 * Fills each piece of evidence from the local summary, so explanations can only state true
 * numbers, and requires that the evidence actually supports the change.
 */
function supported(
  change: Change,
  claimed: readonly Evidence[],
  context: PolicyContext,
): Evidence[] {
  const rows = context.summary.rows;
  const intent = context.intent ?? context.definition.goal;
  const evidence: Evidence[] = [];
  for (const entry of claimed) {
    if ('intent' in entry) {
      if (intent !== undefined) evidence.push({ intent });
      continue;
    }
    const action = context.contract.action(entry.action);
    const row = rows.find(
      (candidate) =>
        candidate.action === action &&
        (change.kind !== 'list' ||
          (candidate.surface === change.surface && candidate.context === change.context)),
    );
    if (row) {
      evidence.push({
        action: row.action,
        metric: entry.metric,
        value: row[entry.metric],
        window: context.summary.window,
      });
    }
  }
  if (evidence.length === 0) fail('evidence', 'No usage or stated goal supports this change');

  const byIntent = evidence.some((entry) => 'intent' in entry);
  const about = (target: string) =>
    evidence.filter((entry): entry is Extract<Evidence, { metric: string }> => {
      return 'metric' in entry && entry.action === target;
    });
  if (change.kind === 'list' && !byIntent) {
    const own = about(change.target);
    if (change.op === 'demote') {
      if (!own.some((entry) => entry.metric === 'idleSessions' && entry.value >= MIN_IDLE)) {
        fail('evidence', `Not unused for ${MIN_IDLE} sessions`);
      }
    } else if (!own.some((entry) => entry.metric !== 'idleSessions' && entry.value > 0)) {
      fail('evidence', 'No recent use supports this change');
    }
  }
  if (change.kind === 'choice' && !byIntent) {
    fail('evidence', 'Only a stated preference can change this');
  }
  return evidence;
}

function cleanNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined;
  const printable = [...note].map((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : char;
  });
  const text = printable.join('').replace(/\s+/g, ' ').trim();
  if (text.length === 0 || text.length > NOTE_LENGTH || /\d/.test(text)) return undefined;
  return text;
}

function label(contract: AnyContract, id: string): string {
  return contract.actions[id]?.label ?? id;
}

/** The usage row behind a list item, if the summary has one. */
export function rowFor(
  summary: UsageSummary,
  surface: string,
  context: string | undefined,
  action: string,
): UsageRow | undefined {
  return summary.rows.find(
    (row) => row.surface === surface && row.context === context && row.action === action,
  );
}
