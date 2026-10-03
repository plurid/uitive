import type { Uitive, Persona, SessionReport } from '@plurid/uitive-core';

/**
 * What the banner and "Your interface" need from a client. A client from `createUitive`
 * fits as it is; a remote adapter can offer the same over HTTP.
 */
export type ClientLike = Pick<
  Uitive,
  | 'contract'
  | 'getSnapshot'
  | 'subscribe'
  | 'explain'
  | 'revert'
  | 'revertAdaptation'
  | 'keep'
  | 'accept'
  | 'dismiss'
  | 'preview'
  | 'freeze'
  | 'setGoal'
  | 'setView'
  | 'reset'
  | 'clearData'
  | 'export'
  | 'import'
>;

/** What the debug panel needs on top: usage, requests and the controls of the loop. */
export type DebugClientLike = ClientLike &
  Pick<
    Uitive,
    'events' | 'summary' | 'request' | 'plan' | 'nextSession' | 'apply' | 'setAutonomy'
  > & {
    /**
     * Runs a persona where the client lives, such as on a server. A client from
     * `createUitive` doesn't need it: the panel simulates it directly.
     */
    simulate?(
      persona: Persona,
      options: { sessions: number; seed: number },
    ): Promise<readonly SessionReport[]>;
  };
