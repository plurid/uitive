/**
 * JSON with object keys sorted, so equal values always serialize to the same bytes. Values with
 * `toJSON`, such as dates, serialize as it says; other objects must be plain, and a value that
 * contains itself is refused.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value, new Set()));
}

function sortKeys(value: unknown, path: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') return sortKeys(toJSON.call(value), path);
  if (path.has(value)) throw new TypeError("Can't serialize a value that contains itself");
  path.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => sortKeys(entry, path));
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      const name = (prototype as { constructor?: { name?: string } }).constructor?.name;
      throw new TypeError(`Can't serialize a ${name || 'value'}: only plain objects and arrays`);
    }
    // No prototype, so an own `__proto__` key stays a key.
    const sorted = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined && typeof entry !== 'function') sorted[key] = sortKeys(entry, path);
    }
    return sorted;
  } finally {
    path.delete(value);
  }
}

/** A short, deterministic, non-cryptographic hash (cyrb53) of a value's stable serialization. */
export function hash(value: unknown): string {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
