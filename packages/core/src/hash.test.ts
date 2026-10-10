import { describe, expect, it } from 'vitest';
import { hash, stableStringify } from './hash.js';

describe('stableStringify', () => {
  it('sorts keys, and serializes what says how', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe(
      '{"a":[2,{"d":3}],"b":1}',
    );
    expect(stableStringify({ at: new Date(0) })).toBe('{"at":"1970-01-01T00:00:00.000Z"}');
    expect(hash({ at: new Date(0) })).not.toBe(hash({ at: new Date(1e12) }));
  });

  it('keeps an own __proto__ key', () => {
    const parsed = (value: number) => JSON.parse(`{"__proto__":{"a":${value}}}`) as unknown;
    expect(stableStringify(parsed(1))).toBe('{"__proto__":{"a":1}}');
    expect(hash(parsed(1))).not.toBe(hash(parsed(2)));
  });

  it('refuses what JSON would lose, and values that contain themselves', () => {
    expect(() => stableStringify(new Map([['a', 1]]))).toThrow("Can't serialize a Map");
    expect(() => stableStringify({ tags: new Set(['a']) })).toThrow("Can't serialize a Set");
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => stableStringify(loop)).toThrow("Can't serialize a value that contains itself");
    const shared = { a: 1 };
    expect(stableStringify([shared, shared])).toBe('[{"a":1},{"a":1}]');
  });
});
