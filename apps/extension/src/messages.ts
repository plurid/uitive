import { OPS } from '@plurid/uitive-core';
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
  z.object({ kind: z.literal('site.disable'), origin: z.url() }),
  z.object({ kind: z.literal('secret.set'), name: z.string(), value: z.string().min(1).max(512) }),
  z.object({ kind: z.literal('secret.clear'), name: z.string() }),
  z.object({ kind: z.literal('secret.status') }),
  z.object({ kind: z.literal('usage') }),
  /** Erases everything the extension keeps: interfaces, repairs, meters, cached rows and keys. */
  z.object({ kind: z.literal('forget') }),
  z.object({
    kind: z.literal('fetch'),
    adapter: z.string(),
    mode: z.enum(['test', 'live']),
    request: fetchRequest,
  }),
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

/** What the content script sends the planner port, and gets back. */
export const planMessage = z.object({
  adapter: z.string(),
  request: z.record(z.string(), z.unknown()),
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
