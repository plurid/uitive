import { access, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { folderOf } from './folder.js';

/** Something detection found, such as a framework, with its version. */
export interface Detected {
  /** The package or tool, such as `next`. */
  name: string;
  /** Its version, when the manifest says. */
  version?: string;
}

/**
 * What a project uses: its package manager, interface, framework, router, design systems, API
 * descriptions, coding agents and workspace.
 */
export interface Detection {
  /** The package's folder, where Aptuitive is set up. */
  root: string;
  /** The package's name. */
  name: string;
  /** The package manager its lockfile shows. */
  packageManager: 'pnpm' | 'yarn' | 'npm' | 'bun';
  /** Whether it uses TypeScript. */
  typescript: boolean;
  /** Its interface library, such as React. */
  ui: Detected | null;
  /** Its framework, such as Next.js or Vite. */
  framework: Detected | null;
  /** Its router, such as React Router. */
  router: Detected | null;
  /** Component libraries and styling, such as `@medusajs/ui` or `shadcn`. */
  designSystems: Detected[];
  /** API descriptions found in the project, relative to its root. */
  openapi: string[];
  /** Coding agents the project is set up for, so `init` can configure them. */
  agents: ('claude-code' | 'cursor' | 'vscode' | 'codex')[];
  /** Whether Aptuitive is already set up. */
  aptuitive: boolean;
  /** The pinned package manager, such as `yarn@1.22.22`, from `packageManager`. */
  packageManagerPin: string | null;
  /** The repository's root, where coding agents run: the nearest folder with `.git`. */
  repository: string;
  /** For a workspace root: its packages with an interface, where Aptuitive belongs. */
  workspaces: { path: string; name: string; ui: Detected | null; framework: Detected | null }[];
  /** Whether the application has its own server, where the model planner can run. */
  server: boolean;
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const UIS = [
  ['react', 'react'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['solid-js', 'solid'],
  ['@angular/core', 'angular'],
  ['preact', 'preact'],
  ['lit', 'lit'],
  ['grainjs', 'grainjs'],
  ['knockout', 'knockout'],
] as const;
const FRAMEWORKS = [
  ['next', 'next'],
  ['@remix-run/react', 'remix'],
  ['@react-router/dev', 'react-router'],
  ['astro', 'astro'],
  ['nuxt', 'nuxt'],
  ['@sveltejs/kit', 'sveltekit'],
  ['vite', 'vite'],
  ['react-scripts', 'create-react-app'],
] as const;
const ROUTERS = [
  ['next', 'next'],
  ['react-router-dom', 'react-router'],
  ['react-router', 'react-router'],
  ['@tanstack/react-router', 'tanstack-router'],
  ['wouter', 'wouter'],
  ['vue-router', 'vue-router'],
] as const;
const DESIGN_SYSTEMS = [
  '@medusajs/ui',
  '@mui/material',
  '@chakra-ui/react',
  'antd',
  '@mantine/core',
  '@radix-ui/themes',
  '@shopify/polaris',
  '@primer/react',
  '@fluentui/react-components',
  '@carbon/react',
  'react-bootstrap',
  'tailwindcss',
] as const;

async function findSpecs(root: string): Promise<string[]> {
  const found: string[] = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'legacy']);
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 4 || found.length >= 10) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name) && !entry.name.startsWith('.')) await walk(path, depth + 1);
      } else if (/^(openapi|swagger)([.-][\w.-]+)?\.(ya?ml|json)$/i.test(entry.name)) {
        found.push(relative(root, path));
      }
    }
  };
  await walk(root, 0);
  return found.sort();
}

const FULL_STACK = new Set(['next', 'remix', 'react-router', 'astro', 'nuxt', 'sveltekit']);
const SERVERS = ['express', 'fastify', 'koa', 'hono', '@nestjs/core', '@medusajs/framework'];

async function manifestOf(folder: string): Promise<Record<string, unknown> | undefined> {
  return readFile(join(folder, 'package.json'), 'utf8').then(
    (text) => JSON.parse(text) as Record<string, unknown>,
    () => undefined,
  );
}

const dependenciesOf = (manifest: Record<string, unknown>): Record<string, string> => ({
  ...(manifest.devDependencies as Record<string, string> | undefined),
  ...(manifest.peerDependencies as Record<string, string> | undefined),
  ...(manifest.dependencies as Record<string, string> | undefined),
});

function pick(
  table: readonly (readonly [string, string])[],
  dependencies: Record<string, string>,
): Detected | null {
  const hit = table.find(([name]) => dependencies[name] !== undefined);
  if (!hit) return null;
  const found = dependencies[hit[0]]?.replace(/^[^\d]*/, '');
  return { name: hit[1], ...(found ? { version: found } : {}) };
}

/** A workspace's package folders, from simple patterns such as `packages/*` and `app`. */
async function workspaceFolders(
  root: string,
  manifest: Record<string, unknown>,
): Promise<string[]> {
  const declared = manifest.workspaces as unknown;
  let patterns: string[] = Array.isArray(declared)
    ? declared.map(String)
    : Array.isArray((declared as { packages?: unknown } | undefined)?.packages)
      ? (declared as { packages: unknown[] }).packages.map(String)
      : [];
  if (patterns.length === 0) {
    const yaml = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8').catch(() => '');
    patterns = [...yaml.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map(
      (match) => match[1] ?? '',
    );
  }
  const folders: string[] = [];
  for (const pattern of patterns.filter((entry) => entry !== '' && !entry.startsWith('!'))) {
    if (pattern.endsWith('/*')) {
      const base = join(root, pattern.slice(0, -2));
      const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) if (entry.isDirectory()) folders.push(join(base, entry.name));
    } else if (!pattern.includes('*')) {
      folders.push(join(root, pattern));
    }
  }
  return folders;
}

/** What a project uses: everything `init` needs to set Aptuitive up to fit. */
export async function detect(cwd: string = process.cwd()): Promise<Detection> {
  const root = resolve(cwd);
  const manifest = await manifestOf(root);
  if (!manifest)
    throw new Error(`No package.json in ${root}; run this in the application's package`);
  const dependencies = dependenciesOf(manifest);
  const first = (table: readonly (readonly [string, string])[]) => pick(table, dependencies);

  // The repository's root is where coding agents run, and where their configuration belongs.
  let repository = root;
  for (let directory = root, depth = 0; depth < 8; depth++) {
    if (await exists(join(directory, '.git'))) {
      repository = directory;
      break;
    }
    const parent = resolve(directory, '..');
    if (parent === directory) break;
    directory = parent;
  }

  // The nearest lockfile says which package manager the project uses, up to its workspace root.
  let packageManager: Detection['packageManager'] = 'npm';
  for (let directory = root, depth = 0; depth < 6; depth++) {
    if (await exists(join(directory, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
    else if (await exists(join(directory, 'yarn.lock'))) packageManager = 'yarn';
    else if (
      (await exists(join(directory, 'bun.lockb'))) ||
      (await exists(join(directory, 'bun.lock')))
    ) {
      packageManager = 'bun';
    } else if (await exists(join(directory, 'package-lock.json'))) packageManager = 'npm';
    else {
      const parent = resolve(directory, '..');
      if (parent === directory || directory === repository) break;
      directory = parent;
      continue;
    }
    break;
  }
  let packageManagerPin: string | null = null;
  for (let directory = root; ; directory = resolve(directory, '..')) {
    const found = await manifestOf(directory);
    if (typeof found?.packageManager === 'string') {
      packageManagerPin = found.packageManager.split('+')[0] ?? null;
      break;
    }
    if (directory === repository || resolve(directory, '..') === directory) break;
  }

  const designSystems: Detected[] = DESIGN_SYSTEMS.flatMap((name) => {
    const found = dependencies[name]?.replace(/^[^\d]*/, '');
    return dependencies[name] === undefined ? [] : [{ name, ...(found ? { version: found } : {}) }];
  });
  if (await exists(join(root, 'components.json'))) designSystems.push({ name: 'shadcn' });

  const places = [...new Set([root, repository])];
  const anywhere = async (...names: string[]) => {
    for (const place of places) {
      for (const name of names) if (await exists(join(place, name))) return true;
    }
    return false;
  };
  const agents: Detection['agents'] = [];
  if (await anywhere('.claude', 'CLAUDE.md', '.mcp.json')) agents.push('claude-code');
  if (await anywhere('.cursor')) agents.push('cursor');
  if (await anywhere('.vscode')) agents.push('vscode');
  if (await anywhere('AGENTS.md', '.codex')) agents.push('codex');

  const workspaces: Detection['workspaces'] = [];
  for (const folder of await workspaceFolders(root, manifest)) {
    const found = await manifestOf(folder);
    if (!found) continue;
    const ui = pick(UIS, dependenciesOf(found));
    if (!ui) continue;
    workspaces.push({
      path: relative(root, folder),
      name: typeof found.name === 'string' ? found.name : relative(root, folder),
      ui,
      framework: pick(FRAMEWORKS, dependenciesOf(found)),
    });
  }

  const framework = first(FRAMEWORKS);
  return {
    root,
    name: typeof manifest.name === 'string' ? manifest.name : '',
    packageManager,
    packageManagerPin,
    repository,
    typescript:
      dependencies.typescript !== undefined || (await exists(join(root, 'tsconfig.json'))),
    ui: first(UIS),
    framework,
    router: first(ROUTERS),
    designSystems,
    openapi: await findSpecs(root),
    agents,
    aptuitive:
      dependencies['@plurid/aptuitive-core'] !== undefined ||
      (await exists(join(root, await folderOf(root), 'contract.ts'))),
    workspaces,
    server:
      (framework !== null && FULL_STACK.has(framework.name)) ||
      SERVERS.some((name) => dependencies[name] !== undefined),
  };
}

/** A detection as text, one line per finding. */
export function detectText(found: Detection): string {
  const named = (value: Detected | null) =>
    value ? `${value.name}${value.version ? ` ${value.version}` : ''}` : 'none found';
  const lines = [
    `${found.name || 'This project'} (${found.root})`,
    `  package manager  ${found.packageManager}${found.packageManagerPin && !found.packageManagerPin.startsWith(`${found.packageManager}@`) ? ` (package.json pins ${found.packageManagerPin}; the lockfile wins)` : ''}`,
    `  ui               ${named(found.ui)}`,
    `  framework        ${named(found.framework)}`,
    `  router           ${named(found.router)}`,
    `  design system    ${found.designSystems.map((entry) => named(entry)).join(', ') || 'none found'}`,
    `  typescript       ${found.typescript ? 'yes' : 'no'}`,
    `  server           ${found.server ? 'yes: the model planner can run in it' : 'none found: plan with the deterministic planner, or add the handler to a backend'}`,
    `  API description  ${found.openapi.join(', ') || 'none found'}`,
    `  coding agents    ${found.agents.join(', ') || 'none found'}${found.repository === found.root ? '' : ` (at ${found.repository})`}`,
    `  aptuitive        ${found.aptuitive ? 'set up' : 'not set up'}`,
  ];
  if (found.workspaces.length > 0) {
    lines.push(
      '',
      'This is a workspace root. Set Aptuitive up in the package with the interface:',
      ...found.workspaces.map(
        (entry) =>
          `  ${entry.path} (${entry.name}): ${named(entry.ui)}${entry.framework ? `, ${named(entry.framework)}` : ''}`,
      ),
    );
  }
  return lines.join('\n');
}
