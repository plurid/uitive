import { describe, expect, it } from 'vitest';
import { fromJson, toJson } from '@plurid/aptuitive-core';
import { cloud } from '../../apps/cloud-console-react/src/contract.ts';

describe('the cloud console as data', () => {
  it('round-trips with the same hash, and re-serialises byte for byte', () => {
    const json = toJson(cloud);
    const back = fromJson(JSON.parse(JSON.stringify(json)));
    expect(back.hash).toBe(cloud.hash);
    expect(JSON.stringify(toJson(back))).toBe(JSON.stringify(json));
  });

  it('keeps one standard service page for all 168 services', () => {
    const page = toJson(cloud).surfaces.servicePage;
    expect(page?.kind === 'page' && page.standard.values).toBeUndefined();
  });
});
