import { z } from 'zod';
import {
  actionsInScope,
  type AnyContract,
  type AnyPageSpec,
  type Field,
  type GenericName,
  type PlanRequest,
  type Subset,
} from '@plurid/uitive-core';
import { offeredBlocks, type SchemaOptions } from './schema.js';

/** The frozen part of every request: how to work. */
export const RULES = `You adapt the interface of one application for one person, strictly within the application's contract below. You never write code or markup: you return operations, which the application validates against its own rules and applies.

How to work:
- A request (kind "command") is the person telling you what they want. Do it, reading their intent generously but staying inside the contract. When they want something to look, work or feel different, redesign pages from the available blocks. Use list operations to show, hide, pin or reorder items, and choices for settings. Mark these with basis "request".
- A page redesign returns the whole new page as a flat list of elements. Each element has an id (a short word), a block, every prop set, and the ids of its children in order. Only sections and tabs have children; tabs hold sections, one per tab. The root is the id of the outermost element, usually a section. Sections have a title (it may be empty) and a layout (stack, grid or columns). Regions show part of the application as it already is. Design pages people want to use: what they asked for first and prominent, useful context kept, what they said they don't need removed, and focus (usually two to four sections). Bold redesigns are welcome when asked for.
- Pages can show the application's data with generic blocks (table, list, detail, metric, chart, timeline, board) fed by the page's named queries; a block names its query in its data prop, and every query must be shown. A query reads one source: fields qualified as source.field, or one hop through a reference as source.ref.field; filters with an operator and string values (numbers; amounts in major units such as 25.50; enum values; dates such as 2026-10-01; relative times now, today, -7d, -3mo, start:month); sorting; a limit; search text or empty; and an aggregate, with measure none for rows, or count, sum, avg, min, max or distinct, optionally by a field and split by another (time groupings need a bucket). Unused aggregate parts are none. On pages about one row, $current is that row.
- Never add up amounts in different currencies: filter a money summary to one currency, or group it by currency.
- Row actions, forms and buttons run the application's actions, and the person confirms anything that changes data. Unless the person asked, never place destructive actions and never fill in params of actions that change data.
- When the person asks for a page of their own, use surface userPages with op create, a slug (short lowercase words joined by dashes) and a title; rename, set or delete their pages by slug, only when asked. For the application's pages, leave slug and title empty.
- For a page keyed by a context, use the value the request is about, "*" when it is about every value, and "none" for pages without a context. For lists, use "none" unless the list is keyed by a context.
- A plan (kind "plan") is unprompted. Propose only what the usage clearly supports or the stated goal implies, and often nothing. Mark basis "usage" with the metric that shows it, or "goal".
- Never touch what the person decided themselves (user decisions), anything cooling down or blocked, or required items.
- When nothing in the contract can do what they ask, return status "unsupported". When the request fits several different things, return status "ambiguous" with their labels as candidates. Otherwise return "done".
- The note is at most one short plain sentence, without numbers, or empty.`;

const quote = (value: unknown) => JSON.stringify(value);

/** A compact, deterministic description of a zod schema for people and models. */
function describeSchema(schema: z.ZodType, actions: ReadonlySet<string>): string {
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  const render = (node: Record<string, unknown>): string => {
    if (Array.isArray(node.enum)) {
      const values = node.enum as string[];
      if (values.length > 12) {
        const named = values.filter((value) => actions.has(value)).length;
        const extra = values.filter((value) => !actions.has(value));
        if (named === values.length - extra.length && named > values.length / 2) {
          return extra.length > 0 ? `${extra.map(quote).join(' | ')} | action ID` : 'action ID';
        }
        return `one of ${values.length}: ${values.join(', ')}`;
      }
      return values.map(quote).join(' | ');
    }
    if (node.type === 'array') {
      const item = render((node.items ?? {}) as Record<string, unknown>);
      return item.includes(' | ') ? `(${item})[]` : `${item}[]`;
    }
    if (node.type === 'object') {
      const properties = Object.entries(
        (node.properties ?? {}) as Record<string, Record<string, unknown>>,
      );
      return `{ ${properties.map(([key, value]) => `${key}: ${render(value)}`).join('; ')} }`;
    }
    return String(node.type ?? 'any');
  };
  return render(json);
}

/**
 * The application's contract as text: stable across users, so it caches. For large contracts,
 * a subset scopes the sources described to those chosen for the request. It names the blocks the
 * schema for the same subset and `native` offers, and no others.
 */
export function contractText(
  contract: AnyContract,
  subset?: Subset,
  options: Pick<SchemaOptions, 'native'> = {},
): string {
  const offered = offeredBlocks(contract, {
    ...(subset === undefined ? {} : { subset }),
    ...(options.native === undefined ? {} : { native: options.native }),
  });
  const own = new Set(offered.own);
  const actions = new Set(contract.actionIds);
  const lines: string[] = [`# Application: ${contract.id}`, contract.description, ''];

  const actionIds =
    subset === undefined ? [...contract.actionIds].sort() : actionsInScope(contract, subset);
  const counted =
    actionIds.length === contract.actionIds.length
      ? `${actionIds.length}`
      : `${actionIds.length} of ${contract.actionIds.length}, chosen for this request`;
  lines.push(
    `# Actions (${counted}), as id: label. description [group] (what a run does and takes)`,
  );
  for (const id of actionIds) {
    const action = contract.actions[id];
    const params = contract.params(id);
    const runs =
      action?.effect === undefined
        ? ''
        : ` (${action.effect}${params.length > 0 ? `; takes ${params.map(describeField).join(', ')}` : ''})`;
    lines.push(
      `${id}: ${action?.label}. ${action?.description}${action?.group ? ` [${action.group}]` : ''}${runs}`,
    );
  }
  lines.push('');

  const sourceIds = subset?.sources ?? contract.sourceIds;
  if (sourceIds.length > 0) {
    lines.push('# Sources, as id: label. description. Key. Fields as name type');
    if (sourceIds.length < contract.sourceIds.length) {
      lines.push(
        `(${sourceIds.length} of ${contract.sourceIds.length} sources, chosen for this request: only these can be queried)`,
      );
    }
    for (const id of sourceIds) {
      const entry = contract.source(id);
      if (!entry) continue;
      lines.push(
        `${id}: ${entry.label}. ${entry.description}. Key ${entry.key}. Fields: ${entry.fields.map(describeField).join(', ')}`,
      );
    }
    lines.push('');
  }

  if (contract.routeIds.length > 0) {
    lines.push('# Routes, as id: path (what it shows)');
    for (const id of contract.routeIds) {
      const route = contract.routes[id];
      if (!route) continue;
      const shows = [
        route.entity === undefined ? undefined : `one ${route.entity} row`,
        route.page === undefined ? undefined : `page ${route.page}`,
      ].filter(Boolean);
      lines.push(`${id}: ${route.path}${shows.length > 0 ? ` (${shows.join(', ')})` : ''}`);
    }
    lines.push('');
  }

  const contexts = Object.entries(contract.contexts);
  if (contexts.length > 0) {
    lines.push('# Contexts');
    for (const [name, values] of contexts)
      lines.push(`${name}: ${values.length} values (each also an action ID above)`);
    lines.push('');
  }

  lines.push('# Surfaces');
  for (const id of [...contract.surfaceIds].sort()) {
    const spec = contract.surfaces[id];
    if (!spec) continue;
    if (spec.kind === 'list') {
      const keyed = spec.context === undefined ? '' : `, keyed by ${spec.context}`;
      lines.push(`## ${id} (list${keyed}): ${spec.label}. ${spec.description}`);
      lines.push(
        `Shows ${spec.capacity}; the rest wait in overflow.${spec.required?.length ? ` Required: ${spec.required.join(', ')}.` : ''}`,
      );
      if (spec.context === undefined) {
        lines.push(
          `Items: ${spec.items.length > 40 ? `${spec.items.length} action IDs (any ${contexts[0]?.[0] ?? 'item'})` : spec.items.join(', ')}`,
        );
      } else {
        lines.push(`Items per ${spec.context}:`);
        for (const value of contract.contexts[spec.context] ?? []) {
          lines.push(`  ${value}: ${(spec.available?.(value) ?? spec.items).join(', ')}`);
        }
      }
    } else if (spec.kind === 'choice') {
      lines.push(
        `## ${id} (choice): ${spec.label}. ${spec.description}. Values: ${spec.values.join(', ')} (default ${spec.default})`,
      );
    } else if (spec.kind === 'collection') {
      lines.push(
        `## ${id} (collection, at most ${spec.max}): ${spec.label}. ${spec.description}. Item: ${describeSchema(spec.item, actions)}`,
      );
    } else {
      const page = spec as AnyPageSpec;
      const keyed =
        page.context === undefined
          ? ''
          : `, keyed by ${page.context} or * for every ${page.context}`;
      const about = page.entity === undefined ? '' : ` About one ${page.entity} row.`;
      lines.push(`## ${id} (page${keyed}): ${page.label}. ${page.description}${about}`);
      const its = Object.keys(page.blocks)
        .filter((name) => own.has(name))
        .sort();
      lines.push(
        `At most ${page.maxElements ?? 40} elements, ${page.maxDepth ?? 4} levels deep. Blocks: section, tabs${Object.keys(contract.regions).length > 0 ? ', region' : ''}${its.length > 0 ? `, ${its.join(', ')}` : ''}`,
      );
    }
  }
  lines.push('');

  const regions = Object.entries(contract.regions).sort(([a], [b]) => a.localeCompare(b));
  if (regions.length > 0) {
    lines.push('# Regions, as name: label. What it shows [the source it is about]');
    for (const [name, region] of regions) {
      lines.push(
        `${name}: ${region.label}. ${region.description}${region.entity === undefined ? '' : ` [${region.entity}]`}`,
      );
    }
    lines.push('');
  }

  if (offered.generic.length > 0) {
    lines.push('# Generic blocks, as name: what it shows. Props');
    for (const name of offered.generic) lines.push(`${name}: ${GENERIC_TEXT[name]}`);
    lines.push('');
  }

  const blocks = new Map<string, AnyPageSpec['blocks'][string]>();
  for (const id of contract.surfaceIds) {
    const spec = contract.surfaces[id];
    if (spec?.kind !== 'page') continue;
    for (const [name, block] of Object.entries(spec.blocks)) {
      if (own.has(name)) blocks.set(name, block);
    }
  }
  if (blocks.size > 0) {
    lines.push('# Blocks, as name: label. What it shows. Props');
    for (const [name, block] of [...blocks].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(
        `${name}: ${block.label}. ${block.description}. Props ${describeSchema(block.props, actions)}`,
      );
    }
  }
  return lines.join('\n');
}

/** A field as the prompt shows it: `amount money`, `status enum (a|b)`, `customer ref to customers`. */
function describeField(entry: Field): string {
  if (entry.type === 'enum') return `${entry.name} enum (${entry.values.join('|')})`;
  if (entry.type === 'ref') return `${entry.name} ref to ${entry.source}`;
  return `${entry.name} ${entry.type}`;
}

const GENERIC_TEXT: Record<GenericName, string> = {
  table:
    'rows of a query as a table. Props: data; columns (fields of its query); lookups ({data, label}: summary queries grouped by a ref to the table source, one figure per row); rowActions ({action, set}); density (comfortable|compact); link (none|entity opens each row)',
  list: 'rows as a compact list. Props: data; title, subtitle, meta and badge (fields of its query, or none); rowActions; link',
  detail:
    "one row's fields, such as $current. Props: data (a query with limit 1); fields; columns (1 to 3)",
  metric:
    'one number. Props: data (an ungrouped summary); label; compare (none|previous, for queries that start at a time)',
  chart:
    'a summary grouped by time or category. Props: data; kind (line|bar|area|pie); stacked (bars or areas with a split)',
  timeline: 'rows in time order. Props: data; time (a time field); title; detail (a field or none)',
  board: 'rows as cards in columns. Props: data; column (an enum field); title; meta',
  form: 'a form that runs an action. Props: action; set (params filled in)',
  actions:
    'buttons. Props: list (a list surface or none); items ({action, set}); size (small|regular|large)',
  note: 'a short note. Props: title; text',
  links:
    "links to the application's pages. Props: items ({label, route, entity}). Entity is empty, except for a route about one row: link to it only from a page about that route's source, with entity $current. You never see rows, so never write a row key",
};

/** The part of every request that changes: what was asked, what is on screen, how it is used. */
export function requestText(request: PlanRequest): string {
  const lines: string[] = [`Kind: ${request.kind}`];
  if (request.text !== undefined) lines.push(`Request: ${JSON.stringify(request.text)}`);
  if (request.goal !== undefined) lines.push(`Stated goal: ${JSON.stringify(request.goal)}`);
  // Everything the client wrote is quoted as data, like the request itself.
  const contexts = Object.entries(request.contexts);
  lines.push(`Context now: ${contexts.length === 0 ? 'none' : quote(request.contexts)}`);

  if (request.route !== undefined) lines.push(`Route now: ${quote(request.route)}`);
  const environment = request.environment;
  if (environment !== undefined) {
    const missing = Object.entries(environment.anchors).filter(([, state]) => state !== 'found');
    const sources = Object.entries(environment.sources);
    lines.push(
      `Page found: route ${quote(environment.route ?? 'unknown')}; anchors not found: ${missing.length === 0 ? 'none' : quote(Object.fromEntries(missing))}; data: ${sources.length === 0 ? 'none' : quote(environment.sources)}; unmapped ${environment.unmapped.links} links, ${environment.unmapped.buttons} buttons, ${environment.unmapped.tables} tables`,
    );
  }

  const state = request.state;
  lines.push(
    `Their own pages: ${state.userPages.length === 0 ? 'none' : state.userPages.map((entry) => `${quote(entry.slug)} (${quote(entry.title)})`).join(', ')}`,
  );
  if (state.userPage !== undefined) {
    lines.push(
      `Their page in view (${quote(state.userPage.slug)}): ${quote(state.userPage.value)}`,
    );
  }
  if (state.pages.length > 0) {
    lines.push('', 'Pages in view (current definition):');
    for (const page of state.pages) {
      lines.push(
        `${page.surface}${page.context ? ` (${page.context})` : ''}: ${JSON.stringify(page.value)}`,
      );
    }
  }
  if (state.lists.length > 0) {
    lines.push('', 'Lists in view:');
    for (const list of state.lists) {
      lines.push(
        `${list.surface}${list.context ? ` (${list.context})` : ''}: visible ${list.visible.join(', ')}${list.pinned.length ? `; pinned ${list.pinned.join(', ')}` : ''}`,
      );
    }
  }
  const choices = Object.entries(state.choices);
  if (choices.length > 0)
    lines.push('', `Choices: ${choices.map(([key, value]) => `${key} = ${value}`).join(', ')}`);
  const collections = Object.entries(state.collections);
  if (collections.length > 0) {
    lines.push(
      `Collections: ${collections.map(([key, titles]) => `${key}: ${titles.length ? quote(titles) : 'empty'}`).join(' | ')}`,
    );
  }
  lines.push(
    '',
    `User decisions (leave alone): ${state.user.length ? state.user.join(', ') : 'none'}`,
  );
  lines.push(
    `Cooling down: ${state.cooldowns.length ? state.cooldowns.join(', ') : 'none'}. Blocked: ${state.blocked.length ? state.blocked.join(', ') : 'none'}.${state.frozen ? ' The interface is frozen: change nothing unless asked.' : ''}`,
  );

  const rows = request.summary.rows.filter((row) => row.uses > 0 || row.idleSessions > 0);
  lines.push(
    '',
    `Usage over the last ${request.summary.window} sessions (surface | context | action | place | uses | sessions used | from overflow | idle sessions):`,
  );
  if (rows.length === 0) lines.push('no usage yet');
  for (const row of rows.slice(0, 120)) {
    lines.push(
      `${quote(row.surface)} | ${row.context === undefined ? '-' : quote(row.context)} | ${quote(row.action)} | ${row.place}${row.pinned ? ' (pinned)' : ''} | ${row.uses} | ${row.activeSessions} | ${row.viaOverflow} | ${row.idleSessions}`,
    );
  }
  return lines.join('\n');
}
