import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineApp, fromJson, toJson } from '@plurid/aptuitive-core';
import type { ActionSpec, AnySourceSpec } from '@plurid/aptuitive-core';
import { describe, expect, it } from 'vitest';
import { curate, parseCuration, picksOf } from './curation.js';
import type { Curation, CurationInput } from './curation.js';
import { emit } from './emit.js';
import { inventory, plain, readSpec } from './openapi.js';
import type { ApiInventory, ApiSource } from './openapi.js';

const fixtures = new URL('../../../tools/fixtures/openapi/', import.meta.url);
const load = async (name: string) => readSpec(await readFile(new URL(name, fixtures), 'utf8'));
const payments = inventory(await load('payments.json'));
const shop = inventory(await load('shop.yaml'));

const source = (api: ApiInventory, id: string): ApiSource => {
  const found = api.sources.find((entry) => entry.id === id);
  if (!found) throw new Error(`no source ${id}`);
  return found;
};
const fieldOf = (entry: ApiSource, name: string) =>
  [...entry.fields, ...entry.extra].find((field) => field.name === name);
const action = (api: ApiInventory, id: string) => api.actions.find((entry) => entry.id === id);
const curation = (input: CurationInput): Curation => {
  const parsed = parseCuration(input);
  if ('problems' in parsed) throw new Error(parsed.problems.join('\n'));
  return parsed.curation;
};

describe('inventory, Stripe-style', () => {
  it('turns list endpoints into sources and keeps nested lists out', () => {
    expect(payments.server).toBe('https://api.payments.test');
    expect(payments.sources.map((entry) => entry.id)).toEqual(['charges', 'customers', 'refunds']);
    expect(payments.skipped).toEqual(
      expect.arrayContaining([
        { operation: 'GetChargesSearch', reason: 'needs query' },
        { operation: 'GetChargesChargeRefunds', reason: 'a list inside another resource' },
        { operation: 'PostFiles', reason: 'takes files or another body format' },
      ]),
    );
  });

  it('understands money in minor units, unix times, enums and expandable references', () => {
    const charges = source(payments, 'charges');
    expect(fieldOf(charges, 'amount')).toMatchObject({
      type: 'money',
      currency: 'currency',
      minor: true,
    });
    expect(fieldOf(charges, 'created')).toMatchObject({ type: 'time', unit: 's' });
    expect(fieldOf(charges, 'customer')).toMatchObject({
      type: 'ref',
      source: 'customers',
      nullable: true,
    });
    expect(fieldOf(charges, 'application')).toMatchObject({ type: 'text' });
    expect(fieldOf(charges, 'status')).toMatchObject({
      type: 'enum',
      values: ['failed', 'pending', 'succeeded'],
    });
    expect(charges.skipped).toEqual(
      expect.arrayContaining([
        { name: 'object', reason: 'a constant' },
        { name: 'billing_details', reason: 'nested billing_details' },
        { name: 'metadata', reason: 'nested' },
      ]),
    );
    expect(charges.title).toBe('description');
    expect(charges.summary).toEqual(['description', 'amount', 'status', 'created']);
    expect(fieldOf(source(payments, 'refunds'), 'charge')).toMatchObject({
      type: 'ref',
      source: 'charges',
    });
  });

  it('maps parameters to capabilities and the binding', () => {
    const charges = source(payments, 'charges');
    expect(charges.capabilities).toEqual({
      filter: {
        created: ['gt', 'gte', 'lt', 'lte', 'between'],
        customer: ['eq'],
        id: ['eq', 'in'],
      },
      sort: [],
      search: false,
      pagination: 'cursor',
    });
    expect(charges.rest).toEqual({
      path: '/v1/charges',
      rows: '/data',
      filters: {
        'created:gt': 'created[gt]',
        'created:gte': 'created[gte]',
        'created:lt': 'created[lt]',
        'created:lte': 'created[lte]',
        'customer:eq': 'customer',
      },
      limit: 'limit',
      pagination: { kind: 'cursor', param: 'starting_after' },
      more: '/has_more',
      item: { path: '/v1/charges/{charge}' },
    });
  });

  it('makes writes actions, and anything hard to undo destructive', () => {
    // Creating a charge moves money.
    expect(action(payments, 'charges.create')).toMatchObject({
      label: 'Create a charge',
      effect: 'destructive',
      reason: 'charge: hard to undo',
      rest: { method: 'POST', path: '/v1/charges', body: 'form' },
    });
    expect(action(payments, 'charges.create')?.params.map((param) => param.name)).toEqual([
      'amount',
      'currency',
      'customer',
      'description',
    ]);
    expect(action(payments, 'charges.create')?.skipped).toEqual([
      { name: 'metadata', reason: 'a union' },
    ]);
    expect(action(payments, 'charges.update')?.params[0]).toMatchObject({
      name: 'charge',
      type: 'ref',
      source: 'charges',
      required: true,
    });
    expect(action(payments, 'charges.capture')).toMatchObject({
      label: 'Capture charge',
      effect: 'destructive',
      reason: 'capture: hard to undo',
      invalidates: ['charges'],
    });
    expect(action(payments, 'customers.delete')).toMatchObject({
      effect: 'destructive',
      reason: 'deletes',
    });
    expect(action(payments, 'customers.create')).toMatchObject({ effect: 'write' });
    expect(action(payments, 'charges.update')).toMatchObject({ effect: 'write' });
    expect(action(payments, 'refunds.create')).toMatchObject({ effect: 'destructive' });
  });
});

describe('inventory, Medusa-style', () => {
  it('reads allOf envelopes, offset paging, operator objects and string-or-list filters', () => {
    const orders = source(shop, 'orders');
    expect(orders.rest).toMatchObject({
      path: '/admin/orders',
      rows: '/orders',
      limit: 'limit',
      pagination: { kind: 'offset', param: 'offset' },
      search: 'q',
      sort: { param: 'order', format: '-field' },
      item: { path: '/admin/orders/{id}', row: '/order' },
    });
    expect(orders.rest.filters).toMatchObject({
      'status:eq': 'status',
      'status:in': 'status',
      'created_at:gte': 'created_at[$gte]',
      'customer_id:in': 'customer_id',
    });
    expect(orders.rest.repeat).toEqual(['id', 'status', 'customer_id']);
    expect(orders.capabilities.sort).toEqual(['created_at']);
    expect(orders.notes).toEqual(['sorting by created_at is assumed']);
    expect(fieldOf(orders, 'total')).toMatchObject({
      type: 'money',
      currency: 'currency_code',
      minor: false,
    });
    expect(fieldOf(orders, 'customer_id')).toMatchObject({ type: 'ref', source: 'customers' });
    expect(orders.title).toBe('display_id');
    // The schema says little, so the tag's description stands in.
    expect(orders.description).toMatch(/^An order is a purchase/);
  });

  it('copes with mistakes published specs make', () => {
    // A list declared as one object.
    expect(source(shop, 'customers').rest.rows).toBe('/customers');
    // Untyped rows, typed by the endpoint for one product.
    const products = source(shop, 'products');
    expect(products.fields.map((field) => field.name)).toEqual([
      'id',
      'title',
      'status',
      'collection_id',
      'type_id',
      'created_at',
    ]);
    expect(fieldOf(products, 'type_id')).toMatchObject({ type: 'ref', source: 'product-types' });
    expect(products.capabilities.filter.status).toEqual(['in']);
  });

  it('names sub-collection creates and skips what an action can not take', () => {
    expect(action(shop, 'orders.cancel')).toMatchObject({
      label: 'Cancel order',
      effect: 'destructive',
    });
    const fulfil = action(shop, 'orders.fulfillments.create');
    expect(fulfil).toMatchObject({ effect: 'destructive' });
    expect(fulfil?.skipped).toEqual([{ name: 'items', reason: 'a list (required)' }]);
    expect(action(shop, 'products.create')?.params.map((param) => param.name)).toEqual([
      'title',
      'status',
      'collection_id',
      'type_id',
    ]);
    expect(shop.skipped).toContainEqual({
      operation: 'PostUploads',
      reason: 'takes files or another body format',
    });
  });
});

describe('plain', () => {
  it('keeps whole sentences and amounts', () => {
    expect(plain('First sentence costs $1.00 today. Second one. Third.', 40)).toBe(
      'First sentence costs $1.00 today.',
    );
    expect(plain('<p>See <a href="/x">the guide</a> and [docs](https://x.test).</p>')).toBe(
      'See the guide and docs.',
    );
  });
});

describe('curate', () => {
  it('keeps chosen sources with their actions, picks and currencies', async () => {
    const choice = curation({
      default: 'exclude',
      sources: {
        charges: {
          include: true,
          label: 'Payments',
          fields: ['amount', 'status', 'customer'],
          pick: { card_brand: '/payment_method_details/card/brand' },
          query: { 'expand[]': 'data.payment_method_details' },
        },
        refunds: { include: true },
      },
      actions: {
        'charges.capture': { include: false },
        'refunds.create': { effect: 'write', reason: 'Refunds wait for a second approval.' },
      },
    });
    const picked = inventory(await load('payments.json'), { picks: picksOf(choice) });
    const { inventory: kept, problems } = curate(picked, choice);
    expect(problems).toEqual([]);
    expect(kept.sources.map((entry) => entry.id)).toEqual(['charges', 'refunds']);
    const charges = source(kept, 'charges');
    expect(charges.label).toBe('Payments');
    // The key and the money field's currency come along.
    expect(charges.fields.map((field) => field.name)).toEqual([
      'id',
      'amount',
      'currency',
      'customer',
      'status',
      'card_brand',
    ]);
    expect(fieldOf(charges, 'card_brand')).toMatchObject({
      type: 'text',
      pointer: '/payment_method_details/card/brand',
    });
    expect(charges.rest.pick).toEqual({ card_brand: '/payment_method_details/card/brand' });
    expect(charges.rest.query).toEqual({ 'expand[]': 'data.payment_method_details' });
    expect(charges.capabilities.filter).toEqual({ customer: ['eq'], id: ['eq', 'in'] });
    expect(kept.actions.map((entry) => entry.id)).toEqual([
      'charges.create',
      'charges.update',
      'refunds.create',
    ]);
    expect(action(kept, 'refunds.create')).toMatchObject({
      effect: 'write',
      reason: 'Refunds wait for a second approval.',
    });
  });

  it('names every reference that does not resolve, and lowered effects without a reason', () => {
    const { problems } = curate(
      payments,
      curation({
        sources: {
          charge: { include: true },
          charges: { fields: ['amount', 'billing_details'], labels: { amount_due: 'Due' } },
        },
        actions: { 'refunds.create': { effect: 'write' }, 'refunds.void': {} },
      }),
    );
    expect(problems).toEqual([
      'sources.charge: no such source',
      'actions.refunds.void: no such action',
      'sources.charges.fields: no field "billing_details" (left out: nested billing_details)',
      'sources.charges.labels: no field "amount_due"',
      'actions.refunds.create.effect: lowering destructive to write needs a reason',
    ]);
    expect(parseCuration({ sources: { charges: { colour: 'red' } } })).toEqual({
      problems: [expect.stringMatching(/^curation\.sources\.charges: Unrecognized key/)],
    });
  });
});

describe('emit', () => {
  const zod = fileURLToPath(import.meta.resolve('zod'));
  const core = fileURLToPath(new URL('../../core/src/index.ts', import.meta.url));

  async function compile(api: ApiInventory) {
    const directory = await mkdtemp(join(tmpdir(), 'aptuitive-'));
    const file = join(directory, 'api.generated.ts');
    await writeFile(file, emit(api, { from: 'fixture', core, zod }));
    return (await import(pathToFileURL(file).href)) as {
      sources: Record<string, AnySourceSpec>;
      actions: Record<string, ActionSpec>;
      endpoints: { sources: Record<string, unknown>; actions: Record<string, unknown> };
    };
  }

  it.each([
    ['payments', payments],
    ['shop', shop],
  ])('writes a module that defines a valid contract (%s)', async (_, api) => {
    const module = await compile(api);
    const app = defineApp({
      id: 'generated',
      version: '1',
      description: 'A generated contract',
      sources: module.sources,
      actions: module.actions,
      surfaces: {},
    });
    expect(app.sourceIds).toEqual(api.sources.map((entry) => entry.id));
    expect(app.actionIds).toEqual(api.actions.map((entry) => entry.id));
    expect(fromJson(toJson(app), {}).hash).toBe(app.hash);
    expect(Object.keys(module.endpoints.actions)).toEqual(app.actionIds);
  });

  it('turns references to sources left out into plain ids', async () => {
    const { inventory: kept } = curate(
      payments,
      curation({ default: 'exclude', sources: { refunds: { include: true } } }),
    );
    const code = emit(kept, { from: 'fixture' });
    expect(code).toContain('charge: z.string().nullable(),');
    expect(code).not.toContain("field.ref('charges')");
  });

  it('names fields the way people do, where the curation says', () => {
    const { inventory: kept } = curate(
      payments,
      curation({
        default: 'exclude',
        sources: {
          refunds: {
            include: true,
            labels: { amount: 'Refunded', status: 'State', charge: 'Payment' },
          },
        },
      }),
    );
    const code = emit(kept, { from: 'fixture' });
    expect(code).toMatch(/amount: field\.money\(\{[^}]*label: 'Refunded' \}\)/);
    expect(code).toContain("label: 'State' })");
    expect(code).toContain("charge: field.text({ label: 'Payment' }).nullable(),");
  });
});
