import { z } from 'zod';
import { action, defineApp, page, type ActionSpec } from '../contract.js';
import { field } from '../field.js';
import { ui } from '../page.js';
import { source, type AnySourceSpec } from '../source.js';

const nouns = [
  'payment',
  'invoice',
  'customer',
  'subscription',
  'product',
  'price',
  'coupon',
  'dispute',
  'refund',
  'payout',
  'transfer',
  'balance',
  'charge',
  'session',
  'account',
  'person',
  'tax rate',
  'credit note',
  'quote',
  'order',
  'shipment',
  'review',
  'event',
  'webhook',
  'file',
  'report',
  'reader',
  'location',
  'card',
  'cardholder',
  'authorization',
  'transaction',
  'topup',
  'fee',
  'plan',
  'meter',
  'entitlement',
  'feature',
  'promotion code',
  'discount',
];
const prefixes = ['', 'issuing', 'treasury', 'terminal'];

const names = prefixes
  .flatMap((prefix) => nouns.map((noun) => (prefix ? `${prefix} ${noun}` : noun)))
  .slice(0, 150);
const idOf = (name: string) => name.replace(/ /g, '-');
const plural = (name: string) => (name.endsWith('y') ? `${name.slice(0, -1)}ies` : `${name}s`);

const sources: Record<string, AnySourceSpec> = {};
const actions: Record<string, ActionSpec> = {};
names.forEach((name, index) => {
  const id = idOf(name);
  const label = plural(name).replace(/^./, (first) => first.toUpperCase());
  sources[id] = source({
    label,
    description: `${label} in the account`,
    row: z.object({
      id: z.string(),
      name: z.string(),
      status: field.enum(['active', 'pending', 'closed']),
      created: field.time({ unit: 's' }),
      ...(index % 2 === 0
        ? { amount: field.money({ currency: 'currency', minor: true }), currency: z.string() }
        : {}),
      ...(id === 'customer' ? {} : { customer: field.ref('customer').nullable() }),
    }),
    key: 'id',
    title: 'name',
  });
  actions[`${id}.create`] = action({
    label: `Create ${name}`,
    description: `Adds a new ${name}`,
    params: z.object({ name: z.string() }),
    effect: 'write',
    invalidates: [id],
  });
  actions[`${id}.update`] = action({
    label: `Rename ${name}`,
    description: `Changes the name of a ${name}`,
    params: z.object({ item: field.ref(id), name: z.string() }),
    effect: 'write',
  });
  actions[`${id}.cancel`] = action({
    label: `Cancel ${name}`,
    description: `Closes a ${name} for good`,
    params: z.object({ item: field.ref(id) }),
    effect: 'destructive',
  });
  actions[`${id}.export`] = action({
    label: `Export ${plural(name)}`,
    description: 'A spreadsheet',
    effect: 'read',
  });
});

/** A contract at the scale of a large payments product: 150 sources, 600 actions. */
export const scale = defineApp({
  id: 'scale',
  description: 'A large payments product',
  actions,
  sources,
  surfaces: {
    home: page({})({
      label: 'Home',
      description: 'The first page',
      standard: () => ui.page(ui.section('', 'stack', [])),
    }),
  },
});
