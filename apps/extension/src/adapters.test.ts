import { readdirSync, readFileSync } from 'node:fs';
import { checkAdapter } from '@plurid/uitive-adapter';
import { restFetch } from '@plurid/uitive-core';
import { describe, expect, it } from 'vitest';
import { startDashboard } from '../../../tools/fixtures/payments-dashboard/server.ts';
import { endpoints } from '../adapters/acme-payments/api.generated.ts';
import { shipped } from './shipped.ts';

const folder = new URL('../adapters/', import.meta.url);
const ids = readdirSync(folder)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts'))
  .map((name) => name.slice(0, -'.ts'.length));

describe('the adapters', () => {
  it.each(ids)(
    '%s is the JSON the build writes from its source, so a build changes no tracked file',
    async (id) => {
      const { adapter } = (await import(`../adapters/${id}.ts`)) as { adapter: unknown };
      expect(readFileSync(new URL(`${id}.json`, folder), 'utf8'), 'Stale: run node build.ts').toBe(
        `${JSON.stringify(adapter, null, 2)}\n`,
      );
    },
  );

  it.each(ids)('%s passes its checks', (id) => {
    const checked = checkAdapter(JSON.parse(readFileSync(new URL(`${id}.json`, folder), 'utf8')));
    expect('problems' in checked ? checked.problems : []).toEqual([]);
  });

  it('ship, in tests and type checks, as the demo the source imports', () => {
    expect(shipped.length).toBeGreaterThan(0);
    for (const raw of shipped) expect(ids).toContain((raw as { id: string }).id);
  });
});

describe('the demo adapter', () => {
  it('reads every source from the fictional dashboard’s API, page by page, with its own key header', async () => {
    const dashboard = await startDashboard();
    try {
      const read = restFetch({
        base: dashboard.api,
        headers: () => ({ 'x-acme-key': 'acme_test_smoke' }),
        sources: endpoints.sources,
      });
      for (const source of Object.keys(endpoints.sources)) {
        const request = { source, fields: [], filter: [], sort: [], limit: 1 };
        const first = await read(request, {});
        expect(first.rows, source).toHaveLength(1);
        expect(first.next, source).toBeDefined();
        const second = await read({ ...request, cursor: first.next }, {});
        expect(second.rows[0], source).not.toEqual(first.rows[0]);
      }
      expect(dashboard.requests.every((entry) => entry.key === 'acme_test_smoke')).toBe(true);
    } finally {
      await dashboard.close();
    }
  });
});
