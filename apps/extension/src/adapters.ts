import { checkAdapter } from '@plurid/uitive-adapter';
import type { Adapter } from '@plurid/uitive-adapter';
import type { AnyContract } from '@plurid/uitive-core';
import stripe from '../adapters/stripe-dashboard.json';

declare const __FIXTURE__: { site: string; api: string } | null;

/** Adapters ship inside the extension as data, and are checked before use. */
const shipped: readonly unknown[] = [stripe];

export interface Loaded {
  adapter: Adapter;
  contract: AnyContract;
}

let loaded: Loaded[] | undefined;

/** The shipped adapters that pass their checks; test builds also point them at the local fixture. */
export function adapters(): Loaded[] {
  if (loaded) return loaded;
  loaded = shipped.flatMap((raw) => {
    const checked = checkAdapter(raw);
    if ('problems' in checked) {
      console.warn('[uitive] adapter left out:', checked.problems);
      return [];
    }
    const fixture = typeof __FIXTURE__ === 'undefined' ? null : __FIXTURE__;
    if (!fixture) return [checked];
    const adapter: Adapter = {
      ...checked.adapter,
      origins: [...checked.adapter.origins, fixture.site],
      connectors: Object.fromEntries(
        Object.entries(checked.adapter.connectors).map(([name, connector]) => [
          name,
          { ...connector, base: fixture.api },
        ]),
      ),
    };
    return [{ adapter, contract: checked.contract }];
  });
  return loaded;
}

export const adapterFor = (origin: string) =>
  adapters().find((entry) => entry.adapter.origins.includes(origin));

export const adapterById = (id: string) => adapters().find((entry) => entry.adapter.id === id);
