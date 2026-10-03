/** What `uitive init` writes, as code that compiles in the host project from the start. */

const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export interface ContractTemplate {
  id: string;
  description: string;
  /** Whether `api.generated.ts` exists to import sources and actions from. */
  generated: boolean;
  /** How the project writes relative imports: `.js`, or nothing. */
  extension: string;
}

export const contractTemplate = ({ id, description, generated, extension }: ContractTemplate) =>
  `import { defineApp, page, route, ui } from '@plurid/uitive-core';
${generated ? `import { actions, sources } from './api.generated${extension}';\n` : ''}
/**
 * What may adapt in this application. Every page starts as a region: the page as it is today, so
 * the application works unchanged. Add routes, finer regions, lists and choices as you go;
 * \`uitive check\` says what to look at next. This file must load on its own in Node: import
 * through tsconfig \`paths\` if you like, but not through aliases only the bundler knows.
 */
export const contract = defineApp({
  id: ${quote(id)},
  version: '1',
  description: ${quote(description)},
${generated ? '  sources,\n  actions,\n' : '  actions: {},\n'}  regions: {
    app: { label: 'The application', description: 'Every page as it is today' },
  },
  routes: {
    home: route({ path: '/', page: 'home' }),
  },
  surfaces: {
    home: page({})({
      label: 'Home',
      description: 'The first page people see',
      standard: () => ui.page(ui.region('app')),
    }),
  },
});
`;

export const bindingsTemplate = (generated: boolean, server: string, extension: string) =>
  generated
    ? `import { restFetch, restPerform } from '@plurid/uitive-core';
import type { Bindings } from '@plurid/uitive-core';
import { endpoints } from './api.generated${extension}';
import type { contract } from './contract${extension}';

// Calls the API as the signed-in person, with the application's own session: never a stored key.
// The description names ${server || 'no server'}; leave \`base\` empty when the API shares this origin.
const base = '';
// Add what the application's API client adds to its requests, such as a CSRF token.
const headers = (): Record<string, string> => ({});

export const bindings: Bindings<typeof contract> = {
  fetch: restFetch({ base, headers, credentials: 'include', sources: endpoints.sources }),
  perform: restPerform({ base, headers, credentials: 'include', actions: endpoints.actions }),
};
`
    : `import type { Bindings } from '@plurid/uitive-core';
import type { contract } from './contract${extension}';

// Bind sources and actions to the application's code as you declare them: \`fetch\` reads a
// source with the person's own permissions, \`perform\` runs an action (interface actions too,
// such as choosing a tool). For REST APIs, \`restFetch\` and \`restPerform\` take endpoints as data.
export const bindings: Bindings<typeof contract> = {};
`;

export const clientTemplate = (id: string, extension: string, server: boolean) =>
  server
    ? `import { createUitive, heuristicPlanner, localStore, remotePlanner } from '@plurid/uitive-core';
import { bindings } from './bindings${extension}';
import { contract } from './contract${extension}';

export const uitive = createUitive({
  contract,
  store: localStore(${quote(`uitive:${id}`)}),
  // A model through the application's server; simple commands still work when it can't answer.
  planner: remotePlanner({ url: '/api/uitive', fallback: heuristicPlanner() }),
  bindings,
});
`
    : `import { createUitive, heuristicPlanner, localStore } from '@plurid/uitive-core';
import { bindings } from './bindings${extension}';
import { contract } from './contract${extension}';

export const uitive = createUitive({
  contract,
  store: localStore(${quote(`uitive:${id}`)}),
  // No server here, so commands are planned on the device: "hide …", "pin …", "restore …" and
  // choice values work without a key. For model planning, mount @plurid/uitive-server's
  // handler in a backend and use remotePlanner({ url, fallback: heuristicPlanner() }).
  planner: heuristicPlanner(),
  bindings,
});
`;

export const serverTemplate = (extension: string) =>
  `import { heuristicPlanner } from '@plurid/uitive-core';
import { createUitiveHandler, environmentModel, modelPlanner } from '@plurid/uitive-server';
import { contract } from './contract${extension}';

// Server only. The model is whichever the server has a key for, ANTHROPIC_API_KEY, OPENAI_API_KEY
// or GEMINI_API_KEY, and the key never reaches the browser; without one, the deterministic planner
// answers plain commands. Serve the handler at /api/uitive/plan and /api/uitive/command, as a
// route or middleware that takes a Request and returns a Response.
const model = environmentModel();

export const handler = createUitiveHandler({
  contract,
  planner: model ? modelPlanner({ model }) : heuristicPlanner(),
});
`;

export const kitTemplate = (designSystem: string | undefined) =>
  `import { createKit } from '@plurid/uitive-react';

// Generic blocks draw with this kit. Replace parts with ${designSystem ? `${designSystem}'s` : "the design system's"} components, such as
// Button, Table or Dialog, or how one kind of value shows, such as money; the rest stays default.
export const kit = createKit({});
`;

export const nextRouteTemplate = (server: string) =>
  `import { handler } from ${quote(server)};

export const POST = handler;
`;

/**
 * The integration playbook for coding agents, as `init` installs it: the same text as the Claude
 * Code plugin's skill.
 */
export const SKILL = `---
name: integrate-uitive
description: Integrates Uitive, the adaptive-interface SDK, into this application end to end, from contract and generated sources to bindings, kit, pages and checks. Use when asked to add Uitive, to let people reshape the interface with plain requests, or to continue a Uitive integration.
---

# Integrate Uitive

Uitive lets each person reshape this application's interface with plain requests, within a contract the application declares: the model proposes, the contract constrains, policy disposes, and the person owns the result. Your job is to declare the contract, bind it to the application's code and design system, and render pages through it, without changing what the application does today.

Work in this order. Each step ends with a check; don't move on while it fails. Every command takes \`--json\`.

## 1. Set up

- Run \`uitive detect\`. In a monorepo, run it at the root first: it lists the packages with an interface. Set Uitive up in that package, not at the root.
- Run \`uitive init\` in that package (with \`--no-install\` to install yourself). It writes the Uitive folder, \`src/uitive/\` when there is a \`src\` folder and \`uitive/\` otherwise (below, \`uitive/\` means that folder), puts the coding agents' configuration at the repository's root, and never overwrites a file. When the build compiles another folder, add \`--dir <that folder>/uitive\`: every command finds the files there.
- Check: \`uitive check\` passes, with the home page as one region. A page that is one region renders the application itself, so its layout stays exactly as it was.

## 2. Data and actions

- With an OpenAPI description, run \`uitive survey --openapi <spec>\`. Keep what the frontend shows: in \`uitive/curation.json\`, set \`"default": "exclude"\` and include those sources. The CLI's README has every key of the curation file. Actions follow their source; exclude the ones the interface doesn't offer. \`"readOnly": true\` keeps no actions at all.
- Name things the way people do: sources take \`label\`, \`description\` and \`keywords\`; actions take \`label\` and \`description\`. Each label should find what it names.
- Lift nested values people look at with \`pick\` (\`{ "card_brand": "/payment_method_details/card/brand" }\`), with \`query\` for any parameter the API needs to include them.
- Lower an action's effect only with a stated \`reason\`: destructive stays destructive unless the backend makes it safe.
- Run \`uitive generate sources --openapi <spec>\` after every curation change. Never edit \`uitive/api.generated.ts\`.
- Without a description, declare actions (and any sources) in \`contract.ts\` with \`action()\`, \`source()\` and the \`field\` helpers. Interface actions, such as a drawing tool, need no effect.
- Action IDs are lowercase, with dots, colons or dashes (\`orders.cancel\`, \`table.add-empty\`); surface and context names are camelCase (\`addNew\`).
- \`uitive check\` loads \`uitive/\` in Node: imports through tsconfig \`paths\` work, aliases only the bundler knows don't, so keep the contract importable on its own.
- Check: \`uitive check\` passes, without warnings about shared labels.

## 3. Bindings

- \`uitive/bindings.ts\` connects the contract to the application: \`fetch\` reads sources with the person's own session (set \`base\` and \`headers\` the way the application's API client does), \`perform\` runs actions, interface ones included.
- No API key in client code, ever. With a server, the planner's key lives in \`uitive/server.ts\`; mount its \`handler\` at \`/api/uitive\`. In Express or another Node server: \`app.use('/api/uitive', toNodeListener(handler))\`, from \`@plurid/uitive-server/node\`.
- Without a server, the client plans on the device: \`hide …\`, \`show …\` or \`pin …\`, \`unpin …\`, \`restore …\`, \`move … to the top\` or \`to the end\`, a choice's value (\`dark\`, \`use the dark theme\`) and \`reset the page\` work without a key. Free-form requests need the model planner on a server.

## 4. Pages and what's on them

- Wrap the application near its root: \`<UitiveProvider client={uitive} kit={kit}>\`, with \`<Confirmations />\` once inside it.
- Tell Uitive where the person is: \`useUitiveRouter(uitive, { path, navigate })\`, from the router's location.
- If the application runs, \`uitive discover --url <dev server>\` proposes routes, regions, toolbars as lists, and which buttons are which actions.
- For each route: add \`route({ path, page, entity, key })\` to the contract, and a page whose standard is the page as it is, as a region: \`standard: () => ui.page(ui.region('orders'))\`, with \`regions: { orders: { label, description, entity } }\`.
- Render it: \`const value = useSurface(uitive, 'orders')\`, then \`<Page value={value} blocks={{}} regions={{ orders: OrdersPage }} />\`, where \`OrdersPage\` is the existing page component.
- Toolbars and menus become lists (\`list({ items, capacity })\`; what doesn't fit goes to overflow, such as a More menu): render them from \`useSurface\`. Settings people choose between become choices.
- Without React, use \`@plurid/uitive-dom\`: call \`startUitive(uitive)\` once at startup, then mark each list's container with \`data-uitive-list="<list>"\` and each item in it with \`data-uitive-item="<action>"\`, where the application builds that markup. Moved-out items are hidden by one stylesheet, menus rendered later included; nothing is moved. Set such a list's \`capacity\` to its number of items, and make a reorderable list's container a flex or grid box.
- Without React, place \`<uitive-ask>\` where people should ask, \`<uitive-banner>\` once, \`<uitive-more list="<list>">\` where moved-out items should stay reachable, and \`<uitive-confirm>\` once if actions have effects. They take the client from \`startUitive\`.
- Check: the application looks and behaves exactly as before.

## 5. Use, and the kit

- Send the application's own controls through Uitive, so usage counts: \`useAction(uitive, 'orders.cancel')\`, or \`uitive.record(id, { via: 'region' })\` where the application already handles the click. With \`adaptMarkup\`, \`data-uitive-item\` does it.
- With React, map the kit to the design system in \`uitive/kit.tsx\`: \`createKit({ Button, Table, Dialog, values: { money } })\`.

## 6. Verify

- \`uitive check\` passes.
- Start the application and ask for a change: with the model planner, in plain words, such as "show failed payments first"; without one, with a command from step 3. It must render with the design system, run actions only after confirmation, survive a reload, and revert in one step.
- Report the time taken, what you changed, the coverage \`uitive check\` prints, and anything you couldn't map.

## Rules

- Don't change what the application does: every existing page keeps working as a region.
- Keep sources to 40 fields, and the contract to 40 sources and 200 actions.
- Model output is data: never evaluate it, and never write it into code.
`;
