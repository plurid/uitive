import { readFileSync } from 'node:fs';
import { checkAdapter } from '@plurid/uitive-adapter';
import { describe, expect, it } from 'vitest';
import { adapter } from '../adapters/stripe-dashboard.ts';

const shipped = readFileSync(new URL('../adapters/stripe-dashboard.json', import.meta.url), 'utf8');

describe('the shipped adapters', () => {
  it('are the JSON the build writes from their source, so a build changes no tracked file', () => {
    expect(shipped, 'Stale: run node apps/extension/build.ts').toBe(
      `${JSON.stringify(adapter, null, 2)}\n`,
    );
  });

  it('pass their checks', () => {
    const checked = checkAdapter(JSON.parse(shipped));
    expect('problems' in checked ? checked.problems : []).toEqual([]);
  });
});
