import { createContext, useContext } from 'react';
import type { Adaptation, View, Via } from '@plurid/aptuitive-core';
import type { Verb } from './catalogue.ts';
import type { QuickAction } from './contract.ts';

export interface Console {
  view: View;
  /** The service whose page is open. */
  current: string | undefined;
  open(service: string, via: Via): void;
  /** Runs an action, on another service than the current one if given. */
  run(verb: Verb, via: Via, service?: string): void;
  runQuick(quick: QuickAction): void;
  ask(text: string, options?: { goal?: boolean }): Promise<Adaptation>;
}

export const ConsoleContext = createContext<Console | undefined>(undefined);

export function useConsole(): Console {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error('useConsole needs a ConsoleContext provider');
  return value;
}
