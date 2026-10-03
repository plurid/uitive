/** What each API page says around its generated entries: an introduction, guides and categories. */

export interface Category {
  title: string;
  /** Source modules whose exports belong here, unless an export says `@category` otherwise. */
  modules: readonly string[];
  /** A line under the category's heading. */
  summary?: string;
}

export interface PageConfig {
  intro: string;
  guides: readonly { title: string; path: string }[];
  categories: readonly Category[];
}

/** Exports tagged `@category Advanced` land here, last on their page. */
export const ADVANCED = 'Advanced';

const advanced = (modules: readonly string[] = []): Category => ({
  title: ADVANCED,
  modules,
  summary:
    "Used by Uitive's own packages and by tools built on them. These may change between minor versions.",
});

export const PAGES: Readonly<Record<string, PageConfig>> = {
  core: {
    intro:
      'The contract, the client, data and policy: everything that adapts an interface, in any JavaScript runtime, with no DOM or Node APIs.',
    guides: [
      { title: 'Getting started', path: 'getting-started.md' },
      { title: 'Contracts', path: 'contracts.md' },
      { title: 'Data and actions', path: 'data-and-actions.md' },
      { title: 'Pages', path: 'pages.md' },
    ],
    categories: [
      { title: 'Contracts', modules: ['contract.ts', 'ids.ts', 'json.ts'] },
      { title: 'Sources and fields', modules: ['source.ts', 'field.ts'] },
      { title: 'Queries and data', modules: ['query.ts', 'data.ts', 'cache.ts', 'values.ts'] },
      { title: 'Actions and bindings', modules: ['action.ts', 'rest.ts'] },
      { title: 'Pages and blocks', modules: ['page.ts', 'generic.ts'] },
      { title: 'Routes', modules: ['route.ts'] },
      { title: 'The client', modules: ['client.ts', 'storage.ts'] },
      { title: 'Planners', modules: ['heuristic.ts', 'planner.ts'] },
      {
        title: 'Definitions and policy',
        modules: ['definition.ts', 'policy.ts', 'stabiliser.ts', 'explain.ts', 'limits.ts'],
      },
      { title: 'Usage and simulation', modules: ['usage.ts', 'simulate.ts'] },
      advanced(['retrieval.ts', 'hash.ts']),
    ],
  },
  react: {
    intro:
      'React bindings: the provider, hooks, the page renderer and the generic blocks, drawn with a kit you map to your design system. React 18.3 or 19.',
    guides: [
      { title: 'React', path: 'react.md' },
      { title: 'Pages', path: 'pages.md' },
    ],
    categories: [
      { title: 'The provider', modules: ['provider.tsx'] },
      { title: 'Hooks', modules: ['hooks.ts'] },
      { title: 'Rendering pages', modules: ['page.tsx', 'generic.tsx'] },
      { title: 'The kit', modules: ['kit.tsx'] },
      advanced(),
    ],
  },
  dom: {
    intro:
      "Uitive for pages without React: adapting an application's own markup, and the meta-interface as custom elements.",
    guides: [{ title: 'Without React', path: 'without-react.md' }],
    categories: [
      { title: 'Starting', modules: ['start.ts', 'define.ts'] },
      { title: 'Adapting markup', modules: ['markup.ts', 'order.ts'] },
      {
        title: 'Elements',
        modules: [
          'ask.ts',
          'banner.ts',
          'confirm.ts',
          'more.ts',
          'your-interface.ts',
          'element.ts',
          'client-like.ts',
          'html.ts',
          'styles.ts',
        ],
      },
      { title: '`@plurid/uitive-dom/debug`', modules: ['debug.ts'] },
      advanced(),
    ],
  },
  planner: {
    intro:
      'The model planner, for any provider: contracts compiled to structured outputs, the prompt, and models from Anthropic, OpenAI and every server that speaks its API, Gemini, or your own. It runs on servers and in extensions.',
    guides: [{ title: 'Planning', path: 'planning.md' }],
    categories: [
      { title: 'The model planner', modules: ['plan.ts', 'output.ts'] },
      {
        title: 'Models',
        modules: ['model.ts', 'environment.ts', 'anthropic.ts', 'openai.ts', 'google.ts'],
      },
      { title: '`@plurid/uitive-planner/schema`', modules: ['schema.ts'] },
      { title: '`@plurid/uitive-planner/prompt`', modules: ['prompt.ts'] },
      advanced(),
    ],
  },
  server: {
    intro:
      'The Fetch-standard handler that serves the model planner, with its limits and streaming. It re-exports the planner.',
    guides: [{ title: 'Planning', path: 'planning.md' }],
    categories: [
      { title: 'The handler', modules: ['handler.ts'] },
      { title: '`@plurid/uitive-server/node`', modules: ['node.ts'] },
      advanced(),
    ],
  },
  adapter: {
    intro:
      "What pages Uitive doesn't own need: accessibility trees, discovery, and adapters as data. It runs anywhere, for the CLI and the extension alike.",
    guides: [{ title: 'Coding agents', path: 'coding-agents.md' }],
    categories: [
      { title: 'Accessibility trees', modules: ['aria.ts'] },
      { title: 'Discovering pages', modules: ['discover.ts'] },
      { title: 'Adapters', modules: ['format.ts', 'checks.ts', 'effects.ts'] },
      advanced(),
    ],
  },
  cli: {
    intro:
      'The agent kit as a command-line tool and a library: detection, set-up, sources from OpenAPI, blocks, discovery and the check.',
    guides: [{ title: 'Coding agents', path: 'coding-agents.md' }],
    categories: [
      { title: 'Running the CLI', modules: ['commands.ts', 'bin.ts'] },
      { title: 'Setting up', modules: ['detect.ts', 'init.ts', 'folder.ts', 'templates.ts'] },
      {
        title: 'API descriptions',
        modules: ['openapi.ts', 'curation.ts', 'survey.ts', 'generate.ts', 'emit.ts'],
      },
      { title: 'Native blocks', modules: ['blocks.ts'] },
      { title: 'Discovering an application', modules: ['discover.ts'] },
      { title: 'Checking', modules: ['check.ts'] },
      advanced(['format.ts']),
    ],
  },
  mcp: {
    intro:
      'The agent kit over the Model Context Protocol: the same steps as tools any coding agent can call, confined to the project.',
    guides: [{ title: 'Coding agents', path: 'coding-agents.md' }],
    categories: [{ title: 'The server', modules: ['server.ts', 'bin.ts'] }, advanced()],
  },
};
