import { basename, dirname, join, relative, resolve } from 'node:path';
import { MAX_SOURCES, selectSubset } from '@plurid/uitive-core';
import {
  check,
  checkText,
  contractIn,
  detect,
  detectText,
  discover,
  folderOf,
  generateBlocks,
  generateSources,
  init,
  initText,
  loadModule,
  surveySpec,
  surveyText,
  within,
} from 'uitive';
import { contractText } from '@plurid/uitive-planner/prompt';
import { limits, outputSchema, size } from '@plurid/uitive-planner/schema';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** How the MCP server runs: the project it is confined to, and whether it may use the network. */
export interface ServerOptions {
  /** The project the server works in; no tool reads or writes outside it. @default process.cwd() */
  root?: string;
  /**
   * Lets tools read API descriptions from URLs, and discovery crawl hosts other than local ones.
   * @default false
   */
  allowNetwork?: boolean;
  /** Reported to clients. @default '0.0.0' */
  version?: string;
}

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };

const reply = (text: string, isError = false): Result => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError } : {}),
});

const format = z
  .enum(['text', 'json'])
  .default('text')
  .describe('text is compact, for reading; json is complete, for processing.');

/** Hosts discovery crawls without the network allowed: this machine's own. */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/;

/**
 * Uitive over the Model Context Protocol: the agent kit's steps as tools, so any coding agent
 * can integrate Uitive the way the CLI does. Every path stays inside the project root, symbolic
 * links resolved, and API descriptions come from files unless the network is allowed, since a URL
 * can carry data out.
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const root = resolve(options.root ?? process.cwd());
  const server = new McpServer({ name: 'uitive', version: options.version ?? '0.0.0' });

  /** A path taken from `base`, refused when it leads outside the root, whether it exists or not. */
  const inside = async (path: string | undefined, what: string, base = root) => {
    const full = resolve(base, path ?? '.');
    if (!(await within(root, full))) {
      throw new Error(`${what} ${path} is outside the project (${root})`);
    }
    return full;
  };
  /** The application package a tool works in, and its Uitive folder, both inside the root. */
  const project = async (cwd: string | undefined) => {
    const folder = await inside(cwd, 'The folder');
    const dir = await inside(await folderOf(folder), "The folder for Uitive's files", folder);
    return { folder, dir };
  };
  const spec = async (value: string, folder: string) => {
    if (/^https?:\/\//.test(value)) {
      if (!options.allowNetwork) {
        throw new Error(
          'Reading from URLs is off; download the description into the project first',
        );
      }
      return value;
    }
    return inside(value, 'The description', folder);
  };
  /** Where a tool may write a file it generates: a name of that kind, in the Uitive folder. */
  const output = async (path: string, folder: string, dir: string, kind: RegExp, what: string) => {
    const full = await inside(path, what, folder);
    if (!(await within(dir, full)) || dirname(full) !== dir || !kind.test(basename(full))) {
      throw new Error(`${what} ${path} must be a file named like ${kind.source} in ${dir}`);
    }
    return full;
  };
  const attempt = async (work: () => Promise<Result>): Promise<Result> => {
    try {
      return await work();
    } catch (error) {
      return reply(error instanceof Error ? error.message : String(error), true);
    }
  };
  const cwd = z
    .string()
    .optional()
    .describe(
      "The application package, relative to the project root. The tool's other paths are relative to it.",
    );

  server.registerTool(
    'uitive_detect',
    {
      title: 'Detect the project',
      description:
        'What the application uses: package manager, UI library, framework, router, design system, API descriptions and coding agents. Start here. Reads nothing outside the project root.',
      inputSchema: { cwd, format },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      attempt(async () => {
        const found = await detect(await inside(input.cwd, 'The folder'), { boundary: root });
        return reply(input.format === 'json' ? JSON.stringify(found, null, 2) : detectText(found));
      }),
  );

  server.registerTool(
    'uitive_init',
    {
      title: 'Set Uitive up',
      description:
        "Writes the project's Uitive folder (contract with every page as a region, bindings, client, server handler, kit), generates sources from a small API description or writes a curation file for a large one, and configures the coding agents at the nearest repository root inside the project root, else at the project root. Never overwrites a file, and never writes outside the project root: what would go there is reported instead. Installs packages only when install is true; otherwise it returns the command.",
      inputSchema: {
        cwd,
        openapi: z
          .string()
          .optional()
          .describe('The API description, relative to cwd; else the first one found.'),
        install: z.boolean().default(false),
        dir: z
          .string()
          .optional()
          .describe(
            "Where Uitive's files go, relative to cwd, such as app/uitive; recorded in package.json. Default: src/uitive when there is a src folder, else uitive.",
          ),
        packages: z
          .string()
          .optional()
          .describe(
            'A folder of package tarballs to install from, such as a local build, relative to cwd.',
          ),
        agents: z
          .boolean()
          .default(true)
          .describe(
            'Whether to configure the coding agents found: MCP servers and the integration skill.',
          ),
        format,
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (input) =>
      attempt(async () => {
        const folder = await inside(input.cwd, 'The folder');
        const dir = input.dir
          ? relative(folder, await inside(input.dir, "The folder for Uitive's files", folder))
          : undefined;
        const result = await init({
          cwd: folder,
          boundary: root,
          ...(input.openapi ? { openapi: await spec(input.openapi, folder) } : {}),
          ...(dir ? { dir } : {}),
          ...(input.packages
            ? { packages: await inside(input.packages, 'The packages folder', folder) }
            : {}),
          install: input.install,
          agents: input.agents,
        });
        return reply(input.format === 'json' ? JSON.stringify(result, null, 2) : initText(result));
      }),
  );

  server.registerTool(
    'uitive_openapi_survey',
    {
      title: 'Survey an API description',
      description:
        "One line per source an OpenAPI description yields: fields, filters, paging and actions, plus what was skipped and why. Marks what the curation file in the project's Uitive folder keeps. Use it to decide what to curate.",
      inputSchema: {
        cwd,
        spec: z
          .string()
          .describe('The OpenAPI 2.0, 3.0 or 3.1 file, JSON or YAML, relative to cwd.'),
        curation: z
          .string()
          .optional()
          .describe("Relative to cwd. Default: curation.json in the project's Uitive folder."),
        format,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      attempt(async () => {
        const { folder, dir } = await project(input.cwd);
        const result = await surveySpec({
          spec: await spec(input.spec, folder),
          cwd: folder,
          curation: await inside(
            input.curation ?? join(dir, 'curation.json'),
            'The curation',
            folder,
          ),
        });
        const text = input.format === 'json' ? JSON.stringify(result, null, 2) : surveyText(result);
        return reply(
          [text, ...result.problems.map((problem) => `Problem: ${problem}`)].join('\n'),
          result.problems.length > 0,
        );
      }),
  );

  server.registerTool(
    'uitive_generate_sources',
    {
      title: 'Generate sources and actions',
      description:
        "Writes api.generated.ts in the project's Uitive folder, from the description and the folder's curation.json: sources, actions with effect levels, and REST endpoints for restFetch and restPerform. Rerun after every curation change; never edit the generated file. It writes only a *.generated.ts file in the Uitive folder.",
      inputSchema: {
        cwd,
        spec: z
          .string()
          .describe('The OpenAPI 2.0, 3.0 or 3.1 file, JSON or YAML, relative to cwd.'),
        curation: z
          .string()
          .optional()
          .describe("Relative to cwd. Default: curation.json in the project's Uitive folder."),
        out: z
          .string()
          .optional()
          .describe(
            "A *.generated.ts file in the project's Uitive folder, relative to cwd. Default: api.generated.ts there.",
          ),
        dry_run: z.boolean().default(false),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (input) =>
      attempt(async () => {
        const { folder, dir } = await project(input.cwd);
        const curation = await inside(
          input.curation ?? join(dir, 'curation.json'),
          'The curation',
          folder,
        );
        const out = await output(
          input.out ?? join(dir, 'api.generated.ts'),
          folder,
          dir,
          /\.generated\.ts$/,
          'The output',
        );
        const { code: _code, ...result } = await generateSources({
          spec: await spec(input.spec, folder),
          cwd: folder,
          // Relative, so the generated file's header never names a path on this machine.
          curation: relative(folder, curation),
          out,
          dryRun: input.dry_run,
        });
        return reply(JSON.stringify(result, null, 2), result.problems.length > 0);
      }),
  );

  server.registerTool(
    'uitive_generate_blocks',
    {
      title: 'Generate native blocks',
      description:
        "Writes blocks.generated.ts in the project's Uitive folder: block specs whose props schemas come from components' TypeScript props. Literal unions become enums, optional props become required with the component's default described, and functions, content and objects are left for an adapter to supply. With check, reports drift without writing.",
      inputSchema: {
        cwd,
        components: z
          .array(z.string())
          .min(1)
          .describe(
            'Each as path#Component, relative to cwd, such as src/order-summary.tsx#OrderSummary.',
          ),
        check: z.boolean().default(false),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (input) =>
      attempt(async () => {
        const { folder, dir } = await project(input.cwd);
        // Each file as generating will read it, refused before anything is read.
        const components: string[] = [];
        for (const component of input.components) {
          const [path = '', name] = component.split('#');
          const file = await inside(path, 'The component', folder);
          components.push(name === undefined ? file : `${file}#${name}`);
        }
        const result = await generateBlocks({
          components,
          cwd: folder,
          out: await inside(join(dir, 'blocks.generated.ts'), 'The output', folder),
          check: input.check,
        });
        return reply(JSON.stringify(result, null, 2), result.problems.length > 0);
      }),
  );

  server.registerTool(
    'uitive_discover',
    {
      title: 'Discover the running application',
      description:
        "Crawls the running application with Playwright, following same-origin links without pressing anything, and writes discovery.json in the project's Uitive folder: proposed routes (row keys collapsed to parameters), a region per route, lists from navigation and toolbars, buttons matched to the contract's actions, and buttons that open menus. Crawls only this machine's hosts (localhost, *.localhost, 127.0.0.1, [::1]) unless the server allows the network. Needs playwright, or playwright-core with chrome: true.",
      inputSchema: {
        cwd,
        url: z.string().describe('The development server, such as http://localhost:5173/.'),
        pages: z.number().int().min(1).max(200).default(30),
        per_route: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(2)
          .describe('Most visits to pages of one route.'),
        out: z
          .string()
          .optional()
          .describe(
            "A .json file in the project's Uitive folder other than curation.json, relative to cwd. Default: discovery.json there.",
          ),
        storage_state: z
          .string()
          .optional()
          .describe('A Playwright storage state file with a signed-in session, relative to cwd.'),
        chrome: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (input) =>
      attempt(async () => {
        if (!LOCAL.test(new URL(input.url).hostname) && !options.allowNetwork) {
          throw new Error(
            'Discovery crawls local development servers only, unless the network is allowed',
          );
        }
        const { folder, dir } = await project(input.cwd);
        const out = await output(
          input.out ?? join(dir, 'discovery.json'),
          folder,
          dir,
          /^(?!curation\.json$).+\.json$/,
          'The discovery file',
        );
        const result = await discover({
          url: input.url,
          cwd: folder,
          pages: input.pages,
          perRoute: input.per_route,
          chrome: input.chrome,
          out,
          contract: await inside(join(dir, 'contract.ts'), 'The contract', folder),
          ...(input.storage_state
            ? { storageState: await inside(input.storage_state, 'The storage state', folder) }
            : {}),
        });
        return reply(JSON.stringify(result, null, 2), result.visited.length === 0);
      }),
  );

  server.registerTool(
    'uitive_check',
    {
      title: 'Check the integration',
      description:
        'Whether the integration holds: the contract loads and validates, its JSON round-trips, every request schema fits structured outputs, and bindings exist. Labels two actions share, or that do not find their source, are warnings, which do not fail it. Prints coverage. Run after every step.',
      inputSchema: {
        cwd,
        contract: z
          .string()
          .optional()
          .describe("Relative to cwd. Default: contract.ts in the project's Uitive folder."),
        bindings: z
          .string()
          .optional()
          .describe("Relative to cwd. Default: bindings.ts in the project's Uitive folder."),
        format,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      attempt(async () => {
        const { folder, dir } = await project(input.cwd);
        const contract = await inside(
          input.contract ?? join(dir, 'contract.ts'),
          'The contract',
          folder,
        );
        const bindings = await inside(
          input.bindings ?? join(dir, 'bindings.ts'),
          'The bindings',
          folder,
        );
        const result = await check({
          cwd: folder,
          contract: relative(folder, contract),
          bindings: relative(folder, bindings),
        });
        return reply(
          input.format === 'json' ? JSON.stringify(result, null, 2) : checkText(result),
          !result.ok,
        );
      }),
  );

  server.registerTool(
    'uitive_preview_plan',
    {
      title: 'Preview what a request plans over',
      description:
        'Shows which sources and actions a request would plan over, and how large its schema and prompt are, without calling the model. Use it to check that requests people make find the right data.',
      inputSchema: {
        cwd,
        text: z
          .string()
          .describe('A request in plain words, such as "a morning check of failed payments".'),
        in_view: z.array(z.string()).default([]).describe('Sources on screen when it is asked.'),
        contract: z
          .string()
          .optional()
          .describe("Relative to cwd. Default: contract.ts in the project's Uitive folder."),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      attempt(async () => {
        const { folder, dir } = await project(input.cwd);
        const path = await inside(
          input.contract ?? join(dir, 'contract.ts'),
          'The contract',
          folder,
        );
        const contract = contractIn(await loadModule(path));
        if (!contract) throw new Error('The contract module exports no contract');
        const scoped = contract.sourceIds.length > MAX_SOURCES;
        const subset = selectSubset(contract, { text: input.text, inView: input.in_view });
        const schema = outputSchema(contract, scoped ? { subset } : {});
        const prompt = contractText(contract, scoped ? subset : undefined);
        return reply(
          JSON.stringify(
            {
              scoped,
              sources: subset.sources,
              actions: subset.actions,
              routes: subset.routes,
              schema: { ...size(schema), ...limits(schema) },
              promptCharacters: prompt.length,
            },
            null,
            2,
          ),
        );
      }),
  );

  return server;
}
