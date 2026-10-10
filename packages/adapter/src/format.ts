import { z } from 'zod';

/** What an adapter says it is, in its `format` field. */
export const ADAPTER_FORMAT = 'uitive.adapter';
/** The adapter format's version. */
export const ADAPTER_VERSION = 2;

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
    repeat: z.array(z.string()).readonly().optional(),
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

/**
 * What a connector's keys must look like, and how the side panel names them. Patterns are
 * regular expressions; a refused key is turned away with its reason before the patterns apply.
 */
const keys = z
  .object({
    /** What a key for live data must look like. */
    live: z.string().min(1),
    /** What a key for test data must look like; required when the adapter has a test mode. */
    test: z.string().min(1).optional(),
    /** Keys refused whatever the mode, such as secret keys where read-only ones do. @default [] */
    refuse: z
      .array(z.object({ pattern: z.string().min(1), reason: z.string().min(1).max(200) }).strict())
      .default([]),
    /** What the key is called, such as `restricted key`. @default 'API key' */
    label: z.string().min(1).max(40).default('API key'),
    /** What a key looks like, shown in the empty field, by mode. */
    hint: z
      .object({ test: z.string().max(40).optional(), live: z.string().max(40).optional() })
      .strict()
      .optional(),
  })
  .strict();

/** How a connector sends its key: in a header, after a prefix such as `Bearer `. */
const auth = z
  .object({
    /** The header that carries the key, such as `authorization`. */
    header: z.string().regex(/^[A-Za-z0-9-]+$/),
    /** What comes before the key in it. @default '' */
    prefix: z.string().max(20).default(''),
  })
  .strict();

/** An official API the extension may read for a source, with a key the person gives it. */
const connector = z
  .object({
    label: z.string().min(1),
    base: z.url(),
    /** How a request carries the key. @default { header: 'authorization', prefix: 'Bearer ' } */
    auth: auth.default({ header: 'authorization', prefix: 'Bearer ' }),
    keys,
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
    /**
     * A path pattern that means the page shows test data, such as `^/test/`. Without one, the site
     * has a single mode, and its connectors' keys are live keys.
     */
    testMode: z.string().min(1).optional(),
    /** Requests the side panel suggests, such as "hide Billing". @default [] */
    examples: z.array(z.string().min(1).max(160)).max(3).default([]),
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
 * An official API an adapter reads with the person's own key: its endpoints, how it sends the key,
 * what keys it takes and its rate.
 */
export type Connector = Adapter['connectors'][string];
