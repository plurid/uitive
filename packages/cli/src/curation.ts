import { EFFECTS, OPS } from '@plurid/aptuitive-core';
import { z } from 'zod';
import type { ApiAction, ApiField, ApiInventory, ApiSource } from './openapi.js';

const sourceCuration = z
  .object({
    include: z.boolean().optional(),
    label: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    keywords: z.array(z.string()).optional(),
    /** Exactly these fields, besides the key and picks. */
    fields: z.array(z.string()).optional(),
    /** What people call fields whose names don't say, such as `{ "display_id": "Order" }`. */
    labels: z.record(z.string(), z.string().min(1)).optional(),
    /** Values lifted from nested objects: field name to JSON pointer, such as `/card/brand`. */
    pick: z.record(z.string(), z.string().startsWith('/')).optional(),
    /** Parameters sent with every list request, such as `expand[]` for picked objects. */
    query: z.record(z.string(), z.string()).optional(),
    title: z.string().optional(),
    summary: z.array(z.string()).optional(),
    scan: z.number().int().positive().optional(),
    ttl: z.number().int().nonnegative().optional(),
  })
  .strict();

const actionCuration = z
  .object({
    include: z.boolean().optional(),
    label: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    effect: z.enum(EFFECTS).optional(),
    /** Why an effect is lowered, such as "refunds need a second approval in our backend". */
    reason: z.string().min(1).optional(),
    confirm: z.string().min(1).max(80).optional(),
    /** Exactly these params, besides the path's. */
    params: z.array(z.string()).optional(),
    when: z
      .array(z.object({ field: z.string(), op: z.enum(OPS), values: z.array(z.string()) }).strict())
      .optional(),
  })
  .strict();

/** `aptuitive/curation.json`: what to keep from an API description, kept across regenerations. */
export const curationSchema = z
  .object({
    $schema: z.string().optional(),
    /** Whether sources the file doesn't mention are kept. Actions follow their source. */
    default: z.enum(['include', 'exclude']).default('include'),
    /** Keeps no actions, for interfaces that only read, such as a browser extension. */
    readOnly: z.boolean().default(false),
    sources: z.record(z.string(), sourceCuration).default({}),
    actions: z.record(z.string(), actionCuration).default({}),
  })
  .strict();

/** A curation, read: what to keep from an API description, with defaults filled in. */
export type Curation = z.infer<typeof curationSchema>;
/** A curation as written in `curation.json`. */
export type CurationInput = z.input<typeof curationSchema>;

/** Reads a curation, or names every problem with it, such as a key that doesn't exist. */
export function parseCuration(value: unknown): { curation: Curation } | { problems: string[] } {
  const parsed = curationSchema.safeParse(value);
  if (parsed.success) return { curation: parsed.data };
  return {
    problems: parsed.error.issues.map(
      (issue) =>
        `curation${issue.path.map((part) => `.${String(part)}`).join('')}: ${issue.message}`,
    ),
  };
}

/** The picks a curation asks for, by source, for `inventory`. */
export function picksOf(curation: Curation): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(curation.sources).flatMap(([id, entry]) =>
      entry.pick ? [[id, entry.pick]] : [],
    ),
  );
}

const RANK = { read: 0, write: 1, destructive: 2 } as const;

/**
 * Applies a curation: keeps the sources it chooses and their actions, and its overrides. Effects
 * may be raised freely and lowered only with a stated reason. Problems name every reference that
 * doesn't resolve, so a typo never passes silently.
 */
export function curate(
  inventory: ApiInventory,
  curation: Curation,
): { inventory: ApiInventory; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map(inventory.sources.map((entry) => [entry.id, entry]));
  const actionIds = new Set(inventory.actions.map((entry) => entry.id));
  for (const id of Object.keys(curation.sources)) {
    if (!byId.has(id)) problems.push(`sources.${id}: no such source`);
  }
  for (const id of Object.keys(curation.actions)) {
    if (!actionIds.has(id)) problems.push(`actions.${id}: no such action`);
  }

  const sources: ApiSource[] = [];
  for (const entry of inventory.sources) {
    const choice = curation.sources[entry.id];
    if (!(choice?.include ?? curation.default === 'include')) continue;
    const where = `sources.${entry.id}`;
    const all = new Map<string, ApiField>(
      [...entry.fields, ...entry.extra].map((field) => [field.name, field]),
    );
    let fields = entry.fields;
    if (choice?.fields) {
      const wanted = new Set([entry.key, ...choice.fields, ...Object.keys(choice.pick ?? {})]);
      for (const name of choice.fields) {
        if (!all.has(name)) {
          const skipped = entry.skipped.find((item) => item.name === name);
          problems.push(
            `${where}.fields: no field "${name}"${skipped ? ` (left out: ${skipped.reason})` : ''}`,
          );
        }
      }
      // Money needs the field that says its currency.
      for (const name of [...wanted]) {
        const currency = all.get(name)?.currency;
        if (currency !== undefined) wanted.add(currency);
      }
      fields = [...all.values()].filter((field) => wanted.has(field.name));
    }
    const names = new Set(fields.map((field) => field.name));
    const labels = choice?.labels ?? {};
    for (const name of Object.keys(labels)) {
      if (!names.has(name)) problems.push(`${where}.labels: no field "${name}"`);
    }
    fields = fields.map((field) => {
      const label = labels[field.name];
      return label === undefined ? field : { ...field, label };
    });
    const title = choice?.title ?? (names.has(entry.title) ? entry.title : entry.key);
    if (!names.has(title)) problems.push(`${where}.title: no field "${title}"`);
    const summary = (choice?.summary ?? entry.summary).filter((name) => {
      if (names.has(name)) return true;
      if (choice?.summary) problems.push(`${where}.summary: no field "${name}"`);
      return false;
    });
    const filter = Object.fromEntries(
      Object.entries(entry.capabilities.filter).filter(([name]) => names.has(name)),
    );
    sources.push({
      ...entry,
      ...(choice?.label ? { label: choice.label } : {}),
      ...(choice?.description ? { description: choice.description } : {}),
      ...(choice?.keywords ? { keywords: choice.keywords } : {}),
      title,
      summary: summary.length > 0 ? summary : [title],
      fields,
      extra: [...all.values()].filter((field) => !names.has(field.name)),
      capabilities: {
        ...entry.capabilities,
        filter,
        sort: entry.capabilities.sort.filter((name) => names.has(name)),
      },
      rest: {
        ...entry.rest,
        ...(choice?.query ? { query: { ...entry.rest.query, ...choice.query } } : {}),
      },
      ...(choice?.scan === undefined ? {} : { scan: choice.scan }),
      ...(choice?.ttl === undefined ? {} : { ttl: choice.ttl }),
    });
  }

  const kept = new Set(sources.map((entry) => entry.id));
  const actions: ApiAction[] = [];
  for (const entry of curation.readOnly ? [] : inventory.actions) {
    const choice = curation.actions[entry.id];
    const follows =
      entry.resource === null ? curation.default === 'include' : kept.has(entry.resource);
    if (!(choice?.include ?? follows)) continue;
    const where = `actions.${entry.id}`;
    let params = entry.params;
    if (choice?.params) {
      const wanted = new Set(choice.params);
      for (const name of choice.params) {
        if (!entry.params.some((param) => param.name === name)) {
          const skipped = entry.skipped.find((item) => item.name === name);
          problems.push(
            `${where}.params: no param "${name}"${skipped ? ` (left out: ${skipped.reason})` : ''}`,
          );
        }
      }
      const path = new Set([...entry.rest.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]));
      params = entry.params.filter((param) => path.has(param.name) || wanted.has(param.name));
    }
    let effect = entry.effect;
    let reason = entry.reason;
    if (choice?.effect) {
      if (RANK[choice.effect] < RANK[entry.effect] && !choice.reason) {
        problems.push(
          `${where}.effect: lowering ${entry.effect} to ${choice.effect} needs a reason`,
        );
      } else {
        effect = choice.effect;
        reason = choice.reason ?? `set by the curation`;
      }
    }
    actions.push({
      ...entry,
      ...(choice?.label ? { label: choice.label } : {}),
      ...(choice?.description ? { description: choice.description } : {}),
      ...(choice?.confirm ? { confirm: choice.confirm } : {}),
      ...(choice?.when ? { when: choice.when } : {}),
      effect,
      reason,
      params,
      invalidates: entry.invalidates.filter((id) => kept.has(id)),
    });
  }
  return { inventory: { ...inventory, sources, actions }, problems };
}
