import { describe, expect, it } from 'vitest';
import { limits, outputSchema, contractText } from '@plurid/uitive-server';
import { cloud } from '../../apps/cloud-console-react/src/contract.ts';

// Structured outputs allow at most 24 optional and 16 union-typed parameters per request.
describe('structured-output limits for every demo contract', () => {
  it('cloud console', () => {
    const schema = outputSchema(cloud);
    const counted = limits(schema);
    expect(counted.optional).toBe(0);
    expect(counted.unions).toBeLessThanOrEqual(16);
    expect(JSON.stringify(schema).length).toBeLessThan(60_000);
    // The cached prefix: identical bytes on every call.
    expect(contractText(cloud)).toBe(contractText(cloud));
  });
});
