import { readFileSync, realpathSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import {
  areasOf,
  fromJson,
  MAX_SOURCES,
  rankAreas,
  selectSubset,
  toJson,
} from '@plurid/aptuitive-core';
import type { AnyContract } from '@plurid/aptuitive-core';
import { limits, outputSchema, size } from '@plurid/aptuitive-planner/schema';
import { createJiti } from 'jiti';
import { folderOf } from './folder.js';
import { CURATE_ACTIONS, CURATE_SOURCES } from './survey.js';

/** Where the contract is, in a project that keeps Aptuitive's files in `aptuitive/`; commands use the project's own folder (`folderOf`). */
export const CONTRACT = 'aptuitive/contract.ts';
/** Where the bindings are, in a project that keeps Aptuitive's files in `aptuitive/`; commands use the project's own folder (`folderOf`). */
export const BINDINGS = 'aptuitive/bindings.ts';

/** What one request's schema may hold, so Claude's structured outputs accept it. */
export const SCHEMA_LIMITS = { bytes: 60_000, optional: 0, unions: 1, enum: 400 } as const;

/**
 * What `check` reads: the project, and where its contract and bindings are when they aren't in the
 * Aptuitive folder.
 */
export interface CheckOptions {
  /** The project's root. @default process.cwd() */
  cwd?: string;
  /** The contract module. @default 'contract.ts' in the project's Aptuitive folder */
  contract?: string;
  /** The bindings module. @default 'bindings.ts' in the project's Aptuitive folder */
  bindings?: string;
}

/** One check: its name, whether it passed, and what it found. */
export interface Check {
  /** The check: `contract`, `json`, `schemas` or `bindings`. */
  name: string;
  /** Whether it passed. */
  ok: boolean;
  /** What it found, or what to fix. */
  detail: string;
}

/**
 * How much of the application the contract covers: sources, actions, routes, pages, regions, lists
 * and choices.
 */
export interface Coverage {
  /** Sources declared. */
  sources: number;
  /** Actions declared. */
  actions: number;
  /** Actions with an effect, which run through `perform` after confirmation. */
  runnable: number;
  /** Whether the bindings export `perform`, which interface actions may use too. */
  performs: boolean;
  /** Routes declared. */
  routes: number;
  /** Pages people can redesign. */
  pages: number;
  /** Regions: parts of the application as it already is. */
  regions: number;
  /** Lists, such as toolbars and menus. */
  lists: number;
  /** Choices, such as a theme. */
  choices: number;
}

/** What `check` found: whether the integration holds, each check, warnings, and coverage. */
export interface CheckResult {
  /** Whether every check passed. */
  ok: boolean;
  /** Each check, in order. */
  checks: Check[];
  /** Worth fixing, but nothing breaks. */
  warnings: string[];
  /** What the contract covers, once it loads. */
  coverage?: Coverage;
}

/** The zod a folder's imports resolve to, or nothing. */
function zodFrom(folder: string): { path: string; version: string } | undefined {
  try {
    const manifest = createRequire(join(folder, 'index.js')).resolve('zod/package.json');
    const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string };
    return { path: realpathSync(dirname(manifest)), version };
  } catch {
    return undefined;
  }
}

/** The folder of the core package the project's imports resolve to, or nothing. */
function coreFrom(cwd: string): string | undefined {
  try {
    let folder = dirname(createRequire(join(cwd, 'index.js')).resolve('@plurid/aptuitive-core'));
    while (folder !== dirname(folder)) {
      const manifest = join(folder, 'package.json');
      try {
        if (
          (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name ===
          '@plurid/aptuitive-core'
        ) {
          return folder;
        }
      } catch {
        // No package.json at this level: keep climbing.
      }
      folder = dirname(folder);
    }
  } catch {
    // Core isn't installed where the project can import it.
  }
  return undefined;
}

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const isContract = (value: unknown): value is AnyContract =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as AnyContract).hash === 'string' &&
  Array.isArray((value as AnyContract).sourceIds);

/** Loads a TypeScript module from the project, as the project would, tsconfig `paths` included. */
export async function loadModule(path: string): Promise<Record<string, unknown>> {
  // The project's own path aliases resolve as its build resolves them.
  const jiti = createJiti(path, {
    moduleCache: false,
    fsCache: false,
    jsx: true,
    tsconfigPaths: true,
  });
  return (await jiti.import(path)) as Record<string, unknown>;
}

/** The contract a module exports: `contract`, the default export, or the only contract. */
export function contractIn(module: Record<string, unknown>): AnyContract | undefined {
  if (isContract(module.contract)) return module.contract;
  if (isContract(module.default)) return module.default;
  const found = Object.values(module).filter(isContract);
  return found.length === 1 ? found[0] : undefined;
}

/**
 * Checks an integration: the contract loads and validates, its JSON round-trips, every schema a
 * request can need fits structured outputs, labels find what they name, and bindings exist for
 * what the contract declares.
 */
export async function check(options: CheckOptions = {}): Promise<CheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const checks: Check[] = [];
  const warnings: string[] = [];
  const pass = (name: string, detail: string) => checks.push({ name, ok: true, detail });
  const fail = (name: string, detail: string) => checks.push({ name, ok: false, detail });
  const done = (coverage?: Coverage): CheckResult => ({
    ok: checks.every((entry) => entry.ok),
    checks,
    warnings,
    ...(coverage ? { coverage } : {}),
  });

  const folder = await folderOf(cwd);
  const contractName = options.contract ?? `${folder}/contract.ts`;
  const contractPath = resolve(cwd, contractName);
  if (!(await exists(contractPath))) {
    fail('contract', `${contractName} not found; run \`aptuitive init\` first`);
    return done();
  }
  let contract: AnyContract | undefined;
  try {
    contract = contractIn(await loadModule(contractPath));
  } catch (error) {
    fail('contract', (error as Error).message);
    return done();
  }
  if (!contract) {
    fail(
      'contract',
      'the module exports no contract: export one made with defineApp as `contract`',
    );
    return done();
  }
  pass(
    'contract',
    `${contract.id} ${contract.version}: ${contract.sourceIds.length} sources, ${contract.actionIds.length} actions, ${contract.surfaceIds.length} surfaces`,
  );

  try {
    const json = toJson(contract);
    const again = fromJson(json, {});
    const same = JSON.stringify(toJson(again)) === JSON.stringify(json);
    if (again.hash === contract.hash && same)
      pass('json', `round-trips (${JSON.stringify(json).length} bytes)`);
    else
      fail(
        'json',
        'the contract changes when read back from JSON; keep its zod schemas to the supported subset',
      );
  } catch (error) {
    fail('json', (error as Error).message);
  }

  // Each request plans over a subset; check the schema of every subset a page can start from.
  const subsets =
    contract.sourceIds.length <= MAX_SOURCES
      ? [{ name: 'whole contract', subset: undefined }]
      : contract.sourceIds.map((id) => ({
          name: id,
          subset: selectSubset(contract, { inView: [id] }),
        }));
  const over: string[] = [];
  let largest = 0;
  for (const { name, subset } of subsets) {
    try {
      const schema = outputSchema(contract, subset ? { subset } : {});
      const counted = limits(schema);
      const measured = size(schema);
      largest = Math.max(largest, measured.bytes);
      const problems = [
        counted.optional > SCHEMA_LIMITS.optional ? `${counted.optional} optional fields` : '',
        counted.unions > SCHEMA_LIMITS.unions ? `${counted.unions} unions` : '',
        measured.bytes > SCHEMA_LIMITS.bytes ? `${measured.bytes} bytes` : '',
        measured.largestEnum > SCHEMA_LIMITS.enum ? `an enum of ${measured.largestEnum}` : '',
      ].filter(Boolean);
      if (problems.length > 0) over.push(`${name}: ${problems.join(', ')}`);
    } catch (error) {
      over.push(`${name}: ${(error as Error).message}`);
    }
  }
  if (over.length === 0) {
    pass('schemas', `${subsets.length} request schemas fit; the largest is ${largest} bytes`);
  } else {
    fail('schemas', over.join('; '));
  }

  // Labels are how people and the planner find things.
  const labels = new Map<string, string[]>();
  for (const id of contract.actionIds) {
    const label = contract.actions[id]?.label.trim().toLowerCase() ?? '';
    labels.set(label, [...(labels.get(label) ?? []), id]);
  }
  const repeated = [...labels].filter(([, ids]) => ids.length > 1);
  if (repeated.length > 0) {
    warnings.push(
      `Actions share labels, so people can't tell them apart: ${repeated
        .slice(0, 5)
        .map(([label, ids]) => `"${label}" (${ids.join(', ')})`)
        .join('; ')}${repeated.length > 5 ? `; and ${repeated.length - 5} more` : ''}.`,
    );
  }
  const areas = areasOf(contract);
  const lost = contract.sourceIds.filter((id) => {
    const label = contract.source(id)?.label ?? id;
    return !rankAreas(areas, label)
      .slice(0, 3)
      .some((area) => area.source === id);
  });
  if (lost.length > 0) {
    warnings.push(
      `Sources not found by their own labels (give them distinct labels or keywords): ${lost.join(', ')}.`,
    );
  }
  if (contract.sourceIds.length > CURATE_SOURCES || contract.actionIds.length > CURATE_ACTIONS) {
    warnings.push(
      `${contract.sourceIds.length} sources and ${contract.actionIds.length} actions; past ${CURATE_SOURCES} and ${CURATE_ACTIONS}, planning gets worse. Curate.`,
    );
  }
  for (const id of contract.sourceIds) {
    const fields = contract.source(id)?.fields.length ?? 0;
    if (fields > 40) warnings.push(`${id} has ${fields} fields; keep sources to 40.`);
  }

  // Aptuitive shares the application's zod; two copies type-check against each other badly.
  const core = coreFrom(cwd);
  const ours = zodFrom(cwd);
  const theirs = core ? zodFrom(core) : undefined;
  if (ours && theirs && ours.path !== theirs.path) {
    warnings.push(
      `Two copies of zod: the application's ${ours.version} and Aptuitive's ${theirs.version}. Schemas from one don't type-check against the other; install one zod, 4.2 or later.`,
    );
  }

  const runnable = contract.actionIds.filter((id) => contract.actions[id]?.effect !== undefined);
  const bindingsName = options.bindings ?? `${folder}/bindings.ts`;
  const bindingsPath = resolve(cwd, bindingsName);
  const needs = [
    ...(contract.sourceIds.length > 0 ? ['fetch'] : []),
    ...(runnable.length > 0 ? ['perform'] : []),
  ];
  let performs = false;
  if (!(await exists(bindingsPath))) {
    if (needs.length === 0) pass('bindings', 'nothing needs binding yet');
    else fail('bindings', `${bindingsName} not found; it binds ${needs.join(' and ')}`);
  } else {
    try {
      const module = await loadModule(bindingsPath);
      const bindings = (module.bindings ?? module.default) as Record<string, unknown> | undefined;
      const bound = ['fetch', 'perform', 'navigate'].filter(
        (name) => typeof bindings?.[name] === 'function',
      );
      performs = bound.includes('perform');
      const missing = needs.filter((name) => !bound.includes(name));
      if (missing.length > 0) fail('bindings', `export \`bindings\` with ${missing.join(' and ')}`);
      else
        pass(
          'bindings',
          bound.length > 0 ? `${bound.join(', ')} bound` : 'nothing needs binding yet',
        );
    } catch (error) {
      fail('bindings', (error as Error).message);
    }
  }

  const kinds = (kind: string) =>
    contract.surfaceIds.filter((id) => contract.surfaces[id]?.kind === kind).length;
  return done({
    sources: contract.sourceIds.length,
    actions: contract.actionIds.length,
    runnable: runnable.length,
    performs,
    routes: contract.routeIds.length,
    pages: kinds('page'),
    regions: Object.keys(contract.regions).length,
    lists: kinds('list'),
    choices: kinds('choice'),
  });
}

/** A check's result as text, one line per check, with coverage and warnings. */
export function checkText(result: CheckResult): string {
  const lines = result.checks.map(
    (entry) => `${entry.ok ? 'ok  ' : 'FAIL'}  ${entry.name}: ${entry.detail}`,
  );
  for (const warning of result.warnings) lines.push(`warn  ${warning}`);
  if (result.coverage) {
    const c = result.coverage;
    lines.push(
      '',
      `Coverage: ${c.sources} sources; ${c.actions} actions, ${c.runnable} with effects${c.performs ? ', all able to run through perform' : ''}; ${c.routes} routes, ${c.pages} pages, ${c.regions} regions, ${c.lists} lists, ${c.choices} choices.`,
    );
  }
  lines.push('', result.ok ? 'All checks pass.' : 'Some checks fail.');
  return lines.join('\n');
}
