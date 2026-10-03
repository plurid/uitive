import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { curate, parseCuration, picksOf } from './curation.js';
import type { Curation } from './curation.js';
import { emit } from './emit.js';
import { formatLikeProject } from './format.js';
import { inventory, readSpec } from './openapi.js';
import type { ApiInventory } from './openapi.js';
import { CURATE_ACTIONS, CURATE_SOURCES, survey } from './survey.js';
import type { Survey } from './survey.js';
import { folderOf } from './folder.js';

/** Where the curation is, in a project that keeps Aptuitive's files in `aptuitive/`; commands use the project's own folder (`folderOf`). */
export const CURATION = 'aptuitive/curation.json';
/** Where `generate sources` writes, in a project that keeps Aptuitive's files in `aptuitive/`; commands use the project's own folder (`folderOf`). */
export const GENERATED = 'aptuitive/api.generated.ts';

/** Where an API description is, and its curation. */
export interface SpecOptions {
  /** A path or URL to an OpenAPI 2.0, 3.0 or 3.1 description. */
  spec: string;
  /** The project's root. @default process.cwd() */
  cwd?: string;
  /** The curation file; used when it exists. @default 'curation.json' in the project's Aptuitive folder */
  curation?: string;
}

async function readText(spec: string, cwd: string): Promise<string> {
  if (/^https?:\/\//.test(spec)) {
    const response = await fetch(spec);
    if (!response.ok) throw new Error(`${spec} answered ${response.status}`);
    return response.text();
  }
  return readFile(resolve(cwd, spec), 'utf8');
}

async function readCuration(path: string): Promise<{ curation?: Curation; problems: string[] }> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { problems: [] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { problems: [`${path}: ${(error as Error).message}`] };
  }
  const parsed = parseCuration(value);
  return 'problems' in parsed
    ? { problems: parsed.problems }
    : { curation: parsed.curation, problems: [] };
}

interface Loaded {
  raw: ApiInventory;
  curated: ApiInventory;
  curation?: Curation;
  problems: string[];
}

async function load(options: SpecOptions): Promise<Loaded> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const curationName = options.curation ?? `${await folderOf(cwd)}/curation.json`;
  const { curation, problems } = await readCuration(resolve(cwd, curationName));
  const doc = readSpec(await readText(options.spec, cwd));
  const raw = inventory(doc, curation ? { picks: picksOf(curation) } : {});
  if (!curation) return { raw, curated: raw, problems };
  const curated = curate(raw, curation);
  return {
    raw,
    curated: curated.inventory,
    curation,
    problems: [...problems, ...curated.problems],
  };
}

/** A compact inventory of an API description, marking what the curation keeps. */
export async function surveySpec(options: SpecOptions): Promise<Survey & { problems: string[] }> {
  const loaded = await load(options);
  const included = loaded.curation
    ? new Set(loaded.curated.sources.map((entry) => entry.id))
    : undefined;
  return { ...survey(loaded.raw, included), problems: loaded.problems };
}

/** What `generate sources` takes: the description, its curation, and where to write. */
export interface GenerateSourcesOptions extends SpecOptions {
  /** Where to write. @default 'api.generated.ts' in the project's Aptuitive folder */
  out?: string;
  /** Reports without writing. @default false */
  dryRun?: boolean;
}

/**
 * What `generate sources` did: the file, whether it was written, the sources and actions, and what
 * stopped it.
 */
export interface GenerateSourcesResult {
  /** The generated module. */
  file: string;
  /** Whether it was written; not on a dry run, or when something blocked it. */
  written: boolean;
  /** The IDs of the sources generated. */
  sources: string[];
  /** The IDs of the actions generated. */
  actions: string[];
  /** What blocks generation: fix these first. */
  problems: string[];
  /** Guesses worth checking. */
  notes: string[];
}

/** Generates sources, actions and endpoints from an API description and its curation. */
export async function generateSources(
  options: GenerateSourcesOptions,
): Promise<GenerateSourcesResult & { code: string }> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const folder = await folderOf(cwd);
  const curationName = options.curation ?? `${folder}/curation.json`;
  const file = resolve(cwd, options.out ?? `${folder}/api.generated.ts`);
  const loaded = await load(options);
  const { curated } = loaded;
  const problems = [...loaded.problems];
  if (
    !loaded.curation &&
    (curated.sources.length > CURATE_SOURCES || curated.actions.length > CURATE_ACTIONS)
  ) {
    problems.push(
      `This API has ${curated.sources.length} sources and ${curated.actions.length} actions; past ${CURATE_SOURCES} and ${CURATE_ACTIONS}, models choose worse. Run \`aptuitive survey\` and keep what the frontend shows in ${curationName}.`,
    );
  }
  const notes = [
    ...curated.sources.flatMap((entry) => entry.notes.map((note) => `${entry.id}: ${note}`)),
    ...(loaded.curation && curated.sources.length > CURATE_SOURCES
      ? [
          `${curated.sources.length} sources is more than ${CURATE_SOURCES}; consider curating further.`,
        ]
      : []),
  ];
  const code =
    problems.length === 0
      ? emit(curated, {
          from: /^https?:\/\//.test(options.spec) ? options.spec : basename(options.spec),
          curation: curationName,
        })
      : '';
  const written = problems.length === 0 && options.dryRun !== true;
  if (written) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, await formatLikeProject(code, file, cwd));
  }
  return {
    file: relative(cwd, file),
    written,
    sources: curated.sources.map((entry) => entry.id),
    actions: curated.actions.map((entry) => entry.id),
    problems,
    notes,
    code,
  };
}
