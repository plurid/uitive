import { ID_PATTERN, OPS, SLUG_PATTERN, SURFACE_PATTERN } from '@plurid/uitive-core';
import { z } from 'zod';

const fetchRequest = z.object({
  source: z.string(),
  fields: z.array(z.string()),
  filter: z.array(
    z.object({
      field: z.string(),
      op: z.enum(OPS),
      values: z.array(z.union([z.string(), z.number(), z.boolean()])),
    }),
  ),
  sort: z.array(z.object({ field: z.string(), direction: z.enum(['asc', 'desc']) })),
  limit: z.number().int().positive(),
  cursor: z.string().optional(),
  search: z.string().optional(),
});

/** Everything the worker accepts, checked before it does anything. */
export const toWorker = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('site.status'), tabId: z.number().int() }),
  z.object({ kind: z.literal('site.enable'), origin: z.url() }),
  /** Stops running on a site and gives back the access it needed; the interface stays. */
  z.object({ kind: z.literal('site.disable'), origin: z.url() }),
  z.object({ kind: z.literal('secret.set'), name: z.string(), value: z.string().min(1).max(512) }),
  z.object({ kind: z.literal('secret.clear'), name: z.string() }),
  z.object({ kind: z.literal('secret.status') }),
  z.object({ kind: z.literal('usage') }),
  /**
   * Erases everything the extension keeps (interfaces, repairs, meters, cached rows and keys),
   * stops it on every site and gives back every site's access.
   */
  z.object({ kind: z.literal('forget') }),
  z.object({
    kind: z.literal('fetch'),
    adapter: z.string(),
    mode: z.enum(['test', 'live']),
    request: fetchRequest,
  }),
  /** Which connectors have a key for each mode, so a page can say which sources it can read. */
  z.object({ kind: z.literal('keys'), adapter: z.string() }),
]);
export type ToWorker = z.infer<typeof toWorker>;

/** What the side panel asks the page's content script. */
export const toContent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot') }),
  z.object({ kind: z.literal('ask'), text: z.string().min(1).max(500) }),
  z.object({ kind: z.literal('revert'), operation: z.string() }),
  z.object({ kind: z.literal('reset') }),
  z.object({ kind: z.literal('original'), on: z.boolean() }),
  z.object({ kind: z.literal('resume') }),
  /** Repairs an anchor: the person clicks the element it should name. */
  z.object({ kind: z.literal('pick'), anchor: z.string() }),
  z.object({ kind: z.literal('repairs.clear') }),
  /** A page design to apply as the person's own, checked by policy like any plan. */
  z.object({ kind: z.literal('page'), surface: z.string(), value: z.unknown() }),
]);
export type ToContent = z.infer<typeof toContent>;

// What a plan request may hold, field by field: IDs where the contract has IDs, so nothing from
// the page can ride along in them, and the person's own words, capped as the server caps them.
const id = z.string().max(200).regex(ID_PATTERN);
const surface = z.string().max(100).regex(SURFACE_PATTERN);
const name = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9][\w.:-]*$/);
const context = z.union([id, z.literal('*')]);
const key = z
  .string()
  .max(400)
  .regex(/^[\w.:*|-]+$/);
const words = z.string().min(1).max(500);
const number = z.number().finite();
// Designs are the person's or a planner's, checked by policy; their size is capped below.
const design = z.unknown();

const usageRow = z.strictObject({
  surface,
  context: id.optional(),
  action: id,
  place: z.enum(['visible', 'overflow']),
  pinned: z.boolean(),
  uses: number,
  activeSessions: number,
  viaOverflow: number,
  viaPalette: number,
  viaSuggested: number,
  idleSessions: number,
  placement: number,
  activity: number,
  ranking: number,
});

const planRequest = z.strictObject({
  // Plans nobody asked for stay with the deterministic planner, which costs nothing.
  kind: z.literal('command'),
  contract: z.strictObject({ id: z.string().max(200), hash: z.string().max(100) }),
  session: z.number().int().nonnegative(),
  summary: z.strictObject({
    session: z.number().int().nonnegative(),
    window: z.number().int().nonnegative(),
    rows: z.array(usageRow).max(5_000),
    hash: z.string().max(100),
  }),
  state: z.strictObject({
    lists: z
      .array(
        z.strictObject({
          surface,
          context: id.optional(),
          visible: z.array(id).max(500),
          pinned: z.array(id).max(500),
        }),
      )
      .max(500),
    choices: z.record(surface, id),
    collections: z.record(surface, z.array(id).max(500)),
    pages: z
      .array(z.strictObject({ surface, context: context.optional(), value: design }))
      .max(100),
    userPages: z
      .array(z.strictObject({ slug: z.string().regex(SLUG_PATTERN), title: words }))
      .max(20),
    userPage: z.strictObject({ slug: z.string().regex(SLUG_PATTERN), value: design }).optional(),
    user: z.array(key).max(5_000),
    cooldowns: z.array(key).max(5_000),
    blocked: z.array(key).max(5_000),
    frozen: z.boolean(),
    recent: z.array(z.strictObject({ key, outcome: z.enum(['kept', 'reverted']) })).max(1_000),
  }),
  contexts: z.record(name, id),
  route: name.optional(),
  text: words,
  goal: words.optional(),
  environment: z
    .strictObject({
      route: name.nullable(),
      anchors: z.record(name, z.enum(['found', 'missing', 'ambiguous'])),
      sources: z.record(id, z.enum(['live', 'partial', 'unavailable'])),
      unmapped: z.strictObject({ links: number, buttons: number, tables: number }),
    })
    .optional(),
});

/** The most a plan request may weigh, as the server's handler allows by default. */
export const MAX_PLAN_REQUEST = 128 * 1024;

/** What the content script sends the planner port, checked strictly before any model sees it. */
export const planMessage = z
  .strictObject({ adapter: z.string().max(200), request: planRequest })
  .refine((message) => JSON.stringify(message.request).length <= MAX_PLAN_REQUEST, {
    message: 'The request is too large',
  });
export type PlanReply =
  | { kind: 'progress'; progress: { stage: 'planning' | 'repairing'; elements: number } }
  | { kind: 'result'; result: unknown }
  | { kind: 'error'; problem: string; code: 'no-key' | 'failed' | 'over-budget' };

/** A short account of the page for the side panel: structure and the interface, never content. */
export interface PageReport {
  adapter: { id: string; label: string };
  route: string | null;
  mode: 'test' | 'live';
  anchors: Record<string, 'found' | 'missing' | 'ambiguous'>;
  changes: { operation: string; title: string; reason: string; origin: string }[];
  /** The last request a planner was sent, exactly as it left the page. */
  lastRequest: unknown;
  original: boolean;
  /** Why the engine stopped following the page, when it did. */
  paused: string | null;
  /** How long keeping up with the page takes, in milliseconds. */
  timing: { syncs: number; p95: number };
  /** Anchors repaired on this device. */
  repairs: string[];
}
