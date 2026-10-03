import { describe, expect, it } from 'vitest';
import { createUitive, heuristicPlanner, type Planner } from '@plurid/uitive-core';
import { ops } from '../../planner/src/__fixtures__/ops.js';
import { PlannerError } from '@plurid/uitive-planner';
import { createUitiveHandler } from './handler.js';

const body = (kind: 'plan' | 'command' = 'command', text = 'compact') =>
  JSON.stringify(
    createUitive({ contract: ops, now: () => 0 }).request(
      kind,
      kind === 'command' ? text : undefined,
    ),
  );

const post = (path: string, payload: string, host = 'localhost') =>
  new Request(`http://${host}:5171/api/uitive/${path}`, { method: 'POST', body: payload });

describe('createUitiveHandler', () => {
  const handler = createUitiveHandler({ contract: ops, planner: heuristicPlanner() });

  it('plans for local requests', async () => {
    const response = await handler(post('command', body()));
    expect(response.status).toBe(200);
    expect((await response.json()).operations[0].change).toMatchObject({
      kind: 'choice',
      value: 'compact',
    });
  });

  it('refuses what it should', async () => {
    const statuses = await Promise.all([
      handler(new Request('http://localhost/api/uitive/plan')),
      handler(post('plan', body('plan'), 'example.com')),
      handler(post('command', 'x'.repeat(140_000))),
      handler(post('command', 'not json')),
      handler(post('plan', body('command'))),
      handler(post('command', body().replace(ops.hash, 'stale'))),
      handler(post('command', body('command', 'x'.repeat(501)))),
    ]).then((responses) => responses.map((response) => response.status));
    expect(statuses).toEqual([404, 401, 413, 400, 400, 409, 400]);
  });

  it('limits requests per minute', async () => {
    const strict = createUitiveHandler({
      contract: ops,
      planner: heuristicPlanner(),
      perMinute: 2,
    });
    const statuses = [];
    for (let index = 0; index < 3; index++)
      statuses.push((await strict(post('command', body()))).status);
    expect(statuses).toEqual([200, 200, 429]);
  });

  it('passes planner failures on with their status', async () => {
    const failing: Planner = {
      name: 'failing',
      plan: async () => {
        throw new PlannerError('No Anthropic credentials', 503);
      },
    };
    const response = await createUitiveHandler({ contract: ops, planner: failing })(
      post('command', body()),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'No Anthropic credentials' });
  });

  it('streams progress and the result as NDJSON when asked', async () => {
    const streaming: Planner = {
      name: 'streaming',
      async plan(request, contract, options) {
        options?.onProgress?.({ stage: 'planning', elements: 0 });
        options?.onProgress?.({ stage: 'planning', elements: 4 });
        return heuristicPlanner().plan(request, contract);
      },
    };
    const lines = async (planner: Planner) => {
      const response = await createUitiveHandler({ contract: ops, planner })(
        new Request('http://localhost:5171/api/uitive/command', {
          method: 'POST',
          body: body(),
          headers: { accept: 'application/x-ndjson' },
        }),
      );
      expect(response.headers.get('content-type')).toBe('application/x-ndjson');
      return (await response.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; status?: number; error?: string });
    };
    const ok = await lines(streaming);
    expect(ok.map((line) => line.type)).toEqual(['progress', 'progress', 'result']);
    const failing: Planner = {
      name: 'failing',
      async plan() {
        throw new PlannerError('The plan was cut short', 502);
      },
    };
    const failed = await lines(failing);
    expect(failed).toEqual([{ type: 'error', status: 502, error: 'The plan was cut short' }]);
  });
});
