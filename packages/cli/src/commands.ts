import { parseArgs } from 'node:util';
import { generateBlocks } from './blocks.js';
import { check, checkText } from './check.js';
import { detect, detectText } from './detect.js';
import { discover } from './discover.js';
import { discoveryText } from '@plurid/aptuitive-adapter';
import { generateSources, surveySpec } from './generate.js';
import { init, initText } from './init.js';
import { surveyText } from './survey.js';

/** Somewhere text can be written, such as `process.stdout`. */
export interface Writable {
  /** Writes the text. */
  write(text: string): unknown;
}

/** What the CLI writes to, and the version it reports. */
export interface RunContext {
  /** The version `--version` prints. */
  version: string;
  /** Where results go. */
  out: Writable;
  /** Where problems go. */
  err: Writable;
}

const HELP = `Usage: aptuitive <command> [options]

Integrates Aptuitive into an application, step by step. Every command takes --json, for agents.

Commands:
  detect                             What the project uses: framework, router, design system,
                                     API description and coding agents.
  init                               Sets Aptuitive up: packages, its folder, MCP servers and the
                                     integration skill. Never overwrites a file.
  survey --openapi <spec>            A compact inventory of an API description, to curate from.
  generate sources --openapi <spec>  Sources, actions and REST endpoints from the description and
                                     <folder>/curation.json, written to <folder>/api.generated.ts.
  generate blocks <file#Component>   Native block props from components' TypeScript props, written
                                     to <folder>/blocks.generated.ts. --check reports drift.
  discover --url <url>               Crawls the running application and proposes routes, regions,
                                     lists and which buttons are which actions.
  check                              Whether the integration holds: contract, JSON, request
                                     schemas, labels and bindings, with coverage.

Options:
  --cwd <dir>     The project's root. Default: the current directory.
  --json          Machine-readable output.
  -h, --help      This help.
  -v, --version   The version.

Files go in the project's Aptuitive folder, recorded in package.json as aptuitive.dir: by
default src/aptuitive when there is a src folder, else aptuitive.
`;

/** Each command's help: what it does, and every option. */
const HELPS: Readonly<Record<string, string>> = {
  detect: `Usage: aptuitive detect [--cwd <dir>] [--json]

What the project uses: package manager, UI library, framework, router, design system, server,
API descriptions and coding agents. At a workspace root, it lists the packages with an interface:
set Aptuitive up in one of those.
`,
  init: `Usage: aptuitive init [options]

Sets Aptuitive up in the package: its folder (a contract with every page as a region, bindings,
client, kit, and a server handler when there is a server), sources from a small API description
or a curation file for a large one, and the coding agents' configuration at the repository root.
Never overwrites a file.

Options:
  --dir <folder>        Where Aptuitive's files go, such as app/aptuitive when the build only
                        compiles app. Recorded in package.json. Default: src/aptuitive when
                        there is a src folder, else aptuitive.
  --openapi <spec>      The API description to use. Default: the first one found.
  --packages <folder>   Installs from package tarballs (pnpm pack), before publication.
  --no-install          Writes the files and prints the install command instead.
  --no-agents           Leaves coding agents' configuration alone.
  --mcp <command>       How agents start the MCP server. Default: npx -y @plurid/aptuitive-mcp
  --cwd <dir>, --json
`,
  survey: `Usage: aptuitive survey --openapi <path or URL> [--curation <file>] [--cwd <dir>] [--json]

One line per source an OpenAPI 2.0, 3.0 or 3.1 description yields: fields kept and left out,
filters, search, sorting, paging, reading by key, and its actions; then what was skipped and why.
With a curation file (default <folder>/curation.json), marks what it keeps.
`,
  generate: `Usage: aptuitive generate <what> [options]

  generate sources --openapi <spec>    Sources, actions and REST endpoints, from the description
                                       and <folder>/curation.json, into <folder>/api.generated.ts.
  generate blocks <file#Component>...  Native block props from components' TypeScript props, into
                                       <folder>/blocks.generated.ts.

Run either with --help for its options.
`,
  'generate sources': `Usage: aptuitive generate sources --openapi <path or URL> [options]

Writes sources, actions with effect levels, and REST endpoints for restFetch and restPerform.
Rerun after every curation change; never edit the generated file. Past 40 sources or 200 actions,
it asks for a curation first.

Options:
  --curation <file>   Default: <folder>/curation.json, when it exists.
  --out <file>        Default: <folder>/api.generated.ts.
  --dry-run           Reports without writing.
  --cwd <dir>, --json
`,
  'generate blocks': `Usage: aptuitive generate blocks <file#Component>... [options]

Block specs whose props schemas come from components' TypeScript props: literal unions become
enums, optional props become required with the component's default described, and functions,
content and objects are left for an adapter to supply.

Options:
  --out <file>   Default: <folder>/blocks.generated.ts.
  --check        Reports whether the file is up to date, without writing it.
  --cwd <dir>, --json
`,
  discover: `Usage: aptuitive discover --url <url> [options]

Crawls the running application with Playwright, following same-origin links and never pressing
anything, and writes <folder>/discovery.json: routes, a region per route, lists from navigation
and toolbars, and which buttons match the contract's actions.

Options:
  --pages <n>              Most pages visited. Default: 30.
  --per-route <n>          Most visits per route. Default: 2.
  --storage-state <file>   A Playwright storage state with a signed-in session.
  --chrome                 Uses the installed Chrome (with playwright-core).
  --out <file>             Default: <folder>/discovery.json.
  --cwd <dir>, --json
`,
  check: `Usage: aptuitive check [--contract <file>] [--bindings <file>] [--cwd <dir>] [--json]

Whether the integration holds: the contract loads (tsconfig paths resolve) and validates, its
JSON round-trips, every request schema fits structured outputs, labels are distinct and find what
they name, and bindings exist for what the contract declares. Prints coverage.
`,
};

const COMMON = {
  cwd: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

type Handler = (args: string[], context: RunContext) => Promise<number>;

const print = (context: RunContext, json: boolean, value: unknown, text: string) => {
  context.out.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${text}\n`);
};

const problems = (context: RunContext, list: readonly string[]) => {
  for (const problem of list) context.err.write(`aptuitive: ${problem}\n`);
};

const survey: Handler = async (args, context) => {
  const { values } = parseArgs({
    args,
    options: { ...COMMON, openapi: { type: 'string' }, curation: { type: 'string' } },
  });
  if (values.help || !values.openapi) {
    context.out.write(HELPS['survey'] ?? '');
    return values.help ? 0 : 1;
  }
  const result = await surveySpec({
    spec: values.openapi,
    ...(values.cwd ? { cwd: values.cwd } : {}),
    ...(values.curation ? { curation: values.curation } : {}),
  });
  print(context, values.json, result, surveyText(result));
  problems(context, result.problems);
  return result.problems.length === 0 ? 0 : 1;
};

const generateSourcesCommand: Handler = async (args, context) => {
  const { values } = parseArgs({
    args,
    options: {
      ...COMMON,
      openapi: { type: 'string' },
      curation: { type: 'string' },
      out: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.openapi) {
    context.out.write(HELPS['generate sources'] ?? '');
    return values.help ? 0 : 1;
  }
  const { code: _code, ...result } = await generateSources({
    spec: values.openapi,
    ...(values.cwd ? { cwd: values.cwd } : {}),
    ...(values.curation ? { curation: values.curation } : {}),
    ...(values.out ? { out: values.out } : {}),
    dryRun: values['dry-run'],
  });
  const text = [
    result.written
      ? `Wrote ${result.file}: ${result.sources.length} sources, ${result.actions.length} actions.`
      : result.problems.length === 0
        ? `Would write ${result.file}: ${result.sources.length} sources, ${result.actions.length} actions.`
        : `Nothing written.`,
    ...result.notes.map((note) => `Check: ${note}`),
  ].join('\n');
  print(context, values.json, result, text);
  problems(context, result.problems);
  return result.problems.length === 0 ? 0 : 1;
};

const detectCommand: Handler = async (args, context) => {
  const { values } = parseArgs({ args, options: COMMON });
  if (values.help) {
    context.out.write(HELPS['detect'] ?? '');
    return 0;
  }
  const found = await detect(values.cwd);
  print(context, values.json, found, detectText(found));
  return 0;
};

const initCommand: Handler = async (args, context) => {
  const { values } = parseArgs({
    args,
    options: {
      ...COMMON,
      openapi: { type: 'string' },
      'no-install': { type: 'boolean', default: false },
      'no-agents': { type: 'boolean', default: false },
      mcp: { type: 'string' },
      packages: { type: 'string' },
      dir: { type: 'string' },
    },
  });
  if (values.help) {
    context.out.write(HELPS['init'] ?? '');
    return 0;
  }
  const result = await init({
    ...(values.cwd ? { cwd: values.cwd } : {}),
    ...(values.openapi ? { openapi: values.openapi } : {}),
    ...(values.mcp ? { mcp: values.mcp } : {}),
    ...(values.packages ? { packages: values.packages } : {}),
    ...(values.dir ? { dir: values.dir } : {}),
    install: !values['no-install'],
    agents: !values['no-agents'],
  });
  print(context, values.json, result, initText(result));
  return result.install.ok === false ? 1 : 0;
};

const checkCommand: Handler = async (args, context) => {
  const { values } = parseArgs({
    args,
    options: { ...COMMON, contract: { type: 'string' }, bindings: { type: 'string' } },
  });
  if (values.help) {
    context.out.write(HELPS['check'] ?? '');
    return 0;
  }
  const result = await check({
    ...(values.cwd ? { cwd: values.cwd } : {}),
    ...(values.contract ? { contract: values.contract } : {}),
    ...(values.bindings ? { bindings: values.bindings } : {}),
  });
  print(context, values.json, result, checkText(result));
  return result.ok ? 0 : 1;
};

const generateBlocksCommand: Handler = async (args, context) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { ...COMMON, out: { type: 'string' }, check: { type: 'boolean', default: false } },
  });
  if (values.help || positionals.length === 0) {
    context.out.write(HELPS['generate blocks'] ?? '');
    return values.help ? 0 : 1;
  }
  const result = await generateBlocks({
    components: positionals,
    ...(values.cwd ? { cwd: values.cwd } : {}),
    ...(values.out ? { out: values.out } : {}),
    check: values.check,
  });
  const text = values.check
    ? result.drift
      ? `${result.file} is out of date: run \`aptuitive generate blocks\`.`
      : `${result.file} is up to date.`
    : result.written
      ? `Wrote ${result.file}: ${result.blocks.map((entry) => entry.name).join(', ')}.`
      : `${result.file} is up to date.`;
  print(context, values.json, result, text);
  problems(context, result.problems);
  return result.problems.length > 0 || (values.check && result.drift) ? 1 : 0;
};

const discoverCommand: Handler = async (args, context) => {
  const { values } = parseArgs({
    args,
    options: {
      ...COMMON,
      url: { type: 'string' },
      pages: { type: 'string' },
      'per-route': { type: 'string' },
      'storage-state': { type: 'string' },
      chrome: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  if (values.help || !values.url) {
    context.out.write(HELPS['discover'] ?? '');
    return values.help ? 0 : 1;
  }
  const result = await discover({
    url: values.url,
    ...(values.cwd ? { cwd: values.cwd } : {}),
    ...(values.pages ? { pages: Number(values.pages) } : {}),
    ...(values['per-route'] ? { perRoute: Number(values['per-route']) } : {}),
    ...(values['storage-state'] ? { storageState: values['storage-state'] } : {}),
    ...(values.out ? { out: values.out } : {}),
    chrome: values.chrome,
  });
  print(
    context,
    values.json,
    result,
    `Visited ${result.visited.length} pages; wrote ${result.file}.\n\n${discoveryText(result.discovery)}`,
  );
  return 0;
};

const COMMANDS: Record<string, Handler> = {
  detect: detectCommand,
  init: initCommand,
  check: checkCommand,
  discover: discoverCommand,
  survey,
  'generate sources': generateSourcesCommand,
  'generate blocks': generateBlocksCommand,
};

/** Runs the CLI; returns the exit code. */
export async function run(argv: readonly string[], context: RunContext): Promise<number> {
  const [first, second, ...rest] = argv;
  if (first === undefined || first === '-h' || first === '--help' || first === 'help') {
    context.out.write(HELP);
    return first === undefined ? 1 : 0;
  }
  if (first === '-v' || first === '--version') {
    context.out.write(`${context.version}\n`);
    return 0;
  }
  if (first === 'generate' && (second === undefined || second.startsWith('-'))) {
    context.out.write(HELPS.generate ?? '');
    return second === undefined ? 1 : 0;
  }
  const pair = second === undefined ? undefined : COMMANDS[`${first} ${second}`];
  if (pair) return pair(rest, context);
  const single = COMMANDS[first];
  if (single) return single(argv.slice(1), context);
  context.err.write(
    `aptuitive: unknown command "${[first, second].filter(Boolean).join(' ')}"\n\n`,
  );
  context.out.write(HELP);
  return 1;
}
