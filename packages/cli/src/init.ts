import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { detect } from './detect.js';
import type { Detection } from './detect.js';
import { formatLikeProject } from './format.js';
import { FOLDER, folderOf, normalizeFolder, within } from './folder.js';
import { generateSources, surveySpec } from './generate.js';
import { kebab } from './openapi.js';
import { CURATE_ACTIONS, CURATE_SOURCES } from './survey.js';
import {
  bindingsTemplate,
  clientTemplate,
  contractTemplate,
  kitTemplate,
  nextRouteTemplate,
  serverTemplate,
  SKILL,
} from './templates.js';

/** What `init` takes: the project, where its files go, the API description, and how to install. */
export interface InitOptions {
  /** The project's root. @default process.cwd() */
  cwd?: string;
  /** The API description to generate from; else the first one found. */
  openapi?: string;
  /** Installs the packages with the project's package manager. @default true */
  install?: boolean;
  /** Configures the coding agents found: MCP servers and the integration skill. @default true */
  agents?: boolean;
  /**
   * How agents start the MCP server: a command quoted as a shell would read it, or a JSON array
   * of its words.
   * @default 'npx -y @plurid/uitive-mcp'
   */
  mcp?: string;
  /** A folder of package tarballs (`pnpm pack`) to install from, such as a local build. */
  packages?: string;
  /**
   * Where Uitive's files go, relative to the project, such as `app/uitive` for a build that
   * compiles only `app`. Recorded in package.json as `uitive.dir`, where every command reads it.
   * @default the recorded folder, else 'src/uitive' when there is a src folder, else 'uitive'
   */
  dir?: string;
  /**
   * A folder init never reads or writes above or outside, such as the root an MCP server is
   * confined to. The coding agents' configuration goes at the nearest repository root inside
   * it, else at the boundary itself; anything that would land outside is reported in `next`
   * instead of written.
   */
  boundary?: string;
}

/**
 * What `init` did: what it detected, the files it wrote and kept, the install, and what to do next.
 */
export interface InitResult {
  /** What the project uses. */
  detection: Detection;
  /** Files written, relative to the project. */
  written: string[];
  /** Files that existed and were left alone. */
  kept: string[];
  /** The install command, whether it ran, and how it went. */
  install: { command: string; ran: boolean; ok?: boolean; output?: string };
  /** What to do next, in order. */
  next: string[];
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * The package a tarball holds, from pnpm's file name: `plurid-uitive-core-0.1.0.tgz`, or the
 * CLI's `uitive-0.1.0.tgz`.
 */
const packed = (file: string): string | undefined => {
  const scoped = /^plurid-uitive-([a-z]+)-\d.*\.tgz$/.exec(file)?.[1];
  if (scoped) return `@plurid/uitive-${scoped}`;
  return /^uitive-\d.*\.tgz$/.test(file) ? 'uitive' : undefined;
};

/**
 * Sets entries under `overrides` in a pnpm-workspace.yaml, keeping everything else as written:
 * pnpm reads overrides there since version 10, and only there since 11.
 */
export function withOverrides(yaml: string, overrides: Readonly<Record<string, string>>): string {
  const entries = Object.entries(overrides).map(([name, value]) => `  '${name}': ${value}`);
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => /^overrides:\s*(\{\s*\})?\s*$/.test(line));
  if (start === -1) {
    const body = yaml.trimEnd();
    return `${body}${body ? '\n\n' : ''}overrides:\n${entries.join('\n')}\n`;
  }
  let end = start + 1;
  while (end < lines.length && /^(\s|$)/.test(lines[end] ?? '')) end++;
  const kept = lines.slice(start + 1, end).filter((line) => {
    const key = /^\s+['"]?([^'":]+)['"]?\s*:/.exec(line)?.[1];
    return key === undefined || !(key in overrides);
  });
  return [...lines.slice(0, start), 'overrides:', ...entries, ...kept, ...lines.slice(end)].join(
    '\n',
  );
}

/**
 * The packages a project needs: React bindings or the DOM package, a server package only with a
 * server, and zod, which Uitive shares with the application, unless it has it already.
 */
function wanted(detection: Detection, existing: ReadonlySet<string>) {
  return {
    runtime: [
      '@plurid/uitive-core',
      ...(existing.has('zod') ? [] : ['zod']),
      detection.ui?.name === 'react' ? '@plurid/uitive-react' : '@plurid/uitive-dom',
      ...(detection.server ? ['@plurid/uitive-server'] : []),
    ],
    dev: ['uitive'],
  };
}

// One collation everywhere, so dependencies sort the same on every machine, whatever its locale.
const collator = new Intl.Collator('en');
const sorted = (record: Record<string, string>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => collator.compare(a, b)));

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  resolutions?: Record<string, string>;
  overrides?: Record<string, string>;
  pnpm?: { overrides?: Record<string, string> } & Record<string, unknown>;
  workspaces?: unknown;
  [key: string]: unknown;
}

/** The folder whose package.json the package manager reads overrides from: the workspace root. */
async function workspaceRoot(
  root: string,
  repository: string,
  boundary: string | undefined,
): Promise<string> {
  for (let directory = root; ; directory = dirname(directory)) {
    if (boundary !== undefined && !(await within(boundary, directory))) return root;
    const manifest = await readFile(join(directory, 'package.json'), 'utf8').then(
      (text) => JSON.parse(text) as Manifest,
      () => undefined,
    );
    if (manifest?.workspaces || (await exists(join(directory, 'pnpm-workspace.yaml')))) {
      return directory;
    }
    if (directory === repository || dirname(directory) === directory) return root;
  }
}

/**
 * Points the project at local tarballs: its direct dependencies, and through the package
 * manager's overrides the packages those need, so nothing is looked for in a registry that
 * doesn't have it yet.
 */
async function useTarballs(
  root: string,
  detection: Detection,
  folder: string,
  packages: ReturnType<typeof wanted>,
  save: (file: string, content: string) => Promise<boolean>,
  boundary: string | undefined,
): Promise<string[]> {
  const files = (await readdir(folder)).filter((name) => packed(name)).sort();
  if (files.length === 0) throw new Error(`No Uitive tarballs in ${folder}`);
  // Paths relative to each package.json, so the project stays movable.
  const from = (base: string) =>
    new Map(
      files.map((name) => {
        const path = relative(base, resolve(folder, name));
        return [packed(name) ?? '', `file:${path.startsWith('.') ? path : `./${path}`}`];
      }),
    );
  const tarballs = from(root);
  const read = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Manifest;
  const own = await read(join(root, 'package.json'));
  const dependencies = { ...own.dependencies };
  const devDependencies = { ...own.devDependencies };
  for (const name of packages.runtime) {
    dependencies[name] = name === 'zod' ? '^4.6.5' : (tarballs.get(name) ?? '*');
  }
  for (const name of packages.dev) {
    const tarball = tarballs.get(name);
    if (tarball) devDependencies[name] = tarball;
  }
  own.dependencies = sorted(dependencies);
  own.devDependencies = sorted(devDependencies);
  // Every tarball, not just what is installed: the packages depend on each other, and any one
  // left to the registry would install another build, or none.
  const top = await workspaceRoot(root, detection.repository, boundary);
  const overrides = Object.fromEntries(from(top));
  const written: string[] = [];
  const shared = top === root ? own : await read(join(top, 'package.json'));
  if (detection.packageManager === 'yarn') {
    shared.resolutions = { ...shared.resolutions, ...overrides };
  } else if (detection.packageManager === 'pnpm' && (await pnpmMajor(detection, root)) >= 10) {
    const file = join(top, 'pnpm-workspace.yaml');
    const yaml = await readFile(file, 'utf8').catch(() => '');
    if (await save(file, withOverrides(yaml, overrides))) written.push(relative(root, file));
  } else if (detection.packageManager === 'pnpm') {
    shared.pnpm = { ...shared.pnpm, overrides: { ...shared.pnpm?.overrides, ...overrides } };
  } else {
    shared.overrides = { ...shared.overrides, ...overrides };
  }
  if (await save(join(root, 'package.json'), `${JSON.stringify(own, null, 2)}\n`)) {
    written.push('package.json');
  }
  const sharedFile = join(top, 'package.json');
  if (top !== root && (await save(sharedFile, `${JSON.stringify(shared, null, 2)}\n`))) {
    written.push(relative(root, sharedFile));
  }
  return written;
}

/** pnpm's major version: the pinned one, else the installed one, else the latest assumed. */
async function pnpmMajor(detection: Detection, cwd: string): Promise<number> {
  const pinned = /^pnpm@(\d+)/.exec(detection.packageManagerPin ?? '')?.[1];
  if (pinned) return Number(pinned);
  const installed = await runPackageManager(detection, ['--version'], cwd);
  return Number(/^(\d+)\./.exec(installed.output.trim())?.[1] ?? 11);
}

/** A word a shell reads as itself: a package name, a version or a flag. */
const SAFE_WORD = /^[\w@./+-]+$/;

/** Runs the package manager the project uses; when it isn't installed, the pinned one through npx. */
async function runPackageManager(
  detection: Detection,
  args: readonly string[],
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  const attempt = (command: string, list: readonly string[]) =>
    new Promise<{ ok: boolean; output: string; missing: boolean }>((done) => {
      // Windows runs package managers' .cmd shims only through its shell, which reads the words
      // as one command line: refuse any word a shell could read as more than a word.
      const windows = process.platform === 'win32';
      const unsafe = [command, ...list].find((word) => !SAFE_WORD.test(word));
      if (windows && unsafe !== undefined) {
        done({
          ok: false,
          output: `Refused to run ${JSON.stringify(unsafe)} through the shell`,
          missing: false,
        });
        return;
      }
      const child = spawn(command, list, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: windows,
      });
      let output = '';
      // Warnings and errors often come first, so they are kept apart from the tail.
      const notable: string[] = [];
      const keep = (chunk: unknown) => {
        const text = String(chunk);
        output = `${output}${text}`.slice(-4000);
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (/\b(WARN|ERR|ERROR)\b/.test(trimmed) && !notable.includes(trimmed)) {
            notable.push(trimmed);
          }
        }
      };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      child.on('error', (error: NodeJS.ErrnoException) =>
        done({ ok: false, output: error.message, missing: error.code === 'ENOENT' }),
      );
      child.on('close', (code) => {
        const early = notable.filter((line) => !output.includes(line)).slice(0, 20);
        done({
          ok: code === 0,
          output: early.length > 0 ? `${early.join('\n')}\n…\n${output}` : output,
          missing: false,
        });
      });
    });
  const first = await attempt(detection.packageManager, args);
  if (!first.missing) return first;
  const pinned = detection.packageManagerPin ?? detection.packageManager;
  const second = await attempt('npx', ['-y', pinned, ...args]);
  return {
    ok: second.ok,
    output:
      second.output ||
      `${detection.packageManager} isn't installed, and npx couldn't run ${pinned}`,
  };
}

/** How the project writes relative imports: with `.js` under Node's module resolution, else bare. */
function importExtension(root: string): '.js' | '' {
  const file = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!file) return '';
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(file, ts.sys.readFile).config,
    ts.sys,
    dirname(file),
  );
  const resolution = config.options.moduleResolution;
  return resolution === ts.ModuleResolutionKind.Node16 ||
    resolution === ts.ModuleResolutionKind.NodeNext
    ? '.js'
    : '';
}

/**
 * Adds an MCP server to a JSON config, keeping everything else in it and its indentation. `add`
 * adds the entry and says whether it did, so one already there, perhaps written by hand, stays as
 * it is. A file that isn't a plain JSON object, such as one with comments, which VS Code allows,
 * is left alone too: writing it back would drop whatever the parser couldn't read.
 */
async function mergeJson(
  path: string,
  add: (value: Record<string, unknown>) => boolean,
  save: (file: string, content: string) => Promise<boolean>,
): Promise<'added' | 'present' | 'unreadable' | 'outside'> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) {
    const value: Record<string, unknown> = {};
    add(value);
    const content = await formatLikeProject(
      `${JSON.stringify(value, null, 2)}\n`,
      path,
      dirname(path),
    );
    return (await save(path, content)) ? 'added' : 'outside';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'unreadable';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'unreadable';
  const value = parsed as Record<string, unknown>;
  if (!add(value)) return 'present';
  const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? '  ';
  const content = `${JSON.stringify(value, null, indent)}${text.endsWith('\n') ? '\n' : ''}`;
  return (await save(path, content)) ? 'added' : 'outside';
}

/** Adds the uitive server under a config's key, unless a server by that name is there already. */
const addServer =
  (key: string, server: Record<string, unknown>) => (value: Record<string, unknown>) => {
    const servers = value[key];
    if (typeof servers === 'object' && servers !== null && 'uitive' in servers) return false;
    value[key] = { ...(servers as object | undefined), uitive: server };
    return true;
  };

/**
 * The words of a command: a JSON array of strings, or a line quoted as a POSIX shell reads it, so
 * a path with spaces can be given in quotes.
 */
export function commandWords(command: string): string[] {
  const text = command.trim();
  if (text.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every((word): word is string => typeof word === 'string')
    ) {
      throw new Error(`The MCP command isn't a JSON array of strings: ${command}`);
    }
    return parsed;
  }
  const words: string[] = [];
  // A word starts with its first character or quote, so "" is a word, and empty.
  let word = '';
  let started = false;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? '';
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
    } else if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === '\\' && /["\\$`]/.test(text[index + 1] ?? '')) word += text[++index];
      else word += char;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      started = true;
      if (char === "'" || char === '"') quote = char;
      else if (char === '\\') word += text[++index] ?? '';
      else word += char;
    }
  }
  if (quote !== undefined) throw new Error(`The MCP command has an unclosed ${quote}: ${command}`);
  if (started) words.push(word);
  if (words.length === 0) throw new Error('The MCP command is empty');
  return words;
}

/** The lowest zod version a dependency allows, such as 4.2 for `^4.2.0`, when anything says. */
function zodVersion(specifier: string, root: string): [number, number] | undefined {
  const range = /^[\s^~>=v]*(\d+)(?:\.(\d+))?/.exec(specifier);
  if (range) return [Number(range[1]), Number(range[2] ?? 0)];
  // `catalog:`, `workspace:*` and `npm:` aliases name no version here: ask the installed one.
  try {
    const manifest = createRequire(join(root, 'package.json')).resolve('zod/package.json');
    const { version = '' } = JSON.parse(readFileSync(manifest, 'utf8')) as {
      version?: string;
    };
    const installed = /^(\d+)\.(\d+)/.exec(version);
    return installed ? [Number(installed[1]), Number(installed[2])] : undefined;
  } catch {
    return undefined;
  }
}

/** Records where Uitive's files go in the project's package.json; says whether it changed it. */
async function recordFolder(
  root: string,
  dir: string,
  save: (file: string, content: string) => Promise<boolean>,
): Promise<{ folder: string; changed: boolean }> {
  const folder = normalizeFolder(dir);
  const path = join(root, 'package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8')) as Manifest & {
    uitive?: { dir?: string };
  };
  if (manifest.uitive?.dir === folder) return { folder, changed: false };
  manifest.uitive = { ...manifest.uitive, dir: folder };
  return { folder, changed: await save(path, `${JSON.stringify(manifest, null, 2)}\n`) };
}

/**
 * Sets Uitive up in a project: packages, a folder (`src/uitive/` or `uitive/`)
 * whose contract starts with every page as a region, sources generated from an API description
 * when one is small enough, and the coding agents' MCP servers and skill, at the repository's
 * root. Never overwrites a file. With a boundary, nothing above or outside it is read or written.
 */
export async function init(options: InitOptions = {}): Promise<InitResult> {
  const boundary = options.boundary === undefined ? undefined : resolve(options.boundary);
  // Read before anything is written, so a command that doesn't parse changes nothing.
  const mcp = options.mcp === undefined ? undefined : commandWords(options.mcp);
  const detection = await detect(options.cwd, boundary === undefined ? {} : { boundary });
  const root = detection.root;
  const written: string[] = [];
  const kept: string[] = [];
  const next: string[] = [];
  const save = async (file: string, content: string) => {
    if (boundary !== undefined && !(await within(boundary, file))) {
      next.push(`Not written: ${relative(root, file)} is outside ${boundary}.`);
      return false;
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
    return true;
  };
  const put = async (path: string, content: string) => {
    const file = join(root, path);
    if (await exists(file)) {
      kept.push(path);
      return;
    }
    const formatted = ['.ts', '.tsx', '.json'].includes(extname(file))
      ? await formatLikeProject(content, file, root)
      : content;
    if (await save(file, formatted)) written.push(path);
  };
  if (detection.workspaces.length > 0) {
    next.push(
      `This is a workspace root: run init in the package with the interface instead, such as ${detection.workspaces[0]?.path}.`,
    );
  }
  // Inside src when there is one, so the build, its typecheck and tools such as Tailwind see it.
  let folder = options.dir ? normalizeFolder(options.dir) : await folderOf(root);
  if (
    !options.dir &&
    folder === FOLDER &&
    !(await exists(join(root, FOLDER, 'contract.ts'))) &&
    (await exists(join(root, 'src')))
  ) {
    folder = 'src/uitive';
  }
  if (boundary !== undefined && !(await within(boundary, join(root, folder)))) {
    throw new Error(`The folder for Uitive's files, ${folder}, is outside ${boundary}`);
  }
  if (options.dir || folder !== FOLDER) {
    if ((await recordFolder(root, folder, save)).changed) written.push('package.json');
  }
  const curation = `${folder}/curation.json`;

  const spec = options.openapi ?? detection.openapi[0];
  let generated = await exists(join(root, folder, 'api.generated.ts'));
  let server = '';
  if (spec && !generated) {
    const found = await surveySpec({ spec, cwd: root });
    server = found.server;
    const large = found.counts.sources > CURATE_SOURCES || found.counts.actions > CURATE_ACTIONS;
    if (large && !(await exists(join(root, curation)))) {
      await put(
        curation,
        `${JSON.stringify(
          {
            default: 'exclude',
            sources: Object.fromEntries(
              found.sources.map((entry) => [entry.id, { include: false }]),
            ),
            actions: {},
          },
          null,
          2,
        )}\n`,
      );
      next.push(
        `Choose what the frontend shows in ${curation} (set "include": true), then run \`uitive generate sources --openapi ${spec}\` and spread \`sources\` and \`actions\` into the contract.`,
      );
    } else {
      const out = join(root, folder, 'api.generated.ts');
      const allowed = boundary === undefined || (await within(boundary, out));
      const result = await generateSources({ spec, cwd: root, out, dryRun: !allowed });
      generated = result.written;
      if (result.written) written.push(result.file);
      else if (!allowed) next.push(`Not written: ${result.file} is outside ${boundary}.`);
      else next.push(...result.problems);
    }
  } else if (!spec) {
    next.push(
      `No API description found: declare sources in ${folder}/contract.ts and bind them in ${folder}/bindings.ts.`,
    );
  }

  const extension = importExtension(root);
  const id = kebab(detection.name.replace(/^@[^/]+\//, '')) || 'app';
  await put(
    `${folder}/contract.ts`,
    contractTemplate({
      id,
      description: `The ${detection.name || 'application'} interface`,
      generated,
      extension,
    }),
  );
  await put(`${folder}/bindings.ts`, bindingsTemplate(generated, server, extension));
  await put(`${folder}/client.ts`, clientTemplate(id, extension, detection.server));
  if (detection.ui?.name === 'react') {
    await put(`${folder}/kit.tsx`, kitTemplate(detection.designSystems[0]?.name));
  }
  if (detection.server) {
    await put(`${folder}/server.ts`, serverTemplate(extension));
    if (detection.framework?.name === 'next') {
      const app = (await exists(join(root, 'src', 'app'))) ? 'src/app' : 'app';
      // One route for both: the client posts to /api/uitive/plan and /api/uitive/command.
      const route = `${app}/api/uitive/[kind]/route.ts`;
      const target = relative(dirname(join(root, route)), join(root, folder, 'server'));
      await put(
        route,
        nextRouteTemplate(`${target.startsWith('.') ? target : `./${target}`}${extension}`),
      );
    } else {
      next.push(
        `Mount the \`handler\` from ${folder}/server.ts at /api/uitive in the application's server; in Express, app.use('/api/uitive', toNodeListener(handler)) with toNodeListener from @plurid/uitive-server/node.`,
      );
    }
  } else {
    next.push(
      'No server found, so the client plans with the deterministic planner: commands such as "hide …", "pin …" and choice values work without a key. For model planning, mount @plurid/uitive-server\'s handler in a backend and switch the client to remotePlanner.',
    );
  }

  if (options.agents ?? true) {
    // Agents run at the repository's root, so their configuration goes there. Codex, found by its
    // AGENTS.md, has nothing init can write; with none of the agents it can configure, Claude Code
    // is set up, as the default.
    const top = detection.repository;
    if (boundary !== undefined && top === boundary && !(await exists(join(top, '.git')))) {
      next.push(
        `No repository root inside ${boundary}, so the coding agents' configuration goes there, where the MCP server works; nothing above it is read or written.`,
      );
    }
    const configurable = detection.agents.filter((agent) => agent !== 'codex');
    const claude = configurable.includes('claude-code') || configurable.length === 0;
    const deferred = options.packages !== undefined && !options.mcp;
    if (configurable.length === 0) {
      const found =
        detection.agents.length === 0
          ? 'No coding agents found'
          : "Only Codex found, which init can't configure";
      next.push(
        deferred
          ? `${found}, so Claude Code is configured: the integrate-uitive skill.`
          : `${found}, so Claude Code is configured: .mcp.json and the integrate-uitive skill.`,
      );
    }
    const shown = (path: string) => relative(root, join(top, path)) || path;
    if (deferred) {
      next.push(
        'With local packages, the MCP server is left unconfigured: pass --mcp "node <repository>/packages/mcp/dist/bin.js" to configure it.',
      );
    } else {
      const [command = 'npx', ...args] = mcp ?? ['npx', '-y', '@plurid/uitive-mcp'];
      const stdio = { command, args };
      const merge = async (path: string, add: (value: Record<string, unknown>) => boolean) => {
        const outcome = await mergeJson(join(top, path), add, save);
        if (outcome === 'added') written.push(shown(path));
        if (outcome === 'present' || outcome === 'unreadable') kept.push(shown(path));
        if (outcome === 'unreadable') {
          next.push(
            `Add the uitive MCP server to ${shown(path)} by hand: it isn't plain JSON, so init left it as it was.`,
          );
        }
      };
      if (claude) await merge('.mcp.json', addServer('mcpServers', stdio));
      if (detection.agents.includes('cursor')) {
        await merge('.cursor/mcp.json', addServer('mcpServers', stdio));
      }
      if (detection.agents.includes('vscode')) {
        await merge('.vscode/mcp.json', addServer('servers', { type: 'stdio', ...stdio }));
      }
    }
    if (claude)
      await put(relative(root, join(top, '.claude/skills/integrate-uitive/SKILL.md')), SKILL);
  }

  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Manifest;
  const existing = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  const packages = wanted(detection, existing);
  const zod = manifest.dependencies?.zod ?? manifest.devDependencies?.zod;
  const [major, minor] = (zod === undefined ? undefined : zodVersion(zod, root)) ?? [4, 2];
  if (major < 4 || (major === 4 && minor < 2)) {
    next.push(
      `Uitive shares zod with the application and needs 4.2 or later; this project has ${zod}, so upgrade it first.`,
    );
  }
  const add = detection.packageManager === 'npm' ? 'install' : 'add';
  const dev = detection.packageManager === 'npm' ? '--save-dev' : '-D';
  let steps: string[][] = [
    [add, ...packages.runtime],
    [add, dev, ...packages.dev],
  ];
  if (options.packages && !detection.uitive) {
    const tarballs = resolve(root, options.packages);
    written.push(...(await useTarballs(root, detection, tarballs, packages, save, boundary)));
    steps = [['install']];
  }
  const pm = detection.packageManagerPin ?? detection.packageManager;
  const command = steps.map((step) => `${detection.packageManager} ${step.join(' ')}`).join(' && ');
  const install: InitResult['install'] = { command, ran: false };
  if ((options.install ?? true) && !detection.uitive) {
    install.ran = true;
    for (const step of steps) {
      const result = await runPackageManager(detection, step, root);
      install.ok = result.ok;
      if (!result.ok) {
        install.output = result.output;
        next.unshift(
          `Installing failed (${pm} ${step.join(' ')}); the last of its output is in install.output.`,
        );
        break;
      }
    }
  } else if (!detection.uitive) {
    next.unshift(`Install the packages: ${command}`);
  }
  next.push(
    detection.ui?.name === 'react'
      ? 'Wrap the application in <UitiveProvider client={uitive} kit={kit}> with <Confirmations />, and render each route through <Page> with the page as a region; the integrate-uitive skill has the steps.'
      : 'Without React, use @plurid/uitive-dom: call startUitive(uitive) at startup, mark lists with data-uitive-list and their items with data-uitive-item, and place <uitive-ask>, <uitive-banner>, <uitive-more> and <uitive-confirm>; the integrate-uitive skill has the steps.',
    'Run `uitive check`.',
  );
  return { detection, written: [...new Set(written)], kept, install, next };
}

/** What `init` did, as text: the files, the install and the next steps. */
export function initText(result: InitResult): string {
  return [
    ...result.written.map((path) => `wrote  ${path}`),
    ...result.kept.map((path) => `kept   ${path} (exists)`),
    result.install.ran
      ? `${result.install.ok ? 'installed' : 'install failed'}: ${result.install.command}`
      : '',
    ...(result.install.output
      ? ['', result.install.output.trim().split('\n').slice(-12).join('\n')]
      : []),
    '',
    'Next:',
    ...result.next.map((step, index) => `  ${index + 1}. ${step}`),
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');
}
