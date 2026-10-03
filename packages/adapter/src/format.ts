import { z } from 'zod';

/** What an adapter says it is, in its `format` field. */
export const ADAPTER_FORMAT = 'uitive.adapter';
/** The adapter format's version. */
export const ADAPTER_VERSION = 1;

/**
 * One way to find an element, tried in order: `href` survives translation, then a test id,
 * then a role with its name in each locale, then visible text, then CSS as a last resort.
 */
const strategy = z.union([
  z.object({ href: z.string().min(1) }).strict(),
  z.object({ testId: z.string().min(1) }).strict(),
  z.object({ role: z.string().min(1), name: z.array(z.string()).optional() }).strict(),
  z.object({ text: z.array(z.string()).min(1) }).strict(),
  z.object({ css: z.string().min(1) }).strict(),
]);

const anchor = z
  .object({
    /** An anchor this one is inside, such as the navigation for its links. */
    within: z.string().optional(),
    /** Strategies in order; the first with exactly one match wins. */
    match: z.array(strategy).min(1),
    /** Never hidden or covered, such as notices and warnings. @default false */
    required: z.boolean().default(false),
  })
  .strict();

const route = z
  .object({
    /** A regular expression over the path, with named groups for params, such as `(?<id>ch_\w+)`. */
    path: z.string().min(1),
    /** The contract's route this is. */
    route: z.string().min(1),
  })
  .strict();

const restSource = z
  .object({
    path: z.string().startsWith('/'),
    rows: z.string().optional(),
    filters: z.record(z.string(), z.string()).optional(),
    repeat: z.array(z.string()).optional(),
    limit: z.string().optional(),
    pagination: z
      .union([
        z
          .object({ kind: z.literal('cursor'), param: z.string(), next: z.string().optional() })
          .strict(),
        z.object({ kind: z.enum(['offset', 'page']), param: z.string() }).strict(),
        z.object({ kind: z.literal('none') }).strict(),
      ])
      .optional(),
    more: z.string().optional(),
    sort: z
      .object({ param: z.string(), format: z.enum(['field:direction', '-field']) })
      .strict()
      .optional(),
    search: z.string().optional(),
    key: z.string().optional(),
    pick: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.string()).optional(),
    item: z.object({ path: z.string(), row: z.string().optional() }).strict().optional(),
  })
  .strict();

/** An official API the extension may read for a source, with a key the person gives it. */
const connector = z
  .object({
    label: z.string().min(1),
    base: z.url(),
    /** What a key must look like, by the page's mode; anything else is refused. */
    keys: z.object({ test: z.string(), live: z.string() }).strict(),
    /** Path patterns that mean the page is in test mode. */
    testMode: z.string().optional(),
    sources: z.record(
      z.string(),
      restSource.extend({
        /** The key permission the source needs, to name it when missing. */ permission: z.string(),
      }),
    ),
    /** Requests a second at most, and at once. */
    rate: z
      .object({ perSecond: z.number().positive(), concurrent: z.number().int().positive() })
      .strict(),
  })
  .strict();

/**
 * An adapter's shape: a JSON contract plus anchors, routes, lists, regions, pages and official API
 * connectors for one site.
 */
export const adapterSchema = z
  .object({
    format: z.literal(ADAPTER_FORMAT),
    formatVersion: z.literal(ADAPTER_VERSION),
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    label: z.string().min(1),
    /** Origins the adapter applies to, such as `https://dashboard.example.com`. */
    origins: z.array(z.url()).min(1),
    /** The JSON contract (`toJson`), checked when loaded. */
    contract: z.record(z.string(), z.unknown()),
    anchors: z.record(z.string(), anchor),
    routes: z.array(route),
    /** List surfaces: the anchor holding the items, and each item's anchor, by action. */
    lists: z.record(
      z.string(),
      z.object({ container: z.string(), items: z.record(z.string(), z.string()) }).strict(),
    ),
    /** The anchor each region is. */
    regions: z.record(z.string(), z.object({ anchor: z.string() }).strict()),
    /** Which route shows each page surface, and the region its original page is. */
    pages: z.record(z.string(), z.object({ route: z.string(), region: z.string() }).strict()),
    connectors: z.record(z.string(), connector).default({}),
  })
  .strict();

/** An adapter, checked: how Uitive applies a contract to a site it doesn't own. */
export type Adapter = z.infer<typeof adapterSchema>;
/** An adapter as written, before defaults fill in. */
export type AdapterInput = z.input<typeof adapterSchema>;
/**
 * How an adapter finds one part of a page: where to look, and strategies tried in order until
 * exactly one element matches.
 */
export type Anchor = Adapter['anchors'][string];
/** One way of finding an element: by its link, test ID, role and name, text or CSS selector. */
export type Strategy = Anchor['match'][number];
/**
 * An official API an adapter reads with the person's own restricted key: its endpoints, key
 * patterns and rate.
 */
export type Connector = Adapter['connectors'][string];
