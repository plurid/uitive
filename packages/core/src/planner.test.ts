import { describe, expect, it } from 'vitest';
import { payments } from './__fixtures__/payments.js';
import { createUitive } from './client.js';
import { heuristicPlanner } from './heuristic.js';
import { ui } from './page.js';
import { remotePlanner, type FetchLike, type PlanProgress, type PlanResult } from './planner.js';
import { validateOutput } from './policy.js';
import { query } from './query.js';

const result: PlanResult = {
  origin: 'model',
  operations: [],
  status: 'done',
  meta: { planner: 'claude', ms: 12, subset: ['payments'], repaired: true, stages: 2 },
};

/** A response whose body arrives in the given chunks, as NDJSON. */
function streamed(chunks: string[]): Awaited<ReturnType<FetchLike>> {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('not JSON');
    },
    headers: { get: (name) => (name === 'content-type' ? 'application/x-ndjson' : null) },
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true },
      }),
    },
  };
}

const request = () => createUitive({ contract: payments, now: () => 0 }).request('command', 'hi');

describe('remotePlanner', () => {
  it('reads progress and the result from a stream, across chunk boundaries', async () => {
    const seen: PlanProgress[] = [];
    let accept: string | undefined;
    const planner = remotePlanner({
      url: '/api/uitive/',
      fetch: async (_url, init) => {
        accept = init.headers.accept;
        const lines = [
          { type: 'progress', progress: { stage: 'planning', elements: 0 } },
          { type: 'progress', progress: { stage: 'planning', elements: 3 } },
          { type: 'result', result },
        ].map((line) => `${JSON.stringify(line)}\n`);
        const text = lines.join('');
        return streamed([text.slice(0, 17), text.slice(17, 60), text.slice(60)]);
      },
    });
    const answer = await planner.plan(request(), payments, {
      onProgress: (progress) => seen.push(progress),
    });
    expect(accept).toBe('application/x-ndjson');
    expect(seen).toEqual([
      { stage: 'planning', elements: 0 },
      { stage: 'planning', elements: 3 },
    ]);
    expect(answer.meta).toMatchObject({ subset: ['payments'], repaired: true, stages: 2 });
  });

  it('falls back when the stream reports an error or ends without a plan', async () => {
    const failing = (lines: string[]) =>
      remotePlanner({
        url: '/api',
        fallback: heuristicPlanner(),
        fetch: async () => streamed(lines),
      });
    const error = await failing([
      `${JSON.stringify({ type: 'error', status: 502, error: 'The plan was cut short' })}\n`,
    ]).plan(request(), payments, { onProgress: () => {} });
    expect(error.meta.fellBack).toBe('The plan was cut short');
    const cut = await failing([
      `${JSON.stringify({ type: 'progress', progress: { stage: 'planning', elements: 1 } })}\n`,
    ]).plan(request(), payments, { onProgress: () => {} });
    expect(cut.meta.fellBack).toBe('the server ended without a plan');
  });
});

describe('validateOutput', () => {
  const refundTable = ui.page(
    ui.section('', 'stack', [
      ui.block('table', {
        data: 'paid',
        columns: ['payments.id'],
        lookups: [],
        rowActions: [{ action: 'refund', set: [] }],
        density: 'compact',
        link: 'none',
      }),
    ]),
    [{ name: 'paid', query: query('payments', { fields: ['payments.id'] }) }],
  );

  it('checks names, page rules and what planners may do, without user state', () => {
    const { accepted, rejected } = validateOutput(payments, [
      {
        change: { kind: 'list', surface: 'NAV', op: 'move', target: 'GO.PAYOUTS', index: 1 },
        evidence: [{ intent: true }],
      },
      {
        change: { kind: 'page', surface: 'home', op: 'set', value: refundTable },
        evidence: [{ intent: true }],
      },
      {
        change: { kind: 'page', surface: 'home', op: 'set', value: refundTable },
        evidence: [{ intent: true }],
        scope: 'explicit',
      },
      {
        change: {
          kind: 'userPage',
          surface: 'userPages',
          op: 'create',
          slug: 'Mine',
          title: 'Mine',
          value: refundTable,
        },
        evidence: [{ intent: true }],
      },
      {
        change: {
          kind: 'userPage',
          surface: 'userPages',
          op: 'create',
          slug: 'Mine',
          title: 'Mine',
          value: refundTable,
        },
        evidence: [{ intent: true }],
        scope: 'explicit',
      },
      {
        change: { kind: 'choice', surface: 'theme', op: 'set', value: 'dark' },
        evidence: [{ intent: true }],
      },
    ]);
    expect(accepted.map((entry) => entry.change)).toMatchObject([
      { kind: 'list', surface: 'nav', target: 'go.payouts' },
      { kind: 'page', surface: 'home' },
      { kind: 'userPage', slug: 'mine' },
    ]);
    expect(rejected.map((entry) => [entry.rule, entry.message])).toEqual([
      ['kind', 'Only you can put Refund payment on a page'],
      ['kind', 'Only the person can create their pages'],
      ['unknown', 'No surface "theme"'],
    ]);
  });
});
