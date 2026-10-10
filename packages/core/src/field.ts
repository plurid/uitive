import { z } from 'zod';

/** Every type a field may have. */
export const FIELD_TYPES = ['text', 'number', 'money', 'time', 'enum', 'ref', 'bool'] as const;
/** What a field holds, which decides how it is filtered, sorted, summed and shown. */
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * How instants are stored: ISO 8601 date-times, ISO 8601 dates (`2026-10-03`, a day in the
 * person's time zone), or seconds or milliseconds since the epoch.
 */
export type TimeUnit = 'iso' | 'date' | 's' | 'ms';

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
  /**
   * For money in minor units: decimal places by currency where the API's minor units differ from
   * ISO 4217's, such as `{ ISK: 2, MGA: 0 }` for Stripe. @default {}
   */
  digits?: Readonly<Record<string, number>>;
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
  /** For money in minor units: decimal places by currency, where they differ from ISO 4217's. */
  digits?: Readonly<Record<string, number>>;
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

/** What `field.money` takes: where each amount's currency comes from, and how it is stored. */
export interface MoneyOptions extends FieldOptions {
  /** The field holding each row's ISO 4217 currency code. */
  currency?: string;
  /** One ISO 4217 currency for every row. */
  code?: string;
  /** Whether amounts are stored in minor units, such as cents. @default false */
  minor?: boolean;
  /**
   * For minor units: decimal places by currency where the API's minor units differ from ISO
   * 4217's, such as `{ ISK: 2, MGA: 0 }` for Stripe. @default {}
   */
  digits?: Readonly<Record<string, number>>;
}

const tag = <T extends z.ZodType>(schema: T, meta: FieldMeta, options: FieldOptions = {}): T => {
  const { description, ...rest } = options;
  return schema.meta({
    [FIELD_META]: { ...meta, ...rest },
    ...(description === undefined ? {} : { description }),
  }) as T;
};

function time(options?: FieldOptions & { unit?: 'iso' | 'date' }): z.ZodString;
function time(options: FieldOptions & { unit: 's' | 'ms' }): z.ZodNumber;
function time(options: FieldOptions & { unit?: TimeUnit } = {}): z.ZodString | z.ZodNumber {
  const { unit = 'iso', ...rest } = options;
  return unit === 'iso' || unit === 'date'
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
  /**
   * `currency` names the field holding each row's currency; `code` fixes one for every row;
   * `minor` stores amounts in minor units, with ISO 4217's decimal places unless `digits` says
   * otherwise.
   */
  money: (options: MoneyOptions = {}) => {
    const { currency, code, minor, digits, ...rest } = options;
    return tag(
      z.number(),
      {
        type: 'money',
        ...(currency === undefined ? {} : { currency }),
        ...(code === undefined ? {} : { code: code.toUpperCase() }),
        ...(minor === undefined ? {} : { minor }),
        ...(digits === undefined ? {} : { digits }),
      },
      rest,
    );
  },
  /**
   * A moment: an ISO date-time, an ISO date with `unit: 'date'`, or seconds or milliseconds since
   * the epoch with `unit: 's'` or `'ms'`.
   */
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
  let dated = false;
  if (def.type === 'enum') {
    type = 'enum';
    values = Object.values(def.entries ?? {});
  } else if (def.type === 'literal') {
    type = 'enum';
    values = (def.values ?? []).map(String);
  } else if (def.type === 'string') {
    type = def.format === 'datetime' || def.format === 'date' ? 'time' : 'text';
    if (def.format === 'date') dated = true;
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
    tagged?.unit ??
    (type === 'time' ? (def.type === 'string' ? (dated ? 'date' : 'iso') : 'ms') : undefined);
  const digits = tagged?.digits === undefined ? undefined : checkDigits(tagged.digits, fail);
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
    ...(digits === undefined ? {} : { digits }),
    ...(unit === undefined ? {} : { unit }),
  };
}

function checkDigits(
  raw: unknown,
  fail: (message: string) => never,
): Readonly<Record<string, number>> {
  if (raw === null || typeof raw !== 'object') return fail('digits must map currencies to places');
  const out: Record<string, number> = {};
  for (const [code, places] of Object.entries(raw)) {
    if (!/^[A-Za-z]{3}$/.test(code)) fail(`digits: "${code}" is not an ISO 4217 code`);
    if (!Number.isInteger(places) || (places as number) < 0 || (places as number) > 4) {
      fail(`digits: ${code} takes 0 to 4 decimal places`);
    }
    out[code.toUpperCase()] = places as number;
  }
  return out;
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

// ISO 4217's minor units, which every runtime agrees on; Intl's display digits differ by
// locale data, and from the minor units APIs store amounts in.
const EXPONENTS: Readonly<Record<string, number>> = {
  ...Object.fromEntries(
    'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF'
      .split(' ')
      .map((code) => [code, 0]),
  ),
  ...Object.fromEntries('BHD IQD JOD KWD LYD OMR TND'.split(' ').map((code) => [code, 3])),
  CLF: 4,
  UYW: 4,
};

/**
 * Decimal places of a currency's minor unit in ISO 4217, such as 2 for USD, 0 for JPY and 3 for
 * KWD; 2 for codes it doesn't list.
 */
export function currencyDigits(code: string): number {
  const upper = code.trim().toUpperCase();
  return Object.hasOwn(EXPONENTS, upper) ? (EXPONENTS[upper] as number) : 2;
}

/** Decimal places of a money field's minor unit in one currency, with the field's overrides. */
export function minorDigits(field: Field, code: string | undefined): number {
  const upper = (code ?? 'USD').trim().toUpperCase() || 'USD';
  const own = field.digits;
  return own !== undefined && Object.hasOwn(own, upper)
    ? (own[upper] as number)
    : currencyDigits(upper);
}
