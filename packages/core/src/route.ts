import type { AnyContract } from './contract.js';

/** A place in the application, such as `/customers/:id`. */
export interface RouteSpec {
  /** A path pattern: literal segments and `:param` segments. */
  path: string;
  /** Shown in links. @default the page's label, else the route's ID */
  label?: string;
  /** The source whose row the route shows; the `key` param holds the row's key. */
  entity?: string;
  /** The param holding the entity's key. @default 'id' */
  key?: string;
  /** The page surface the route shows. */
  page?: string;
  /** The action a visit records, such as `go.payments`. */
  action?: string;
}

/**
 * Declares a place in the application, such as `/orders/:id`: the page it shows, the source whose
 * row it is about, and the action a visit records.
 */
export function route(spec: RouteSpec): RouteSpec {
  return spec;
}

const PARAM = /^[a-zA-Z][a-zA-Z0-9]*$/;

/** One segment of a route's path: literal text, or a param such as `:id`. */
export type RouteSegment = { literal: string } | { param: string };

/** Splits a path pattern into segments; throws on patterns a router couldn't match. */
export function segments(pattern: string): RouteSegment[] {
  if (!pattern.startsWith('/')) throw new Error(`path "${pattern}" must start with /`);
  const parts = pattern.split('/').filter((part) => part !== '');
  const seen = new Set<string>();
  return parts.map((part) => {
    if (!part.startsWith(':')) return { literal: part };
    const name = part.slice(1);
    if (!PARAM.test(name)) throw new Error(`path "${pattern}": ":${name}" is not a param name`);
    if (seen.has(name)) throw new Error(`path "${pattern}" repeats :${name}`);
    seen.add(name);
    return { param: name };
  });
}

/** Checks every route against the contract's sources, pages and actions. */
export function validateRoutes(contract: AnyContract): void {
  for (const id of contract.routeIds) {
    const spec = contract.routes[id] as RouteSpec;
    const fail = (message: string): never => {
      throw new Error(`route ${id}: ${message}`);
    };
    let parts: RouteSegment[] = [];
    try {
      parts = segments(spec.path);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    if (spec.entity !== undefined) {
      if (!contract.source(spec.entity)) fail(`unknown source "${spec.entity}"`);
      const key = spec.key ?? 'id';
      if (!parts.some((part) => 'param' in part && part.param === key)) {
        fail(`the path needs :${key} for the ${spec.entity} key`);
      }
    }
    if (spec.page !== undefined) {
      const page = contract.surfaces[spec.page];
      if (page?.kind !== 'page') fail(`"${spec.page}" is not a page`);
      if (page?.kind === 'page' && page.entity !== undefined && page.entity !== spec.entity) {
        fail(`${spec.page} is about ${page.entity}, so the route must show one`);
      }
    }
    if (spec.action !== undefined && !contract.action(spec.action)) {
      fail(`unknown action "${spec.action}"`);
    }
  }
}

/** The route a path names, with its params; literal segments beat params. */
export function matchRoute(
  contract: AnyContract,
  path: string,
): { route: string; params: Record<string, string> } | undefined {
  const clean = path.split(/[?#]/)[0] ?? '';
  const parts = clean.split('/').filter((part) => part !== '');
  let best: { route: string; params: Record<string, string>; literals: number } | undefined;
  for (const id of contract.routeIds) {
    const pattern = segments((contract.routes[id] as RouteSpec).path);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let literals = 0;
    const matched = pattern.every((segment, index) => {
      const part = parts[index] as string;
      if ('literal' in segment) {
        literals++;
        return segment.literal === part;
      }
      try {
        params[segment.param] = decodeURIComponent(part);
      } catch {
        return false;
      }
      return true;
    });
    if (matched && (!best || literals > best.literals)) best = { route: id, params, literals };
  }
  return best && { route: best.route, params: best.params };
}

/** The path of a route with its params filled in, or undefined when one is missing. */
export function buildPath(
  contract: AnyContract,
  id: string,
  params: Readonly<Record<string, string>> = {},
): string | undefined {
  const spec = contract.routes[id];
  if (!spec) return undefined;
  const parts: string[] = [];
  for (const segment of segments(spec.path)) {
    if ('literal' in segment) {
      parts.push(segment.literal);
      continue;
    }
    const value = params[segment.param];
    if (value === undefined || value === '') return undefined;
    parts.push(encodeURIComponent(value));
  }
  return `/${parts.join('/')}`;
}

/** The route that shows one row of a source, for links from rows. */
export function entityRoute(contract: AnyContract, source: string): string | undefined {
  return contract.routeIds.find((id) => contract.routes[id]?.entity === source);
}
