import { describe, expect, it } from 'vitest';
import { payments } from './__fixtures__/payments.js';
import { scale } from './__fixtures__/scale.js';
import { createUitive } from './client.js';
import { ui } from './page.js';
import { query } from './query.js';
import { areasOf, rankAreas, selectSubset, sourcesInView, terms } from './retrieval.js';

describe('retrieval', () => {
  it('splits, lowercases and stems words, dropping filler', () => {
    expect(terms('Show my failed invoice payments by created_at')).toEqual([
      'fail',
      'invoic',
      'payment',
      'creat',
    ]);
    expect(terms('taxRates batches')).toEqual(['tax', 'rate', 'batch']);
    expect(terms('disputed')).toEqual(terms('disputes'));
    expect(terms('issuing')).toEqual(terms('issue'));
  });

  it('builds one area per source, with the actions that act on it', () => {
    const areas = areasOf(scale);
    expect(areas).toHaveLength(150);
    expect(areas.find((area) => area.source === 'dispute')?.actions).toEqual([
      'dispute.create',
      'dispute.update',
      'dispute.cancel',
    ]);
  });

  it('ranks areas by relevance', () => {
    const ranked = rankAreas(areasOf(scale), 'refund the disputed charge');
    expect(
      ranked
        .slice(0, 3)
        .map((entry) => entry.source)
        .sort(),
    ).toEqual(['charge', 'dispute', 'refund']);
    expect(rankAreas(areasOf(scale), 'make it nicer')).toEqual([]);
  });

  it('keeps what is on screen and adds the most relevant two, within the cap', () => {
    const subset = selectSubset(scale, {
      inView: ['customer'],
      text: 'issuing cards that were closed',
    });
    expect(subset.sources[0]).toBe('customer');
    expect(subset.sources).toContain('issuing-card');
    expect(subset.sources).toHaveLength(3);
    expect(subset.actions).toContain('issuing-card.cancel');
    const crowded = selectSubset(scale, {
      inView: areasOf(scale)
        .slice(0, 12)
        .map((area) => area.source),
    });
    expect(crowded.sources).toHaveLength(8);
    expect(selectSubset(scale, { text: 'make it nicer' }).sources).toEqual([]);
  });

  it('keeps small contracts whole', () => {
    expect(selectSubset(payments, { text: 'anything' })).toEqual({
      sources: ['payments', 'customers', 'disputes', 'payouts'],
      actions: ['refund', 'note.add'],
      routes: ['payment', 'customer'],
    });
  });

  it('finds the sources on screen from pages and routes', () => {
    const client = createUitive({ contract: payments, now: () => 0 });
    client.setPage(
      'home',
      ui.page(
        ui.section('', 'stack', [
          ui.block('metric', { data: 'payouts', label: 'Paid out', compare: 'none' }),
        ]),
        [
          {
            name: 'payouts',
            query: query('payouts', { aggregate: { measure: 'sum', of: 'payouts.amount' } }),
          },
        ],
      ),
    );
    client.setLocation('/customers/cus_ada');
    expect(sourcesInView(payments, client.request('command', 'hi')).sort()).toEqual([
      'customers',
      'payouts',
    ]);
  });
});
