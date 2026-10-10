import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../__fixtures__/chrome.ts';
import { meter, rate, spend } from './limits.ts';

beforeEach(() => {
  vi.stubGlobal('chrome', fakeChrome({ delay: 2 }).chrome);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('limits', () => {
  it('counts every increment made at the same time', async () => {
    await Promise.all([meter('reads', 1), meter('reads', 1), meter('reads', 3)]);
    expect(await meter('reads')).toBe(5);
  });

  it('spends only what is left of a budget', async () => {
    const spent = await Promise.all([spend('tokens', 2), spend('tokens', 2), spend('tokens', 2)]);
    expect(spent).toEqual([true, true, false]);
    expect(await meter('tokens')).toBe(2);
  });

  it('allows so many calls a minute', () => {
    const allowed = rate(2);
    expect([allowed(), allowed(), allowed()]).toEqual([true, true, false]);
  });
});
