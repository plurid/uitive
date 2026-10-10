import { z } from 'zod';
import { action, defineApp } from '../contract.js';
import { field } from '../field.js';
import { source } from '../source.js';

/** 2026-10-03 12:00 UTC: the fixture's "now". */
export const NOW = Date.UTC(2026, 9, 3, 12);

/** A shop whose orders reach customers and accounts, each with amounts in their own currency. */
export const shop = defineApp({
  id: 'shop',
  description: 'A shop',
  actions: { open: action({ label: 'Open', description: 'Open' }) },
  sources: {
    orders: source({
      label: 'Orders',
      description: 'Orders',
      row: z.object({
        id: z.string(),
        total: field.money({ currency: 'currency', minor: true }),
        currency: z.string(),
        customer: field.ref('customers'),
        account: field.ref('accounts').nullable(),
        placed: field.time().nullable(),
        day: z.iso.date().nullable(),
      }),
      key: 'id',
      capabilities: { filter: { day: ['gte', 'lt', 'gt', 'lte'] } },
    }),
    customers: source({
      label: 'Customers',
      description: 'Customers',
      row: z.object({
        id: z.string(),
        name: z.string(),
        balance: field.money({ currency: 'currency', minor: true }),
        currency: z.string(),
      }),
      key: 'id',
      title: 'name',
      summary: ['name', 'balance', 'currency'],
    }),
    accounts: source({
      label: 'Accounts',
      description: 'Accounts',
      row: z.object({
        id: z.string(),
        name: z.string(),
        limit: field.money({ currency: 'currency', minor: true }),
        currency: z.string(),
      }),
      key: 'id',
      title: 'name',
      summary: ['name', 'limit'],
    }),
  },
  surfaces: {},
});

/** One order row, with what a test doesn't care about filled in. */
export const order = (
  id: string,
  extra: Partial<{
    total: number;
    currency: string;
    customer: string;
    account: string | null;
    placed: string | null;
    day: string | null;
  }> = {},
) => ({
  id,
  total: 100,
  currency: 'usd',
  customer: 'c1',
  account: null,
  placed: null,
  day: null,
  ...extra,
});
