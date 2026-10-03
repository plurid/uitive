import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { editor } from './__fixtures__/editor.js';
import { payments } from './__fixtures__/payments.js';
import { action, block, collection, defineApp, page, type AnyPageSpec } from './contract.js';
import { emptyDefinition } from './definition.js';
import { fromJson, toJson } from './json.js';
import { ui, validatePage } from './page.js';
import { check } from './policy.js';
import { summarise } from './usage.js';

const roundTrip = (contract: Parameters<typeof toJson>[0]) => {
  const json = toJson(contract);
  const back = fromJson(JSON.parse(JSON.stringify(json)));
  return { json, back };
};

const table = block({
  label: 'Table',
  description: 'Rows',
  props: z.object({ limit: z.number().int() }),
  validate: (props) => (props.limit > 50 ? 'at most 50 rows' : undefined),
});
const ops = defineApp({
  id: 'ops',
  description: 'Operations',
  actions: { start: action({ label: 'Start', description: 'Start' }) },
  contexts: { service: ['vm', 'db', 'cache'] },
  surfaces: {
    service: page({ table })({
      label: 'Service',
      description: 'One service',
      context: 'service',
      standard: (value) =>
        ui.page(
          ui.section(value === 'db' ? 'Database' : '', 'stack', [ui.block('table', { limit: 10 })]),
        ),
    }),
  },
});

describe('JSON contracts', () => {
  it('round-trip with the same hash, and re-serialise byte for byte', () => {
    for (const contract of [payments, editor, ops]) {
      const { json, back } = roundTrip(contract);
      expect(back.hash).toBe(contract.hash);
      expect(json.hash).toBe(contract.hash);
      expect(JSON.stringify(toJson(back))).toBe(JSON.stringify(json));
    }
  });

  it('write meanings out, so sources and params come back the same', () => {
    const { json, back } = roundTrip(payments);
    expect(json.format).toBe('aptuitive.contract');
    expect(json.sources.payments?.row.properties.amount).toEqual({
      type: 'number',
      'x-aptuitive': { type: 'money', label: 'Amount', currency: 'currency', minor: true },
    });
    expect(json.sources.payments?.row.required).not.toContain('customer');
    expect(back.source('payments')).toEqual(payments.source('payments'));
    expect(back.params('refund')).toEqual(payments.params('refund'));
    expect(back.path('payments.customer.email')?.name).toBe('payments.customer.email');
    expect(back.routes.payment).toEqual({
      path: '/payments/:id',
      entity: 'payments',
      page: 'payment',
    });
  });

  it('keep standard pages per context value only where they differ', () => {
    const { json, back } = roundTrip(ops);
    const surface = json.surfaces.service;
    expect(surface?.kind === 'page' && Object.keys(surface.standard.values ?? {})).toEqual(['db']);
    const spec = back.surfaces.service as AnyPageSpec;
    expect(validatePage(back, spec, spec.standard('db'), 'db')).toEqual(
      validatePage(ops, ops.surfaces.service, ops.surfaces.service.standard('db'), 'db'),
    );
  });

  it('carry lists per context value and collections titled by a field', () => {
    const { back } = roundTrip(editor);
    expect(back.items('toolbar', 'image')).toEqual(editor.items('toolbar', 'image'));
    const macros = back.surfaces.macros;
    expect(macros?.kind === 'collection' && macros.title({ label: 'Tidy', steps: [] })).toBe(
      'Tidy',
    );
  });

  it('take validators back at load, since JSON cannot carry them', () => {
    const json = JSON.parse(JSON.stringify(toJson(ops)));
    const bare = fromJson(json);
    const guarded = fromJson(json, {
      validators: {
        'service.table': (props: { limit: number }) =>
          props.limit > 50 ? 'at most 50 rows' : undefined,
      },
    });
    const big = ui.page(ui.section('', 'stack', [ui.block('table', { limit: 80 })]));
    const attempt = (contract: typeof bare) =>
      check(
        [
          {
            id: 'x',
            change: { kind: 'page', surface: 'service', context: 'vm', op: 'set', value: big },
            origin: 'user',
            layer: 'user',
            evidence: [],
            basedOn: { version: 0, summary: '', session: 0 },
          },
        ],
        {
          contract,
          definition: emptyDefinition(contract),
          summary: summarise(contract, emptyDefinition(contract), [], [], 0),
          session: 0,
        },
      );
    expect(attempt(bare).accepted).toHaveLength(1);
    expect(attempt(guarded).rejected[0]?.message).toBe('Table: at most 50 rows');
  });

  it('refuse what JSON cannot hold, and malformed documents', () => {
    const odd = defineApp({
      id: 'odd',
      description: 'Odd',
      actions: { open: action({ label: 'Open', description: 'Open' }) },
      surfaces: {
        notes: collection({
          label: 'Notes',
          description: 'Notes',
          item: z.object({ body: z.string() }),
          max: 3,
          title: (item) => item.body,
        }),
      },
    });
    expect(() => toJson(odd)).toThrow(/items need a label, title or name/);
    const transformed = defineApp({
      id: 'transformed',
      description: 'Transformed',
      actions: { open: action({ label: 'Open', description: 'Open' }) },
      surfaces: {
        home: page({
          shout: block({
            label: 'Shout',
            description: 'Loud',
            props: z.object({ text: z.string().transform((value) => value.toUpperCase()) }),
          }),
        })({
          label: 'Home',
          description: 'Home',
          standard: () => ui.page(ui.section('', 'stack', [])),
        }),
      },
    });
    expect(() => toJson(transformed)).toThrow(/block shout/);
    expect(() => fromJson({ format: 'something-else' })).toThrow(
      /Not an Aptuitive contract: format/,
    );
    const json = JSON.parse(JSON.stringify(toJson(payments)));
    json.routes.payment.page = 'refunds';
    expect(() => fromJson(json)).toThrow(/route payment: "refunds" is not a page/);
  });
});
