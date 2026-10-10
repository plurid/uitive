import { z } from 'zod';
import {
  DATA_PATTERN,
  ELEMENT_PATTERN,
  ID_PATTERN,
  SLUG_PATTERN,
  SOURCE_PATTERN,
  SURFACE_PATTERN,
  TITLE_LENGTH,
} from '@plurid/uitive-core';

/** The longest request or goal, in characters. */
const TEXT_LIMIT = 500;

const id = z.string().max(200).regex(ID_PATTERN);
const surface = z.string().max(100).regex(SURFACE_PATTERN);
/** A context value, or `*` for every value of a page's context. */
const context = z.union([id, z.literal('*')]);
/** An operation key, such as `nav||promote|mail.archive`: IDs joined by bars. */
const key = z
  .string()
  .max(400)
  .regex(/^[A-Za-z0-9.:*|-]*$/);
const count = z.number().int().min(0).max(1e9);
const score = z.number().min(-1e9).max(1e9);
const ids = (most: number) => z.array(id).max(most);
/** An adapter's name for an anchor, such as `nav.home`. */
const anchor = z
  .string()
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const page = z.object({
  root: z.string().max(40),
  elements: z
    .array(
      z.object({
        id: z.string().max(40).regex(ELEMENT_PATTERN),
        block: z.string().max(100),
        props: z.record(z.string().max(100), z.unknown()),
        children: z.array(z.string().max(40)).max(500),
      }),
    )
    .max(500),
  data: z
    .array(
      z.object({
        name: z.string().max(32).regex(DATA_PATTERN),
        query: z.looseObject({ source: z.string().max(100).regex(SOURCE_PATTERN) }),
      }),
    )
    .max(50),
});

/**
 * What a planner may be sent, as data from a client: every field typed, every string and list
 * capped, the request and goal at most 500 characters, and the environment structure only
 * (patterned names, counts and states). The handler answers 400 to anything else, before any model
 * sees it.
 */
export const planRequestSchema = z.object({
  kind: z.enum(['plan', 'command']),
  contract: z.object({ id: z.string().max(200), hash: z.string().max(200) }),
  session: count,
  summary: z.object({
    session: count,
    window: count,
    rows: z
      .array(
        z.object({
          surface,
          context: id.optional(),
          action: id,
          place: z.enum(['visible', 'overflow']),
          pinned: z.boolean(),
          uses: count,
          activeSessions: count,
          viaOverflow: count,
          viaPalette: count,
          viaSuggested: count,
          idleSessions: count,
          placement: score,
          activity: score,
          ranking: score,
        }),
      )
      .max(10_000),
    hash: z.string().max(200),
  }),
  state: z.object({
    lists: z
      .array(
        z.object({
          surface,
          context: id.optional(),
          visible: ids(1000),
          pinned: ids(1000),
        }),
      )
      .max(1000),
    choices: z.record(surface, id),
    collections: z.record(surface, z.array(z.string().max(TITLE_LENGTH)).max(200)),
    pages: z.array(z.object({ surface, context: context.optional(), value: page })).max(50),
    userPages: z
      .array(
        z.object({ slug: z.string().regex(SLUG_PATTERN), title: z.string().max(TITLE_LENGTH) }),
      )
      .max(50),
    userPage: z.object({ slug: z.string().regex(SLUG_PATTERN), value: page }).optional(),
    user: z.array(key).max(2000),
    cooldowns: z.array(key).max(2000),
    blocked: z.array(key).max(2000),
    frozen: z.boolean(),
    recent: z.array(z.object({ key, outcome: z.enum(['kept', 'reverted']) })).max(200),
  }),
  contexts: z.record(surface, id),
  route: id.optional(),
  text: z.string().max(TEXT_LIMIT).optional(),
  goal: z.string().max(TEXT_LIMIT).optional(),
  environment: z
    .object({
      route: id.nullable(),
      anchors: z.record(anchor, z.enum(['found', 'missing', 'ambiguous'])),
      sources: z.record(
        z.string().max(100).regex(SOURCE_PATTERN),
        z.enum(['live', 'partial', 'unavailable']),
      ),
      unmapped: z.object({ links: count, buttons: count, tables: count }),
    })
    .optional(),
});
