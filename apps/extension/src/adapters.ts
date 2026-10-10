import { checkAdapter } from '@plurid/uitive-adapter';
import type { Adapter } from '@plurid/uitive-adapter';
import type { AnyContract } from '@plurid/uitive-core';
import { shipped } from './shipped.ts';

export interface Loaded {
  adapter: Adapter;
  contract: AnyContract;
}

// Each adapter is checked the first time it's needed, so a page pays only for its own site's.
const checked = new Map<unknown, Loaded | null>();

function load(raw: unknown): Loaded | undefined {
  if (!checked.has(raw)) {
    const result = checkAdapter(raw);
    if ('problems' in result) console.warn('[uitive] adapter left out:', result.problems);
    checked.set(raw, 'problems' in result ? null : result);
  }
  return checked.get(raw) ?? undefined;
}

const read = (raw: unknown, key: 'id' | 'origins'): unknown =>
  raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined;

/** Every shipped adapter that passes its checks. */
export const adapters = (): Loaded[] => shipped.flatMap((raw) => load(raw) ?? []);

/** The adapter for a site, if one ships and passes its checks. */
export const adapterFor = (origin: string): Loaded | undefined => {
  const raw = shipped.find((entry) => {
    const origins = read(entry, 'origins');
    return Array.isArray(origins) && origins.includes(origin);
  });
  return raw === undefined ? undefined : load(raw);
};

/** The adapter with an ID, if one ships and passes its checks. */
export const adapterById = (id: string): Loaded | undefined => {
  const raw = shipped.find((entry) => read(entry, 'id') === id);
  return raw === undefined ? undefined : load(raw);
};
