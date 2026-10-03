import type { ApiInventory } from './openapi.js';

/** Past these, models choose worse: curate down to what the frontend shows. */
export const CURATE_SOURCES = 40;
/** Actions past which models choose worse: curate down to what the interface offers. */
export const CURATE_ACTIONS = 200;

/**
 * One line of a survey: a source, its fields kept and left out, what its API can do, and its
 * actions.
 */
export interface SurveySource {
  /** The source's ID, as the curation names it. */
  id: string;
  /** What people call it. */
  label: string;
  /** The path that lists its rows. */
  path: string;
  /** Fields kept, and fields understood but left out. */
  fields: number;
  /** How many fields were understood but left out. */
  extra: number;
  /** Their names, for the curation's `fields`, `labels` and `title`. */
  names: { kept: string[]; extra: string[] };
  /** Fields the endpoint filters by. */
  filters: string[];
  /** Whether the endpoint searches text. */
  search: boolean;
  /** Fields the endpoint sorts by. */
  sort: string[];
  /** How the endpoint pages: `cursor`, `offset` or `none`. */
  pagination: string;
  /** Whether rows can be read one by key. */
  item: boolean;
  /** The IDs of the actions on its rows. */
  actions: string[];
  /** Guesses worth checking against the running API. */
  notes: string[];
  /** Whether the curation keeps it, when there is one. */
  included?: boolean;
}

/**
 * A compact inventory of an API description, to curate from: counts, advice, one line per source,
 * and what was skipped.
 */
export interface Survey {
  /** The API's title. */
  title: string;
  /** The API's version. */
  version: string;
  /** The base URL requests go to. */
  server: string;
  /** How many sources and actions it yields, and how many operations were skipped. */
  counts: { sources: number; actions: number; skipped: number };
  /** What to do next, such as curating a large description. */
  advice: string[];
  /** One line per source. */
  sources: SurveySource[];
  /** Actions on no source, such as `/v1/tokens`. */
  unattached: string[];
  /** Skipped operations, by reason. */
  skipped: Record<string, string[]>;
}

/** Surveys what the mapper read, marking the sources a curation keeps. */
export function survey(inventory: ApiInventory, included?: ReadonlySet<string>): Survey {
  const advice: string[] = [];
  if (inventory.sources.length > CURATE_SOURCES || inventory.actions.length > CURATE_ACTIONS) {
    advice.push(
      `This API has ${inventory.sources.length} sources and ${inventory.actions.length} actions. Keep what the frontend shows (at most ${CURATE_SOURCES} sources and ${CURATE_ACTIONS} actions) in the curation file, curation.json in the Aptuitive folder: { "default": "exclude", "sources": { "<id>": { "include": true } } }. Actions follow their source.`,
    );
  }
  const notes = inventory.sources.filter((entry) => entry.notes.length > 0).length;
  if (notes > 0)
    advice.push(`${notes} sources carry guesses in notes; check them against the API.`);
  const skipped: Record<string, string[]> = {};
  for (const entry of inventory.skipped) {
    const reason = entry.reason.startsWith('needs ') ? 'needs a parameter' : entry.reason;
    (skipped[reason] ??= []).push(
      entry.reason.startsWith('needs ') ? `${entry.operation} (${entry.reason})` : entry.operation,
    );
  }
  return {
    title: inventory.title,
    version: inventory.version,
    server: inventory.server,
    counts: {
      sources: inventory.sources.length,
      actions: inventory.actions.length,
      skipped: inventory.skipped.length,
    },
    advice,
    sources: inventory.sources.map((entry) => ({
      id: entry.id,
      label: entry.label,
      path: entry.rest.path,
      fields: entry.fields.length,
      extra: entry.extra.length,
      names: {
        kept: entry.fields.map((field) => field.name),
        extra: entry.extra.map((field) => field.name),
      },
      filters: Object.keys(entry.capabilities.filter),
      search: entry.capabilities.search,
      sort: entry.capabilities.sort,
      pagination: entry.capabilities.pagination,
      item: entry.rest.item !== undefined,
      actions: inventory.actions
        .filter((action) => action.resource === entry.id)
        .map((action) => action.id.slice(entry.id.length + 1)),
      notes: entry.notes,
      ...(included ? { included: included.has(entry.id) } : {}),
    })),
    unattached: inventory.actions
      .filter((action) => action.resource === null)
      .map((action) => action.id),
    skipped,
  };
}

/** The survey as text: one line per source, sized for a coding agent's context. */
export function surveyText(value: Survey): string {
  const lines = [
    `${[value.title, value.version].filter(Boolean).join(' ')}${value.server ? `, ${value.server}` : ''}`,
    `${value.counts.sources} sources, ${value.counts.actions} actions, ${value.counts.skipped} operations skipped.`,
    ...value.advice,
    '',
    'Sources: id (path) fields kept+left out; filters; search; sort; paging; by key; actions',
  ];
  for (const entry of value.sources) {
    const mark = entry.included === undefined ? '' : entry.included ? '[x] ' : '[ ] ';
    const parts = [
      `${entry.fields}+${entry.extra} fields`,
      entry.filters.length > 0 ? `filters ${entry.filters.join(' ')}` : 'no filters',
      ...(entry.search ? ['search'] : []),
      ...(entry.sort.length > 0 ? [`sort ${entry.sort.join(' ')}`] : []),
      entry.pagination,
      ...(entry.item ? ['by key'] : []),
      entry.actions.length > 0 ? `actions ${entry.actions.join(' ')}` : 'no actions',
      ...entry.notes.map((note) => `note: ${note}`),
    ];
    lines.push(`  ${mark}${entry.id} (${entry.path}) ${parts.join('; ')}`);
    // Chosen sources show their fields, to curate further from.
    if (entry.included) {
      const extra = entry.names.extra.length > 0 ? `; can add: ${entry.names.extra.join(' ')}` : '';
      lines.push(`      fields: ${entry.names.kept.join(' ')}${extra}`);
    }
  }
  if (value.unattached.length > 0) {
    lines.push('', `Actions on no source: ${value.unattached.join(' ')}`);
  }
  const reasons = Object.entries(value.skipped);
  if (reasons.length > 0) {
    lines.push('', 'Skipped:');
    for (const [reason, operations] of reasons) {
      const shown = operations.slice(0, 8).join(', ');
      lines.push(
        `  ${reason} (${operations.length}): ${shown}${operations.length > 8 ? ', ...' : ''}`,
      );
    }
  }
  return lines.join('\n');
}
