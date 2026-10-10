import { restFetch } from '@plurid/uitive-core';
import type { AnyContract, FetchRequest, FetchResult } from '@plurid/uitive-core';
import type { Adapter } from '@plurid/uitive-adapter';
import { bucket, meter, READ_BUDGET, spend } from './limits.ts';
import { getSecret } from './secrets.ts';

export class ConnectorError extends Error {
  constructor(
    readonly code: 'no-key' | 'refused' | 'permission' | 'over-budget' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

export const secretName = (adapter: string, connector: string, mode: 'test' | 'live') =>
  `connector:${adapter}:${connector}:${mode}`;

const buckets = new Map<string, ReturnType<typeof bucket>>();

/** How long a result is reused for, in milliseconds. */
const TTL = 60_000;
/** The most one result, and all of them together, may weigh in memory, as JSON characters. */
const MAX_RESULT = 512 * 1024;
const MAX_CACHE = 4 * 1024 * 1024;

// Rows stay in the worker's memory, least recently used first, never in storage.
const cache = new Map<string, { at: number; size: number; result: FetchResult }>();
let cached = 0;
// Forgetting starts a new generation: reads begun before it neither go on nor leave rows behind.
let generation = 0;

function drop(key: string) {
  const entry = cache.get(key);
  if (!entry) return;
  cache.delete(key);
  cached -= entry.size;
}

function recall(key: string): FetchResult | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  drop(key);
  if (Date.now() - entry.at >= TTL) return undefined;
  cache.set(key, entry);
  cached += entry.size;
  return entry.result;
}

function remember(key: string, result: FetchResult) {
  const size = JSON.stringify(result).length;
  drop(key);
  if (size > MAX_RESULT) return;
  const now = Date.now();
  for (const [name, entry] of [...cache]) if (now - entry.at >= TTL) drop(name);
  for (const name of [...cache.keys()]) {
    if (cached + size <= MAX_CACHE) break;
    drop(name);
  }
  cache.set(key, { at: now, size, result });
  cached += size;
}

/** Forgets every cached row and stops reads under way. */
export function forgetReads(): void {
  generation += 1;
  cache.clear();
  cached = 0;
  buckets.clear();
}

/** Results held now, for tests. */
export const cacheSize = () => ({ entries: cache.size, size: cached });

const overBudget = () =>
  new ConnectorError(
    'over-budget',
    `This month's ${READ_BUDGET.toLocaleString('en')} reads are used; more are available next month`,
  );

/**
 * Reads a source from the official API with the person's restricted key, matching the page's
 * mode. Paced, metered read by read against a monthly budget, and cached in memory, with only the
 * fields the contract declares: nothing else could be shown.
 */
export async function connectorFetch(
  adapter: Adapter,
  contract: AnyContract,
  mode: 'test' | 'live',
  request: FetchRequest,
): Promise<FetchResult> {
  const found = Object.entries(adapter.connectors).find(
    ([, connector]) => connector.sources[request.source],
  );
  if (!found) throw new ConnectorError('unavailable', `No official API reads ${request.source}`);
  const [name, connector] = found;
  const spec = connector.sources[request.source];
  if (!spec) throw new ConnectorError('unavailable', `No official API reads ${request.source}`);
  const key = await getSecret(secretName(adapter.id, name, mode));
  if (!key)
    throw new ConnectorError('no-key', `Add a ${mode} restricted key for ${connector.label}`);
  if (!new RegExp(connector.keys[mode]).test(key)) {
    throw new ConnectorError('refused', `The ${connector.label} key doesn't fit ${mode} mode`);
  }

  const cacheKey = `${adapter.id}:${mode}:${JSON.stringify(request)}`;
  const hit = recall(cacheKey);
  if (hit) return hit;
  if ((await meter('reads')) >= READ_BUDGET) throw overBudget();

  const started = generation;
  const forgotten = () =>
    new ConnectorError('unavailable', 'Uitive forgot everything while reading; ask again');
  const pace = buckets.get(name) ?? bucket(connector.rate.perSecond, connector.rate.concurrent);
  buckets.set(name, pace);
  // One request for a list, but one per row for lookups by key: each read is checked and counted.
  const fetch: typeof globalThis.fetch = (input, init) =>
    pace(async () => {
      if (generation !== started) throw forgotten();
      if (!(await spend('reads', READ_BUDGET))) throw overBudget();
      const response = await globalThis.fetch(input, init);
      if (response.status === 401)
        throw new ConnectorError('refused', `${connector.label} refused the key`);
      if (response.status === 403) {
        throw new ConnectorError(
          'permission',
          `The key needs "${spec.permission}" for ${request.source}`,
        );
      }
      return response;
    });
  const binding = restFetch({
    base: connector.base,
    credentials: 'omit',
    headers: () => ({ authorization: `Bearer ${key}` }),
    sources: { [request.source]: spec },
    fetch: (url, init) => fetch(url, init as RequestInit),
  });
  const read = await binding(request, {});
  if (generation !== started) throw forgotten();
  const fields = new Set(contract.source(request.source)?.fields.map((field) => field.name));
  const result: FetchResult = {
    ...read,
    rows: read.rows.map((row) =>
      row !== null && typeof row === 'object'
        ? Object.fromEntries(Object.entries(row).filter(([field]) => fields.has(field)))
        : row,
    ),
  };
  remember(cacheKey, result);
  return result;
}
