type Json = Record<string, unknown>;

/**
 * The JSON in a model's answer: the whole text, a fenced block, or the outermost object, since
 * models without structured output sometimes wrap their JSON in prose.
 */
export function parseAnswer(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1];
  for (const candidate of [trimmed, fenced]) {
    if (candidate === undefined) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next reading.
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) throw new SyntaxError('No JSON object in the answer');
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
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
