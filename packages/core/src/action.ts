import type { z } from 'zod';
import type { ActionIdOf, AnyContract } from './contract.js';
import type { BindingContext, Fetchers } from './data.js';
import type { Field } from './field.js';
import type { Via } from './usage.js';

/** Every effect an action may declare, from least to most serious. */
export const EFFECTS = ['read', 'write', 'destructive'] as const;
/**
 * What running an action does: `read` changes nothing, `write` changes data, `destructive`
 * can't be undone. Actions without an effect belong to the interface only, as links and tools do.
 */
export type Effect = (typeof EFFECTS)[number];

/** Where an action leads: a URL, or one of the contract's routes. */
export type Target =
  { href: string } | { route: string; params?: Readonly<Record<string, string>> };

/**
 * What a `perform` binding learns about a run, besides its params: who and where, which action, and
 * a key for doing it once.
 */
export interface PerformContext extends BindingContext {
  /** The action being run. */
  action: string;
  /** Unique to one confirmed run, so a binding can refuse to do it twice. */
  idempotencyKey: string;
}

/** What a `perform` binding may answer: a message for the person, and where to go next. */
export type PerformOutcome = { message?: string; navigate?: Target } | void;

/**
 * The application's code that runs an action: its params in, an outcome out. It runs with the
 * person's own permissions.
 */
export type Perform<P = unknown> = (
  params: P,
  context: PerformContext,
) => Promise<PerformOutcome> | PerformOutcome;

/** What an action's `params` schema declares, inferred: an empty record when it declares none. */
export type DeclaredParams<C extends AnyContract, A extends ActionIdOf<C>> =
  NonNullable<C['actions'][A]['params']> extends infer P
    ? P extends z.ZodType
      ? z.infer<P>
      : Record<string, never>
    : never;

/**
 * What an action takes, from its `params` schema: nothing when it declares none. For contracts
 * typed loosely, as generic renderers see them, any record.
 */
export type ParamsOf<C extends AnyContract, A extends ActionIdOf<C>> =
  string extends ActionIdOf<C>
    ? Readonly<Record<string, unknown>>
    : string extends keyof DeclaredParams<C, A>
      ? Record<string, never>
      : DeclaredParams<C, A>;

/** One performer for every action, or one per action. */
export type Performers<C extends AnyContract = AnyContract> =
  Perform | { [A in ActionIdOf<C>]?: Perform<ParamsOf<C, A>> };

/** The application's code behind a contract. */
export interface Bindings<C extends AnyContract = AnyContract> {
  /** Reads sources with the user's own permissions. */
  fetch?: Fetchers<C>;
  /** Runs actions. Every confirmed run is recorded as usage, without its params. */
  perform?: Performers<C>;
  /** Who and where the user is: `me`, time zone and locale. */
  context?(): BindingContext;
  /** Follows a link inside the application, such as through its router. */
  navigate?(href: string): void;
}

/** A run waiting for the user's yes. */
export interface Confirmation {
  /** The run's ID, for `confirm` and `cancel`. */
  id: string;
  /** The action's ID. */
  action: string;
  /** The action's label. */
  label: string;
  /** What the action does. */
  description: string;
  /** A `write` waits for one yes; a `destructive` run for a typed phrase. */
  effect: 'write' | 'destructive';
  /** What the run will use, shown before the person says yes. */
  params: Readonly<Record<string, unknown>>;
  /** The params' fields, for showing what will happen. */
  fields: readonly Field[];
  /** For destructive actions: what the user must type. */
  phrase?: string;
}

/**
 * How a run came about, for `perform`: where it was started, by what, and whether the person
 * already said yes.
 */
export interface PerformOptions {
  /** How the person reached the action. @default 'region' */
  via?: Via;
  /** The surface the action was run from. */
  surface?: string;
  /** The page element it was run from. */
  element?: string;
  /** For palette picks: whether the user typed a search first. */
  typed?: boolean;
  /**
   * `native` runs come from the application's own controls, which ask for confirmation
   * themselves; `generated` ones come from interfaces Uitive drew. @default 'generated'
   */
  origin?: 'native' | 'generated';
  /** The user already saw the params and said yes, such as by submitting a complete form. */
  confirmed?: boolean;
}

/**
 * How a run ended: `done`, `cancelled` by the person, `failed` in the binding, or `refused` before
 * it started, such as when nothing could ask for confirmation.
 */
export interface PerformResult {
  /** `refused` runs never started; `failed` ones started and threw. */
  status: 'done' | 'cancelled' | 'failed' | 'refused';
  /** The binding's message, or why the run was refused or failed. */
  message?: string;
}

/** The first param that holds a row of some source: what makes an action a row action. */
export function rowParam(fields: readonly Field[]): Field | undefined {
  return fields.find((entry) => entry.type === 'ref');
}
