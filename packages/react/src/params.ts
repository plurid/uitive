import { currencyDigits, parseValue, type Field } from '@plurid/uitive-core';

/** The currency a money param is in: its fixed code, or the value of its currency param. */
export function currencyOf(
  field: Field,
  params: Readonly<Record<string, unknown>>,
): string | undefined {
  if (field.type !== 'money') return undefined;
  if (field.code !== undefined) return field.code;
  const value = field.currency === undefined ? undefined : params[field.currency];
  return typeof value === 'string' && value.trim() !== '' ? value.trim().toUpperCase() : undefined;
}

function parsed(field: Field, value: unknown, now: () => number): unknown {
  if (typeof value !== 'string') return value;
  if (value.trim() === '') return undefined;
  const result = parseValue(field, value, { now: field.type === 'time' ? now() : 0 });
  // Left as typed, so the action's schema says what is wrong with it.
  if (!result) return value;
  if (field.type !== 'time') return result.value;
  const ms = result.value as number;
  if (field.unit === 's') return Math.floor(ms / 1000);
  if (field.unit === 'ms') return ms;
  return new Date(ms).toISOString();
}

/**
 * An action's params from what a page or a person wrote, parsed as validation parses them: "yes"
 * is true, "$5" and "1,000" are numbers, and money typed in major units is stored in the field's
 * own. Text that says nothing is left out; values that aren't text, such as a row's, stay as they
 * are. `now` resolves relative times, such as `today`.
 */
export function paramsFrom(
  fields: readonly Field[],
  raw: Readonly<Record<string, unknown>>,
  now: () => number = Date.now,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  // Money last, so the currency it is in is already known.
  const ordered = [
    ...fields.filter((field) => field.type !== 'money'),
    ...fields.filter((field) => field.type === 'money'),
  ];
  for (const field of ordered) {
    const typed = typeof raw[field.name] === 'string';
    const value = parsed(field, raw[field.name], now);
    if (value === undefined) continue;
    const minor = field.type === 'money' && field.minor && typed && typeof value === 'number';
    params[field.name] = minor
      ? Math.round(value * 10 ** currencyDigits(currencyOf(field, params) ?? 'USD'))
      : value;
  }
  return params;
}

/** A field's label, with the currency money is typed in. */
export function fieldLabel(field: Field, params: Readonly<Record<string, unknown>>): string {
  const currency = currencyOf(field, params);
  return currency === undefined ? field.label : `${field.label} (${currency})`;
}

/**
 * Whether a form shows every param of a run as it will be sent: the typed ones in their inputs,
 * the rest known, parsed for their type and, for money, in a known currency. Only such a form's
 * submission counts as the person's yes to a write.
 */
export function showsEvery(
  fields: readonly Field[],
  typed: ReadonlySet<string>,
  raw: Readonly<Record<string, unknown>>,
  params: Readonly<Record<string, unknown>>,
): boolean {
  return fields.every((field) => {
    if (typed.has(field.name)) return true;
    if (params[field.name] === undefined) return false;
    const value = raw[field.name];
    if (typeof value === 'string' && !parseValue(field, value, { now: 0 })) return false;
    const priced = field.type === 'money' && (field.code ?? field.currency) !== undefined;
    return !priced || currencyOf(field, params) !== undefined;
  });
}
