import { restFetch } from '@plurid/uitive-core';
import type { FetchRequest, FetchResult } from '@plurid/uitive-core';
import type { Adapter } from '@plurid/uitive-adapter';
import { bucket, meter, READ_BUDGET } from './limits.ts';
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
const TTL = 60_000;

/**
 * Reads a source from the official API with the person's restricted key, matching the page's
 * mode. Paced, metered against a monthly read budget, and cached in session storage.
 */
export async function connectorFetch(
  adapter: Adapter,
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

  const cacheKey = `cache:${adapter.id}:${mode}:${JSON.stringify(request)}`;
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey] as
    { at: number; result: FetchResult } | undefined;
  if (cached && Date.now() - cached.at < TTL) return cached.result;
  if ((await meter('reads')) >= READ_BUDGET) {
    throw new ConnectorError(
      'over-budget',
      `This month's ${READ_BUDGET} reads are used; raise the budget in settings`,
    );
  }

  const pace = buckets.get(name) ?? bucket(connector.rate.perSecond, connector.rate.concurrent);
  buckets.set(name, pace);
  const fetch: typeof globalThis.fetch = (input, init) =>
    pace(async () => {
      await meter('reads', 1);
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
  const result = await binding(request, {});
  await chrome.storage.session.set({ [cacheKey]: { at: Date.now(), result } });
  return result;
}
