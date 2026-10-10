import type { Perform } from './action.js';
import { matchStored } from './data.js';
import type { BindingContext, Fetch, FetchRequest, Stored } from './data.js';
import { pathSegment } from './route.js';

/** What a REST binding reads from a response: the platform's `Response` fits. */
export interface HttpResponse {
  /** Whether the status is in the 200s. */
  ok: boolean;
  /** The HTTP status. */
  status: number;
  /** The body, parsed. */
  json(): Promise<unknown>;
}

/** The `fetch` a REST binding calls: the platform's, or one that adds what a site needs. */
export type HttpFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: unknown;
    credentials?: string;
  },
) => Promise<HttpResponse>;

/** How one source's list endpoint works, as data a generator can write. */
export interface RestSource {
  /** The list endpoint, such as `/v1/charges`. */
  path: string;
  /** A JSON pointer to the rows in a response, such as `/data`; empty when the body is the array. @default '' */
  rows?: string;
  /** Filters the endpoint applies: `field:op` to a query parameter, such as `created:gte` to `created[gte]`. */
  filters?: Readonly<Record<string, string>>;
  /** Parameters sent once per value (`status=a&status=b`) rather than joined by commas. @default [] */
  repeat?: readonly string[];
  /** The page-size parameter; empty when the endpoint has none. @default 'limit' */
  limit?: string;
  /** How pages chain. @default { kind: 'none' } */
  pagination?:
    | {
        kind: 'cursor';
        param: string;
        /** A JSON pointer to the next page's token; without one, the last row's key. */
        next?: string;
      }
    | { kind: 'offset'; param: string }
    | { kind: 'page'; param: string }
    | { kind: 'none' };
  /**
   * A JSON pointer to a boolean saying whether more rows exist, such as `/has_more`. Without it,
   * a cursor's `next` pointer says so, and otherwise a page shorter than the limit is the last.
   */
  more?: string;
  /** Sorting: the parameter, and how a field and direction are written. */
  sort?: { param: string; format: 'field:direction' | '-field' };
  /** The text-search parameter. */
  search?: string;
  /** The key field, for cursors made from the last row and for `item`. @default 'id' */
  key?: string;
  /** Fields lifted from nested values by JSON pointer, such as `brand` from `/card/brand`. */
  pick?: Readonly<Record<string, string>>;
  /** Parameters sent with every list request, such as `expand[]` to include nested objects. */
  query?: Readonly<Record<string, string>>;
  /**
   * The endpoint for one row, such as `/v1/charges/{id}`, for queries that ask for rows by key
   * when the list endpoint can't. `row` points to the row in its response. Declare `eq` and `in`
   * on the key as capabilities.
   */
  item?: { path: string; row?: string };
}

/** How one action's endpoint works. */
export interface RestAction {
  /** The HTTP method. */
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The path, with `{param}` placeholders filled from the run's params. */
  path: string;
  /** How the remaining params are sent. @default 'json' */
  body?: 'json' | 'form';
}

interface RestBase {
  /** The API's base URL, such as `https://api.example.com`; empty for the page's own origin. */
  base: string;
  /** Headers for every request, such as authorization. */
  headers?: (context: BindingContext) => Record<string, string> | Promise<Record<string, string>>;
  /** Sends cookies, for an application's own API. @default 'same-origin' */
  credentials?: 'omit' | 'same-origin' | 'include';
  /** The `fetch` it calls, such as one that adds a CSRF token. @default globalThis.fetch */
  fetch?: HttpFetch;
}

/**
 * What `restFetch` takes: where the API is, how to authenticate, and each source's endpoint as
 * data.
 */
export interface RestFetchConfig extends RestBase {
  /** Each source's list endpoint and how it pages, filters and sorts, by source ID. */
  sources: Readonly<Record<string, RestSource>>;
}

/**
 * What `restPerform` takes: where the API is, how to authenticate, and each action's endpoint as
 * data.
 */
export interface RestPerformConfig extends RestBase {
  /**
   * Each action's method and path, by action ID; params fill `{placeholders}` in the path, and the
   * rest go in the body.
   */
  actions: Readonly<Record<string, RestAction>>;
  /** The header that carries each run's idempotency key, for APIs that honor one. */
  idempotency?: string;
}

/** The value a JSON pointer names, such as `/data/0/id`. */
export function pointer(value: unknown, path: string): unknown {
  if (path === '' || path === '/') return value;
  let current = value;
  for (const raw of path.replace(/^\//, '').split('/')) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const send = (config: RestBase): HttpFetch => {
  const found = config.fetch ?? (globalThis as { fetch?: HttpFetch }).fetch;
  if (!found) throw new Error('fetch is unavailable');
  return found;
};

const encode = (pairs: readonly (readonly [string, string])[]) =>
  pairs
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');

const text = (value: Stored) => String(value);

type Row = Record<string, unknown>;

/**
 * A fetch binding over REST endpoints described as data: filters become query parameters,
 * pages chain by cursor, offset or page number, and rows come from a JSON pointer. Declare as
 * capabilities only the filters and sorts the endpoints apply; core does the rest.
 */
export function restFetch(config: RestFetchConfig): Fetch {
  return async (request: FetchRequest, context) => {
    const spec = Object.hasOwn(config.sources, request.source)
      ? config.sources[request.source]
      : undefined;
    if (!spec) throw new Error(`No endpoint for ${request.source}`);
    const headers = { accept: 'application/json', ...(await config.headers?.(context)) };
    const get = async (path: string, item = false) => {
      const response = await send(config)(`${config.base}${path}`, {
        method: 'GET',
        headers,
        credentials: config.credentials ?? 'same-origin',
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      // A row that is gone is a row that isn't there, not a failed read.
      if (item && response.status === 404) return undefined;
      if (!response.ok) throw new Error(`${request.source}: the API answered ${response.status}`);
      return response.json();
    };
    const pick = Object.entries(spec.pick ?? {});
    const lift = (rows: readonly Row[]) =>
      pick.length === 0
        ? rows
        : rows.map((row) => ({
            ...row,
            ...Object.fromEntries(pick.map(([name, path]) => [name, pointer(row, path)])),
          }));

    const key = spec.key ?? 'id';
    const byKey = request.filter.find(
      (filter) => filter.field === key && (filter.op === 'eq' || filter.op === 'in'),
    );
    if (spec.item && byKey && spec.filters?.[`${key}:${byKey.op}`] === undefined) {
      const item = spec.item;
      const found = await Promise.all(
        byKey.values.slice(0, request.limit).map(async (value) => {
          const segment = pathSegment(text(value));
          if (segment === undefined) return [];
          const body = await get(item.path.replace(/\{[^}]+\}/, segment), true);
          const row = pointer(body, item.row ?? '');
          return row !== null && typeof row === 'object' ? [row as Row] : [];
        }),
      );
      // The item endpoint applies no other filter, so apply the rest here.
      const others = request.filter.filter((filter) => filter !== byKey);
      const rows = lift(found.flat()).filter((row) =>
        others.every((filter) => matchStored(row[filter.field], filter.op, filter.values)),
      );
      return { rows };
    }

    const size = spec.limit ?? 'limit';
    const params: [string, string][] = Object.entries(spec.query ?? {});
    if (size !== '') params.push([size, String(request.limit)]);
    // Core counts on whatever it pushed down being applied, so nothing pushed is dropped.
    for (const filter of request.filter) {
      const name = spec.filters?.[`${filter.field}:${filter.op}`];
      const [low, high] = filter.values;
      const gte = spec.filters?.[`${filter.field}:gte`];
      const lte = spec.filters?.[`${filter.field}:lte`];
      if (name) {
        if (spec.repeat?.includes(name)) {
          for (const value of filter.values) params.push([name, text(value)]);
        } else {
          params.push([name, filter.values.map(text).join(',')]);
        }
      } else if (filter.op === 'between' && gte && lte && low !== undefined && high !== undefined) {
        params.push([gte, text(low)], [lte, text(high)]);
      } else {
        throw new Error(`${request.source} can't filter ${filter.field} by ${filter.op}`);
      }
    }
    if (request.sort.length > 0 && !spec.sort) throw new Error(`${request.source} can't sort`);
    for (const order of request.sort) {
      const sort = spec.sort as NonNullable<RestSource['sort']>;
      params.push([
        sort.param,
        sort.format === '-field'
          ? `${order.direction === 'desc' ? '-' : ''}${order.field}`
          : `${order.field}:${order.direction}`,
      ]);
    }
    if (request.search && !spec.search) throw new Error(`${request.source} can't search`);
    if (request.search && spec.search) params.push([spec.search, request.search]);
    const pagination = spec.pagination ?? { kind: 'none' };
    if (request.cursor !== undefined && pagination.kind !== 'none') {
      params.push([pagination.param, request.cursor]);
    }

    const body = await get(`${spec.path}${params.length === 0 ? '' : `?${encode(params)}`}`);
    const found = pointer(body, spec.rows ?? '');
    const rows = lift(Array.isArray(found) ? (found as Row[]) : []);
    // An API may cap its pages below the limit asked for, so its own word on more rows wins.
    const pointed =
      pagination.kind === 'cursor' && pagination.next !== undefined
        ? pointer(body, pagination.next)
        : undefined;
    const more =
      spec.more !== undefined
        ? pointer(body, spec.more) === true
        : pagination.kind === 'cursor' && pagination.next !== undefined
          ? pointed !== undefined && pointed !== null && pointed !== ''
          : rows.length >= request.limit;
    let next: string | undefined;
    if (more && rows.length > 0) {
      if (pagination.kind === 'cursor') {
        const token =
          pagination.next === undefined
            ? rows[rows.length - 1]?.[key]
            : pointer(body, pagination.next);
        next = token === undefined || token === null ? undefined : String(token);
      } else if (pagination.kind === 'offset') {
        next = String(Number(request.cursor ?? 0) + rows.length);
      } else if (pagination.kind === 'page') {
        next = String(Number(request.cursor ?? 1) + 1);
      }
    }
    return { rows, ...(next === undefined ? {} : { next }) };
  };
}

/** A perform binding over REST endpoints: path placeholders from params, the rest as the body. */
export function restPerform(config: RestPerformConfig): Perform {
  return async (params, context) => {
    const spec = Object.hasOwn(config.actions, context.action)
      ? config.actions[context.action]
      : undefined;
    if (!spec) throw new Error(`No endpoint for ${context.action}`);
    const remaining: Row = { ...(params as Row) };
    const path = spec.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const value = remaining[name];
      delete remaining[name];
      if (value === undefined || value === null) throw new Error(`${context.action} needs ${name}`);
      const segment = pathSegment(String(value));
      if (segment === undefined)
        throw new Error(`${context.action} can't use "${value}" as ${name}`);
      return segment;
    });
    const form = (spec.body ?? 'json') === 'form';
    const entries = Object.entries(remaining).filter(
      ([, value]) => value !== undefined && value !== null,
    );
    const body =
      spec.method === 'DELETE' || entries.length === 0
        ? undefined
        : form
          ? encode(entries.map(([name, value]) => [name, String(value)] as const))
          : JSON.stringify(Object.fromEntries(entries));
    const response = await send(config)(`${config.base}${path}`, {
      method: spec.method,
      headers: {
        accept: 'application/json',
        ...(body === undefined
          ? {}
          : { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }),
        ...(config.idempotency === undefined
          ? {}
          : { [config.idempotency]: context.idempotencyKey }),
        ...(await config.headers?.(context)),
      },
      credentials: config.credentials ?? 'same-origin',
      ...(body === undefined ? {} : { body }),
    });
    if (!response.ok) throw new Error(`The API refused ${context.action} (${response.status})`);
  };
}
