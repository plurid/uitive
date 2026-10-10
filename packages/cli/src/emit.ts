import { oneLine, property, quote } from './code.js';
import type { ApiAction, ApiField, ApiInventory, ApiParam, ApiSource } from './openapi.js';

/**
 * How generated sources are written: where the description came from, and which modules the code
 * imports.
 */
export interface EmitOptions {
  /** Where the description came from, for the header, such as `stripe.json`. */
  from: string;
  /** The module that exports the field helpers. @default '@plurid/uitive-core' */
  core?: string;
  /** The module that exports `z`. @default 'zod' */
  zod?: string;
  /** The curation file, named in the header. @default 'uitive/curation.json' */
  curation?: string;
}

const strings = (values: readonly string[]) => `[${values.map(quote).join(', ')}]`;
const record = (value: Readonly<Record<string, number>>) => {
  const entries = Object.entries(value).map(([name, entry]) => `${property(name)}: ${entry}`);
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
};
const doc = (value: string, indent: string) =>
  value === '' ? '' : `${indent}/** ${oneLine(value).replace(/\*\//g, '* /')} */\n`;

/** A value as a TypeScript literal, one property per line. */
function literal(value: unknown, indent: string): string {
  if (typeof value === 'string') return quote(value);
  if (typeof value !== 'object' || value === null) return String(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry !== 'object')) {
      return `[${value.map((entry) => literal(entry, inner)).join(', ')}]`;
    }
    return `[\n${value.map((entry) => `${inner}${literal(entry, inner)},`).join('\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  if (entries.length === 0) return '{}';
  return `{\n${entries
    .map(([name, entry]) => `${inner}${property(name)}: ${literal(entry, inner)},`)
    .join('\n')}\n${indent}}`;
}

function schema(field: ApiField, sources: ReadonlySet<string>, siblings: ReadonlySet<string>) {
  const label = field.label === undefined ? [] : [`label: ${quote(field.label)}`];
  const options = (entries: readonly string[]) =>
    entries.length === 0 ? '' : `{ ${entries.join(', ')} }`;
  switch (field.type) {
    case 'text':
      return label.length === 0 ? 'z.string()' : `field.text(${options(label)})`;
    case 'number':
      return label.length === 0 ? 'z.number()' : `field.number(${options(label)})`;
    case 'bool':
      return label.length === 0 ? 'z.boolean()' : `field.bool(${options(label)})`;
    case 'enum':
      return `field.enum(${[strings(field.values), options(label)].filter(Boolean).join(', ')})`;
    case 'time':
      return `field.time(${options([
        ...(field.unit === undefined || field.unit === 'iso' ? [] : [`unit: ${quote(field.unit)}`]),
        ...label,
      ])})`;
    case 'money':
      return `field.money(${options([
        ...(field.currency !== undefined && siblings.has(field.currency)
          ? [`currency: ${quote(field.currency)}`]
          : []),
        ...(field.minor ? ['minor: true'] : []),
        ...(field.minor && field.digits !== undefined ? [`digits: ${record(field.digits)}`] : []),
        ...label,
      ])})`;
    case 'ref':
      // A reference to a source left out is just its id.
      return field.source !== undefined && sources.has(field.source)
        ? `field.ref(${[quote(field.source), options(label)].filter(Boolean).join(', ')})`
        : label.length === 0
          ? 'z.string()'
          : `field.text(${options(label)})`;
  }
}

function emitSource(source: ApiSource, sources: ReadonlySet<string>): string {
  const names = new Set(source.fields.map((field) => field.name));
  const fields = source.fields
    .map(
      (field) =>
        `${doc(field.description, '      ')}      ${property(field.name)}: ${schema(field, sources, names)}${field.nullable ? '.nullable()' : ''},`,
    )
    .join('\n');
  const filters = Object.entries(source.capabilities.filter);
  const lines = [
    `  ${property(source.id)}: source({`,
    `    label: ${quote(source.label)},`,
    `    description: ${quote(source.description)},`,
    ...(source.keywords.length > 0 ? [`    keywords: ${strings(source.keywords)},`] : []),
    `    row: z.object({`,
    fields,
    `    }),`,
    `    key: ${quote(source.key)},`,
    ...(source.title === source.key ? [] : [`    title: ${quote(source.title)},`]),
    `    summary: ${strings(source.summary)},`,
    `    capabilities: {`,
    filters.length === 0
      ? `      filter: {},`
      : `      filter: {\n${filters.map(([name, ops]) => `        ${property(name)}: ${strings(ops)},`).join('\n')}\n      },`,
    `      sort: ${strings(source.capabilities.sort)},`,
    `      search: ${source.capabilities.search},`,
    `      pagination: ${quote(source.capabilities.pagination)},`,
    `    },`,
    ...(source.scan === undefined ? [] : [`    scan: ${source.scan},`]),
    ...(source.ttl === undefined ? [] : [`    ttl: ${source.ttl},`]),
    `  }),`,
  ];
  return lines.join('\n');
}

function emitParam(param: ApiParam, sources: ReadonlySet<string>, names: ReadonlySet<string>) {
  return `${doc(param.description, '      ')}      ${property(param.name)}: ${schema(param, sources, names)}${param.required ? '' : '.optional()'},`;
}

function emitAction(action: ApiAction, sources: ReadonlySet<string>): string {
  const names = new Set(action.params.map((param) => param.name));
  const lines = [
    `  ${property(action.id)}: action({`,
    `    label: ${quote(action.label)},`,
    `    description: ${quote(action.description)},`,
    ...(action.params.length === 0
      ? []
      : [
          `    params: z.object({`,
          action.params.map((param) => emitParam(param, sources, names)).join('\n'),
          `    }),`,
        ]),
    `    effect: ${quote(action.effect)},`,
    ...(action.confirm === undefined ? [] : [`    confirm: ${quote(action.confirm)},`]),
    ...(action.when === undefined ? [] : [`    when: ${literal(action.when, '    ')},`]),
    ...(action.invalidates.length === 0
      ? []
      : [`    invalidates: ${strings(action.invalidates)},`]),
    `  }),`,
  ];
  return lines.join('\n');
}

/** The generated module: sources, actions and how each maps to the API. */
export function emit(inventory: ApiInventory, options: EmitOptions): string {
  const core = options.core ?? '@plurid/uitive-core';
  const sources = new Set(inventory.sources.map((entry) => entry.id));
  const title = [inventory.title, inventory.version].filter(Boolean).join(' ');
  const endpoints = {
    sources: Object.fromEntries(inventory.sources.map((entry) => [entry.id, entry.rest])),
    actions: Object.fromEntries(inventory.actions.map((entry) => [entry.id, entry.rest])),
  };
  const imports = [
    ...(inventory.actions.length > 0 ? ['action'] : []),
    'field',
    ...(inventory.sources.length > 0 ? ['source'] : []),
  ];
  return [
    oneLine(`// Generated by \`uitive generate sources\` from ${title} (${options.from}).`),
    oneLine(
      `// Keep choices in ${options.curation ?? 'uitive/curation.json'}: regenerating replaces this file.`,
    ),
    `import { ${imports.join(', ')} } from ${quote(core)};`,
    `import type { RestAction, RestSource } from ${quote(core)};`,
    `import { z } from ${quote(options.zod ?? 'zod')};`,
    ``,
    `/** The base URL the description names; bindings may use another. */`,
    `export const server = ${quote(inventory.server)};`,
    ``,
    `export const sources = {`,
    inventory.sources.map((entry) => emitSource(entry, sources)).join('\n'),
    `};`,
    ``,
    `export const actions = {`,
    inventory.actions.map((entry) => emitAction(entry, sources)).join('\n'),
    `};`,
    ``,
    `/** How each source and action maps to the API, for \`restFetch\` and \`restPerform\`. */`,
    `export const endpoints: {`,
    `  sources: Record<string, RestSource>;`,
    `  actions: Record<string, RestAction>;`,
    `} = ${literal(endpoints, '')};`,
    ``,
  ].join('\n');
}
