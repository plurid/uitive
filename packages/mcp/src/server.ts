import { isAbsolute, join, relative, resolve } from 'node:path';
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
} from 'uitive';
import { contractText } from '@plurid/uitive-planner/prompt';
import { limits, outputSchema, size } from '@plurid/uitive-planner/schema';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** How the MCP server runs: the project it is confined to, and whether it may use the network. */
export interface ServerOptions {
  /** The project the server works in; no tool reads or writes outside it. @default process.cwd() */
  root?: string;
  /** Lets tools read API descriptions from URLs. @default false */
  allowNetwork?: boolean;
  /** Reported to clients. */
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

/**
 * Uitive over the Model Context Protocol: the agent kit's steps as tools, so any coding agent
 * can integrate Uitive the way the CLI does. Every path stays inside the project root, and API
 * descriptions come from files unless the network is allowed, since a URL can carry data out.
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const root = resolve(options.root ?? process.cwd());
  const server = new McpServer({ name: 'uitive', version: options.version ?? '0.0.0' });

  const inside = (path: string | undefined, what: string) => {
    const full = resolve(root, path ?? '.');
    const away = relative(root, full);
    if (away.startsWith('..') || isAbsolute(away)) {
      throw new Error(`${what} ${path} is outside the project (${root})`);
    }
    return full;
  };
  const spec = (value: string) => {
    if (/^https?:\/\//.test(value)) {
      if (!options.allowNetwork) {
        throw new Error(
          'Reading from URLs is off; download the description into the project first',
        );
      }
      return value;
    }
    return inside(value, 'The description');
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
    .describe('The application package, relative to the project root.');

  server.registerTool(
    'uitive_detect',
    {
      title: 'Detect the project',
      description:
        'What the application uses: package manager, UI library, framework, router, design system, API descriptions and coding agents. Start here.',
      inputSchema: { cwd, format },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      attempt(async () => {
        const found = await detect(inside(input.cwd, 'The folder'));
        return reply(input.format === 'json' ? JSON.stringify(found, null, 2) : detectText(found));
      }),
  );

  server.registerTool(
    'uitive_init',
    {
      title: 'Set Uitive up',
      description:
        "Writes the project's Uitive folder (contract with every page as a region, bindings, client, server handler, kit), generates sources from a small API description or writes a curation file for a large one, and configures this project for coding agents. Never overwrites a file. Installs packages only when install is true; otherwise it returns the command.",
      inputSchema: {
        cwd,
        openapi: z.string().optional().describe('The API description; else the first one found.'),
        install: z.boolean().default(false),
        dir: z
          .string()
          .optional()
          .describe(
            "Where Uitive's files go, relative to the project, such as app/uitive; recorded in package.json. Default: src/uitive when there is a src folder, else uitive.",
          ),
        packages: z
          .string()
          .optional()
          .describe('A folder of package tarballs to install from, such as a local build.'),
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
        const folder = inside(input.cwd, 'The folder');
        const dir = input.dir
          ? relative(
              folder,
              inside(join(input.cwd ?? '.', input.dir), "The folder for Uitive's files"),
            )
          : undefined;
        const result = await init({
          cwd: folder,
          ...(input.openapi ? { openapi: spec(input.openapi) } : {}),
          ...(dir ? { dir } : {}),
          ...(input.packages ? { packages: inside(input.packages, 'The packages folder') } : {}),
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
        spec: z.string().describe('The OpenAPI 2.0, 3.0 or 3.1 file, JSON or YAML.'),
        curation: z
          .string()
          .optional()
          .describe("Default: curation.json in the project's Uitive folder."),
        format,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      attempt(async () => {
        const result = await surveySpec({
          spec: spec(input.spec),
          cwd: inside(input.cwd, 'The folder'),
          ...(input.curation ? { curation: inside(input.curation, 'The curation') } : {}),
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
        "Writes api.generated.ts in the project's Uitive folder, from the description and the folder's curation.json: sources, actions with effect levels, and REST endpoints for restFetch and restPerform. Rerun after every curation change; never edit the generated file.",
      inputSchema: {
        cwd,
        spec: z.string().describe('The OpenAPI 2.0, 3.0 or 3.1 file, JSON or YAML.'),
        curation: z.string().optional(),
        out: z
          .string()
          .optional()
          .describe("Default: api.generated.ts in the project's Uitive folder."),
        dry_run: z.boolean().default(false),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (input) =>
      attempt(async () => {
        const folder = inside(input.cwd, 'The folder');
        const { code: _code, ...result } = await generateSources({
          spec: spec(input.spec),
          cwd: folder,
          ...(input.curation ? { curation: inside(input.curation, 'The curation') } : {}),
          ...(input.out ? { out: relative(folder, inside(input.out, 'The output')) } : {}),
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
        const folder = inside(input.cwd, 'The folder');
        for (const component of input.components) {
          inside(join(relative(root, folder), component.split('#')[0] ?? ''), 'The component');
        }
        const result = await generateBlocks({
          components: input.components,
          cwd: folder,
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
        "Crawls the running application with Playwright, following same-origin links without pressing anything, and writes discovery.json in the project's Uitive folder: proposed routes (row keys collapsed to parameters), a region per route, lists from navigation and toolbars, buttons matched to the contract's actions, and buttons that open menus. Needs playwright, or playwright-core with chrome: true.",
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
            'Where to write the discovery, relative to the project. Default: discovery.json in the Uitive folder.',
          ),
        storage_state: z
          .string()
          .optional()
          .describe('A Playwright storage state file with a signed-in session.'),
        chrome: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (input) =>
      attempt(async () => {
        const host = new URL(input.url).hostname;
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/.test(host);
        if (!local && !options.allowNetwork) {
          throw new Error(
            'Discovery crawls local development servers only, unless the network is allowed',
          );
        }
        const folder = inside(input.cwd, 'The folder');
        const result = await discover({
          url: input.url,
          cwd: folder,
          pages: input.pages,
          perRoute: input.per_route,
          chrome: input.chrome,
          ...(input.out
            ? { out: inside(join(input.cwd ?? '.', input.out), 'The discovery file') }
            : {}),
          ...(input.storage_state
            ? { storageState: inside(input.storage_state, 'The storage state') }
            : {}),
        });
        return reply(JSON.stringify(result, null, 2));
      }),
  );

  server.registerTool(
    'uitive_check',
    {
      title: 'Check the integration',
      description:
        'Whether the integration holds: the contract loads and validates, its JSON round-trips, every request schema fits structured outputs, labels find what they name, and bindings exist. Prints coverage. Run after every step.',
      inputSchema: {
        cwd,
        contract: z.string().optional(),
        bindings: z.string().optional(),
        format,
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      attempt(async () => {
        const folder = inside(input.cwd, 'The folder');
        const result = await check({
          cwd: folder,
          ...(input.contract
            ? { contract: relative(folder, inside(input.contract, 'The contract')) }
            : {}),
          ...(input.bindings
            ? { bindings: relative(folder, inside(input.bindings, 'The bindings')) }
            : {}),
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
        contract: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      attempt(async () => {
        const folder = inside(input.cwd, 'The folder');
        const path = input.contract
          ? inside(input.contract, 'The contract')
          : join(folder, await folderOf(folder), 'contract.ts');
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
