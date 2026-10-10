type Json = Record<string, unknown>;

/**
 * The JSON in a model's answer, since models without structured output sometimes wrap it in prose:
 * the whole text, else any fenced block, else the first balanced object that parses, each also
 * read without trailing commas.
 */
export function parseAnswer(text: string): unknown {
  for (const candidate of readings(text.trim())) {
    for (const reading of [candidate, withoutTrailingCommas(candidate)]) {
      try {
        return JSON.parse(reading) as unknown;
      } catch {
        // Try the next reading.
      }
    }
  }
  throw new SyntaxError('No JSON object in the answer');
}

/** Most objects tried in prose, so a pathological answer can't take long. */
const ATTEMPTS = 64;

function* readings(text: string): Generator<string> {
  yield text;
  for (const match of text.matchAll(/```[a-z]*[ \t]*\r?\n?([\s\S]*?)```/gi)) {
    if (match[1] !== undefined) yield match[1].trim();
  }
  let start = text.indexOf('{');
  for (let attempts = 0; start !== -1 && attempts < ATTEMPTS; attempts++) {
    const end = closing(text, start);
    if (end === -1) {
      start = text.indexOf('{', start + 1);
      continue;
    }
    yield text.slice(start, end + 1);
    start = text.indexOf('{', end + 1);
  }
}

/** Where the object opened at `start` closes, minding strings; -1 when it never does. */
function closing(text: string, start: number): number {
  let depth = 0;
  let quoted = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '\\') index++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index;
  }
  return -1;
}

/** The text with commas before a closing brace or bracket left out, outside strings. */
function withoutTrailingCommas(text: string): string {
  let out = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string;
    if (quoted) {
      if (char === '\\') {
        out += char + (text[index + 1] ?? '');
        index++;
        continue;
      }
      if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',' && /^\s*[}\]]/.test(text.slice(index + 1))) continue;
    out += char;
  }
  return out;
}

const typeOf = (value: unknown): string =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : typeof value === 'number' && Number.isInteger(value)
        ? 'integer'
        : typeof value;

const fits = (type: string, actual: string) =>
  type === actual || (type === 'number' && actual === 'integer');

/**
 * Where a value strays from a JSON Schema, in the subset `outputSchema` writes: types, properties,
 * required and extra keys, items, enums, constants, `anyOf` and `$ref` into `$defs`. Empty when
 * the value follows it; at most `limit` problems, for a repair message.
 */
export function schemaProblems(schema: Json, value: unknown, limit = 10): string[] {
  const definitions = (schema['$defs'] ?? {}) as Record<string, Json>;
  const resolve = (node: Json): Json => {
    const reference = node['$ref'];
    if (typeof reference !== 'string') return node;
    const name = /^#\/\$defs\/(.+)$/.exec(reference)?.[1];
    const target = name === undefined ? undefined : definitions[name];
    return target === undefined ? node : resolve(target);
  };
  const walk = (raw: Json, data: unknown, path: string, out: string[]) => {
    const node = resolve(raw);
    const at = path || '/';
    const variants = node['anyOf'];
    if (Array.isArray(variants)) {
      // The variant that comes closest says what to fix.
      let closest: string[] | undefined;
      for (const variant of variants as Json[]) {
        const found: string[] = [];
        walk(variant, data, path, found);
        if (found.length === 0) return;
        if (closest === undefined || found.length < closest.length) closest = found;
      }
      out.push(...(closest ?? [`${at}: matches none of its forms`]));
      return;
    }
    const declared = node['type'];
    const types = Array.isArray(declared) ? (declared as string[]) : declared ? [declared] : [];
    const actual = typeOf(data);
    if (types.length > 0 && !types.some((type) => fits(String(type), actual))) {
      out.push(`${at}: expected ${types.join(' or ')}, got ${actual}`);
      return;
    }
    if ('const' in node && data !== node['const']) {
      out.push(`${at}: must be ${JSON.stringify(node['const'])}`);
      return;
    }
    const allowed = node['enum'];
    if (Array.isArray(allowed) && !allowed.includes(data)) {
      const shown = allowed.slice(0, 12).map((entry) => JSON.stringify(entry));
      out.push(`${at}: must be one of ${shown.join(', ')}${allowed.length > 12 ? ', …' : ''}`);
      return;
    }
    if (actual === 'object' && node['properties'] !== undefined) {
      const properties = node['properties'] as Record<string, Json>;
      const record = data as Record<string, unknown>;
      for (const key of (node['required'] ?? []) as string[]) {
        if (!(key in record)) out.push(`${path}/${key}: missing`);
      }
      for (const [key, child] of Object.entries(record)) {
        const property = properties[key];
        if (property === undefined) {
          if (node['additionalProperties'] === false) out.push(`${path}/${key}: not allowed`);
        } else {
          walk(property, child, `${path}/${key}`, out);
        }
      }
    }
    if (actual === 'array' && node['items'] !== undefined) {
      (data as unknown[]).forEach((item, index) =>
        walk(node['items'] as Json, item, `${path}/${index}`, out),
      );
    }
  };
  const problems: string[] = [];
  walk(schema, value, '', problems);
  return problems.slice(0, limit);
}

/** The repair message for an answer that strayed from the schema. */
export function formText(problems: readonly string[]): string {
  return [
    "That answer doesn't follow the plan's JSON form:",
    ...problems.map((problem) => `- ${problem}`),
    'Return the whole plan again, as one JSON object that follows the schema exactly.',
  ].join('\n');
}

/**
 * The schema for providers that take no `const`, such as OpenAI's strict mode and Gemini: each
 * constant becomes an enum of one value, which means the same.
 */
export function withoutConst(schema: Json): Json {
  const convert = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(convert);
    if (value === null || typeof value !== 'object') return value;
    const out: Json = {};
    for (const [key, child] of Object.entries(value as Json)) {
      if (key === 'const') out['enum'] = [child];
      // Names of properties and definitions are kept, whatever they are.
      else if (key === 'properties' || key === '$defs') {
        out[key] = Object.fromEntries(
          Object.entries(child as Json).map(([name, inner]) => [name, convert(inner)]),
        );
      } else out[key] = convert(child);
    }
    return out;
  };
  return convert(schema) as Json;
}
