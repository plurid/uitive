import { z } from 'zod';

/** Every type a field may have. */
export const FIELD_TYPES = ['text', 'number', 'money', 'time', 'enum', 'ref', 'bool'] as const;
/** What a field holds, which decides how it is filtered, sorted, summed and shown. */
export type FieldType = (typeof FIELD_TYPES)[number];

/** How instants are stored: ISO 8601 strings, or seconds or milliseconds since the epoch. */
export type TimeUnit = 'iso' | 's' | 'ms';

/** Field names appear in planner enums, so they must survive any casing. */
export const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Where field metadata lives on a zod schema, and in its JSON Schema. */
export const FIELD_META = 'x-uitive';

/** What a field helper records about a field, beyond its zod type. */
export interface FieldMeta {
  /** What the value means, which decides how it shows and filters. */
  type: FieldType;
  /** Shown to people. @default the field's name, humanized */
  label?: string;
  /** For money: the field holding each row's ISO 4217 currency code. */
  currency?: string;
  /** For money: one ISO 4217 currency for every row. */
  code?: string;
  /** For money: whether amounts are stored in minor units, such as cents. @default false */
  minor?: boolean;
  /** For time: how instants are stored. */
  unit?: TimeUnit;
  /** For ref: the source whose key this field holds. */
  source?: string;
}

/** One field of a source's rows, as everything after the contract sees it. */
export interface Field {
  /** The field's name in its source's rows. */
  name: string;
  /** What the value means, which decides how it shows and filters. */
  type: FieldType;
  /** What people call it. */
  label: string;
  /** What it holds, for people and models. */
  description: string;
  /** Whether rows may lack a value. */
  nullable: boolean;
  /** For enums: every value. */
  values: readonly string[];
  /** For refs: the source whose key the field holds. */
  source?: string;
  /** For money: the field holding each row's currency. */
  currency?: string;
  /** For money: one currency for every row. */
  code?: string;
  /** For money: whether amounts are in minor units. */
  minor: boolean;
  /** For time: how instants are stored. */
  unit?: TimeUnit;
}

/** What every field helper takes. */
export interface FieldOptions {
  /** Shown to people, such as a column's header. @default the field's name, humanized */
  label?: string;
  /** What the field holds, for planners and for people. */
  description?: string;
}

const tag = <T extends z.ZodType>(schema: T, meta: FieldMeta, options: FieldOptions = {}): T => {
  const { description, ...rest } = options;
  return schema.meta({
    [FIELD_META]: { ...meta, ...rest },
    ...(description === undefined ? {} : { description }),
  }) as T;
};

function time(options?: FieldOptions & { unit?: 'iso' }): z.ZodString;
function time(options: FieldOptions & { unit: 's' | 'ms' }): z.ZodNumber;
function time(options: FieldOptions & { unit?: TimeUnit } = {}): z.ZodString | z.ZodNumber {
  const { unit = 'iso', ...rest } = options;
  return unit === 'iso'
    ? tag(z.string(), { type: 'time', unit }, rest)
    : tag(z.number(), { type: 'time', unit }, rest);
}

/**
 * Field helpers: zod schemas that also say what a value means, such as money in cents or a
 * reference to another source. Plain zod types work too, with their meaning inferred.
 */
export const field = {
  /** Text, such as a name or a description. */
  text: (options?: FieldOptions) => tag(z.string(), { type: 'text' }, options),
  /** A number that isn't money, such as a count. */
  number: (options?: FieldOptions) => tag(z.number(), { type: 'number' }, options),
  /** `currency` names the field holding each row's currency; `code` fixes one for every row. */
  money: (options: FieldOptions & { currency?: string; code?: string; minor?: boolean } = {}) => {
    const { currency, code, minor, ...rest } = options;
    return tag(
      z.number(),
      {
        type: 'money',
        ...(currency === undefined ? {} : { currency }),
        ...(code === undefined ? {} : { code: code.toUpperCase() }),
        ...(minor === undefined ? {} : { minor }),
      },
      rest,
    );
  },
  /** A moment: an ISO string, or seconds or milliseconds since the epoch with `unit`. */
  time,
  /** One of a fixed set of values, such as a status. */
  enum: <const V extends readonly [string, ...string[]]>(
    values: V,
    options?: FieldOptions,
  ): z.ZodEnum<{ [K in V[number]]: K }> => tag(z.enum(values), { type: 'enum' }, options),
  /** The key of a row in another source, which makes the field a relation. */
  ref: (source: string, options?: FieldOptions) =>
    tag(z.string(), { type: 'ref', source }, options),
  /** Yes or no. */
  bool: (options?: FieldOptions) => tag(z.boolean(), { type: 'bool' }, options),
};

const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'readonly',
  'nonoptional',
]);

interface Def {
  type: string;
  format?: string;
  innerType?: z.ZodType;
  entries?: Record<string, string>;
  values?: readonly unknown[];
}

const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** Describes every field of a row schema. Throws on fields a source can't hold. */
export function describeFields(row: z.ZodType, owner = 'row'): Field[] {
  const shape = (row as { shape?: Record<string, z.ZodType> }).shape;
  if (defOf(row).type !== 'object' || !shape) throw new Error(`${owner}: rows must be z.object`);
  return Object.entries(shape).map(([name, schema]) => describeField(name, schema, owner));
}

function describeField(name: string, schema: z.ZodType, owner: string): Field {
  if (!FIELD_PATTERN.test(name)) {
    throw new Error(`${owner}: field "${name}" must match ${FIELD_PATTERN}`);
  }
  let inner = schema;
  let nullable = false;
  let meta = metaOf(inner);
  while (WRAPPERS.has(defOf(inner).type)) {
    const type = defOf(inner).type;
    if (type === 'optional' || type === 'nullable' || type === 'default') nullable = true;
    inner = defOf(inner).innerType as z.ZodType;
    meta = { ...metaOf(inner), ...meta };
  }
  const def = defOf(inner);
  const tagged = meta[FIELD_META] as Partial<FieldMeta> | undefined;
  const description = typeof meta.description === 'string' ? meta.description : '';
  const fail = (message: string): never => {
    throw new Error(`${owner}: field "${name}" ${message}`);
  };

  let type: FieldType;
  let values: string[] = [];
  if (def.type === 'enum') {
    type = 'enum';
    values = Object.values(def.entries ?? {});
  } else if (def.type === 'literal') {
    type = 'enum';
    values = (def.values ?? []).map(String);
  } else if (def.type === 'string') {
    type = def.format === 'datetime' || def.format === 'date' ? 'time' : 'text';
  } else if (def.type === 'number' || def.type === 'int') {
    type = 'number';
  } else if (def.type === 'boolean') {
    type = 'bool';
  } else {
    return fail(`is a ${def.type}; sources hold flat values, so flatten it or leave it out`);
  }

  if (tagged?.type !== undefined) {
    const allowed: Record<FieldType, readonly FieldType[]> = {
      text: ['text', 'enum', 'time', 'ref'],
      number: ['number', 'money', 'time'],
      bool: ['bool'],
      enum: ['enum'],
      time: ['time'],
      money: [],
      ref: [],
    };
    if (!allowed[type].includes(tagged.type)) fail(`can't be ${tagged.type}`);
    type = tagged.type;
  }
  if (type === 'ref' && typeof tagged?.source !== 'string') fail('needs the source it refers to');

  const unit =
    tagged?.unit ?? (type === 'time' ? (def.type === 'string' ? 'iso' : 'ms') : undefined);
  return {
    name,
    type,
    label: typeof tagged?.label === 'string' ? tagged.label : humanize(name),
    description,
    nullable,
    values,
    ...(tagged?.source === undefined ? {} : { source: tagged.source }),
    ...(tagged?.currency === undefined ? {} : { currency: tagged.currency }),
    ...(tagged?.code === undefined ? {} : { code: tagged.code }),
    minor: tagged?.minor === true,
    ...(unit === undefined ? {} : { unit }),
  };
}

function metaOf(schema: z.ZodType): Record<string, unknown> {
  return (z.globalRegistry.get(schema) as Record<string, unknown> | undefined) ?? {};
}

/** `amount_refunded` and `amountRefunded` both read "Amount refunded". */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Decimal places of a currency's minor unit, such as 2 for USD and 0 for JPY. */
export function currencyDigits(code: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}
