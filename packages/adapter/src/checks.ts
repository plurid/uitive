import { fromJson } from '@plurid/uitive-core';
import type { AnyContract, ContractJson } from '@plurid/uitive-core';
import { adapterSchema } from './format.js';
import type { Adapter } from './format.js';

/**
 * What checking an adapter gives: the adapter and its contract, ready to apply, or every problem
 * found.
 */
export type Checked = { adapter: Adapter; contract: AnyContract } | { problems: string[] };

// Headers a page's requests can't set (the Fetch standard's forbidden request headers), so a key
// put in one would never be sent.
const FORBIDDEN_HEADER =
  /^(accept-charset|accept-encoding|access-control-request-.+|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|referer|set-cookie|te|trailer|transfer-encoding|upgrade|via|proxy-.+|sec-.+)$/i;

const compiles = (pattern: string) => {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

/**
 * Checks an adapter before it touches a page: its shape, its contract, and that every anchor,
 * route, list, region, page and connector it names resolves. Required anchors, such as notices,
 * must sit outside regions a redesign may replace.
 */
export function checkAdapter(input: unknown): Checked {
  const parsed = adapterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      problems: parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join('.') || 'adapter'}: ${issue.message}`,
      ),
    };
  }
  const adapter = parsed.data;
  let contract: AnyContract;
  try {
    contract = fromJson(adapter.contract as unknown as ContractJson, {});
  } catch (error) {
    return { problems: [`contract: ${(error as Error).message}`] };
  }
  const problems: string[] = [];
  const anchors = adapter.anchors;
  const anchor = (where: string, name: string) => {
    if (!anchors[name]) problems.push(`${where}: no anchor "${name}"`);
  };

  // Anchors nest without cycles.
  const chain = (name: string): string[] => {
    const seen: string[] = [];
    for (
      let current = anchors[name]?.within;
      current !== undefined;
      current = anchors[current]?.within
    ) {
      if (seen.includes(current) || current === name) {
        problems.push(`anchors.${name}: "within" loops`);
        break;
      }
      seen.push(current);
    }
    return seen;
  };
  // Every anchor's ancestors, worked out once: a loop is a problem whether or not it is required.
  const ancestors = new Map(Object.keys(anchors).map((name) => [name, chain(name)]));
  for (const [name, entry] of Object.entries(anchors)) {
    if (entry.within !== undefined) anchor(`anchors.${name}.within`, entry.within);
    for (const strategy of entry.match) {
      if ('href' in strategy && !compiles(strategy.href)) {
        problems.push(`anchors.${name}: href pattern ${strategy.href} doesn't compile`);
      }
    }
  }

  for (const [index, entry] of adapter.routes.entries()) {
    if (!compiles(entry.path)) problems.push(`routes.${index}: ${entry.path} doesn't compile`);
    if (!contract.route(entry.route))
      problems.push(`routes.${index}: the contract has no route "${entry.route}"`);
  }

  for (const [surface, list] of Object.entries(adapter.lists)) {
    const spec = contract.surfaces[surface];
    if (spec?.kind !== 'list') {
      problems.push(`lists.${surface}: the contract has no list "${surface}"`);
      continue;
    }
    anchor(`lists.${surface}.container`, list.container);
    for (const [action, name] of Object.entries(list.items)) {
      if (!spec.items.includes(action))
        problems.push(`lists.${surface}: "${action}" isn't one of its items`);
      anchor(`lists.${surface}.items.${action}`, name);
    }
    for (const item of spec.items) {
      if (!list.items[item]) problems.push(`lists.${surface}: no anchor for item "${item}"`);
    }
  }

  const regionAnchors = new Set<string>();
  for (const [region, entry] of Object.entries(adapter.regions)) {
    if (!contract.regions[region])
      problems.push(`regions.${region}: the contract has no region "${region}"`);
    anchor(`regions.${region}.anchor`, entry.anchor);
    regionAnchors.add(entry.anchor);
  }
  for (const [surface, entry] of Object.entries(adapter.pages)) {
    if (contract.surfaces[surface]?.kind !== 'page') {
      problems.push(`pages.${surface}: the contract has no page "${surface}"`);
    }
    if (!contract.route(entry.route))
      problems.push(`pages.${surface}: the contract has no route "${entry.route}"`);
    if (!adapter.regions[entry.region])
      problems.push(`pages.${surface}: no region "${entry.region}"`);
  }
  for (const [name, entry] of Object.entries(anchors)) {
    if (!entry.required) continue;
    const inside = (ancestors.get(name) ?? []).find((ancestor) => regionAnchors.has(ancestor));
    if (inside !== undefined || regionAnchors.has(name)) {
      problems.push(
        `anchors.${name}: required anchors must sit outside replaceable regions (${inside ?? name})`,
      );
    }
  }

  if (adapter.testMode !== undefined && !compiles(adapter.testMode)) {
    problems.push(`testMode: ${adapter.testMode} doesn't compile`);
  }
  for (const [name, connector] of Object.entries(adapter.connectors)) {
    const where = `connectors.${name}`;
    const { keys } = connector;
    for (const [mode, pattern] of [
      ['live', keys.live],
      ['test', keys.test],
    ] as const) {
      if (pattern !== undefined && !compiles(pattern))
        problems.push(`${where}.keys.${mode}: doesn't compile`);
    }
    for (const [index, rule] of keys.refuse.entries()) {
      if (!compiles(rule.pattern))
        problems.push(`${where}.keys.refuse.${index}: ${rule.pattern} doesn't compile`);
    }
    if (adapter.testMode !== undefined && keys.test === undefined) {
      problems.push(`${where}.keys.test: the adapter has a test mode, so test keys need a pattern`);
    }
    if (adapter.testMode === undefined && keys.test !== undefined) {
      problems.push(`${where}.keys.test: the adapter has no test mode to use test keys in`);
    }
    if (FORBIDDEN_HEADER.test(connector.auth.header)) {
      problems.push(`${where}.auth.header: browsers don't let pages set ${connector.auth.header}`);
    }
    for (const source of Object.keys(connector.sources)) {
      if (!contract.source(source))
        problems.push(`${where}.sources.${source}: the contract has no such source`);
    }
  }
  return problems.length > 0 ? { problems } : { adapter, contract };
}

/** The route a path is, and its params: the first of the adapter's routes that matches. */
export function routeOf(
  adapter: Pick<Adapter, 'routes'>,
  path: string,
): { route: string; params: Record<string, string> } | undefined {
  for (const entry of adapter.routes) {
    const match = new RegExp(entry.path).exec(path);
    if (match) return { route: entry.route, params: { ...match.groups } };
  }
  return undefined;
}
