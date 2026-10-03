import { describe, expect, it } from 'vitest';
import { createUitive } from '@plurid/uitive-core';
import { payments } from '../../core/src/__fixtures__/payments.js';
import { ops } from './__fixtures__/ops.js';
import { contractText, requestText, RULES } from './prompt.js';

describe('contractText', () => {
  it('describes the contract deterministically, blocks and props included', () => {
    const text = contractText(ops);
    expect(contractText(ops)).toBe(text);
    expect(text).toContain('## detail (page, keyed by machine or * for every machine)');
    expect(text).toContain(
      'table: Table. Resources as rows. Props { machine: "current" | action ID; columns: ("name" | "state")[]; limit: integer }',
    );
    expect(text).toContain('machine-3: start, stop');
    expect(text).not.toMatch(/\d{13}/);
  });
});

describe('contractText with sources', () => {
  it('lists sources, runnable actions, routes and generic blocks', () => {
    const text = contractText(payments);
    expect(text).toContain(
      'payments: Payments. Every charge, with its amount, status and customer. Key id. Fields: id text, amount money, currency text, status enum (succeeded|pending|failed), created time, customer ref to customers, description text, refunded bool',
    );
    expect(text).toContain(
      'refund: Refund payment. Returns the whole amount to the customer (destructive; takes payment ref to payments, reason enum (duplicate|fraudulent|requested_by_customer))',
    );
    expect(text).toContain('payment: /payments/:id (one payments row, page payment)');
    expect(text).toContain('# Generic blocks');
    expect(text).toMatch(/^table: rows of a query as a table/m);
    expect(text).toContain('original: Original page. The page as the dashboard ships it');
    expect(text).toContain('## customer (page): Customer. One customer About one customers row.');
  });

  it('tells the planner how to write queries and what it may never do unasked', () => {
    expect(RULES).toContain('relative times now, today, -7d, -3mo, start:month');
    expect(RULES).toContain('Never add up amounts in different currencies');
    expect(RULES).toContain('never place destructive actions');
  });
});

describe('requestText', () => {
  it('carries the words, the pages in view and the usage, nothing else', () => {
    const client = createUitive({ contract: ops, now: () => 0 });
    client.setContext('machine', 'machine-3');
    client.record('start');
    const text = requestText(client.request('command', 'make this page compact'));
    expect(text).toContain('Request: "make this page compact"');
    expect(text).toContain('Context now: machine = machine-3');
    expect(text).toContain('detail (machine-3): {"root":"page","elements"');
    expect(text).toContain('toolbar | machine-3 | start | visible | 1 | 1 | 0 | 0');
  });
});
