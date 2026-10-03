import { describe, expect, it, vi } from 'vitest';
import { createAptuitive, type PlanProgress } from '@plurid/aptuitive-core';
import { scale } from '../../core/src/__fixtures__/scale.js';
import { ops } from './__fixtures__/ops.js';
import { PlannerError, type Model, type ModelCall, type ModelReply } from './model.js';
import { modelPlanner } from './plan.js';
import { RULES } from './prompt.js';

const answer = {
  status: 'done',
  candidates: [],
  note: 'A calmer page',
  lists: [
    {
      surface: 'nav',
      context: 'none',
      op: 'pin',
      target: 'machine-3',
      index: -1,
      basis: 'request',
      metric: 'none',
    },
  ],
  choices: [{ surface: 'density', value: 'compact', basis: 'request' }],
  pages: [
    {
      surface: 'detail',
      context: '*',
      op: 'set',
      slug: '',
      title: '',
      root: 'top',
      elements: [
        { id: 'top', block: 'section', props: { title: 'Mine', layout: 'grid' }, children: ['n'] },
        { id: 'n', block: 'note', props: { text: 'Hello' }, children: [] },
      ],
      basis: 'request',
    },
  ],
};

const request = () =>
  createAptuitive({ contract: ops, now: () => 0 }).request('command', 'tidy up');

/** A model that answers with these replies in turn, keeping each call it was given. */
function scripted(
  replies: (Partial<ModelReply> | Error)[],
  structured: Model['structured'] = 'schema',
) {
  const calls: ModelCall[] = [];
  const model: Model = {
    provider: 'test',
    name: 'test-model',
    structured,
    generate: vi.fn(async (call: ModelCall): Promise<ModelReply> => {
      calls.push({ ...call, messages: [...call.messages] });
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return {
        text: JSON.stringify(answer),
        stop: 'done',
        model: 'test-model',
        usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0 },
        ...next,
      };
    }),
  };
  return { model, calls };
}

describe('modelPlanner', () => {
  it('asks with the rules, the contract and its schema, and turns the answer into operations', async () => {
    const { model, calls } = scripted([{ cost: 0.01 }]);
    const result = await modelPlanner({ model }).plan(request(), ops);
    expect(calls[0]?.rules).toBe(RULES);
    expect(calls[0]?.contract).not.toContain('JSON Schema');
    expect(calls[0]?.schema).toHaveProperty('$defs');
    expect(calls[0]?.maxTokens).toBe(16_000);
    expect(calls[0]?.messages.map((message) => message.role)).toEqual(['user']);
    expect(result.operations.map((entry) => entry.change.kind)).toEqual(['list', 'choice', 'page']);
    expect(result.operations[0]).toMatchObject({ scope: 'explicit', note: 'A calmer page' });
    expect(result.meta).toMatchObject({
      planner: 'test',
      model: 'test-model',
      usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0 },
      cost: 0.01,
      stages: 1,
    });
  });

  it('reports refusals and truncation as failures', async () => {
    for (const [reply, message] of [
      [{ stop: 'refused' }, 'The model declined this request'],
      [{ stop: 'cut' }, 'The plan was cut short'],
    ] as const) {
      const { model } = scripted([reply]);
      await expect(modelPlanner({ model }).plan(request(), ops)).rejects.toEqual(
        new PlannerError(message, 502),
      );
    }
  });

  it('sends what policy would reject back once, then takes the repaired plan', async () => {
    const orphan = {
      ...answer,
      pages: [
        {
          ...answer.pages[0],
          elements: [
            {
              id: 'top',
              block: 'section',
              props: { title: 'Mine', layout: 'grid' },
              children: ['ghost'],
            },
          ],
        },
      ],
    };
    const { model, calls } = scripted([{ text: JSON.stringify(orphan) }, {}]);
    const result = await modelPlanner({ model }).plan(request(), ops);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(calls[1]?.messages[2]?.content).toContain('The application rejected part of that plan');
    expect(result.meta).toMatchObject({ repaired: true, stages: 2, usage: { input: 20 } });
  });

  it('puts the schema in the prompt for models without structured output, and repairs a stray answer', async () => {
    const stray = { ...answer, status: 'finished' };
    const { model, calls } = scripted(
      [{ text: `Here is the plan:\n\`\`\`json\n${JSON.stringify(stray)}\n\`\`\`` }, {}],
      'json',
    );
    const result = await modelPlanner({ model }).plan(request(), ops);
    expect(calls[0]?.contract).toContain('It must follow this JSON Schema');
    expect(calls[1]?.messages[2]?.content).toContain('/status: must be one of');
    expect(result.meta.repaired).toBe(true);
    expect(result.operations).toHaveLength(3);
  });

  it('fails when the answer still strays after a repair', async () => {
    const { model } = scripted([{ text: 'not json' }, { text: 'still not json' }], 'text');
    await expect(modelPlanner({ model }).plan(request(), ops)).rejects.toThrow(
      "The model's answer didn't follow the plan's form, even when asked again",
    );
  });

  it('reports page elements as they stream', async () => {
    const text = JSON.stringify(answer);
    const middle = text.indexOf('"note"', text.indexOf('"elements"'));
    const model: Model = {
      provider: 'test',
      name: 'test-model',
      structured: 'schema',
      async generate(call) {
        call.onText?.(text.slice(0, middle));
        call.onText?.(text);
        return {
          text,
          stop: 'done',
          model: 'test-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        };
      },
    };
    const seen: PlanProgress[] = [];
    await modelPlanner({ model }).plan(request(), ops, {
      onProgress: (progress) => seen.push(progress),
    });
    expect(seen).toEqual([
      { stage: 'planning', elements: 0 },
      { stage: 'planning', elements: 2 },
    ]);
  });

  it('scopes large contracts, and retries with less when a provider finds the schema too complex', async () => {
    const empty = JSON.stringify({ status: 'done', candidates: [], note: '', pages: [] });
    const { model, calls } = scripted([
      new PlannerError('Schema too complex', 502, 'too-complex'),
      { text: empty },
    ]);
    const ask = createAptuitive({ contract: scale, now: () => 0 }).request(
      'command',
      'refund the disputed charges',
    );
    const result = await modelPlanner({ model }).plan(ask, scale);
    expect(calls).toHaveLength(2);
    expect(result.meta.stages).toBe(2);
    expect(result.meta.subset?.length).toBeGreaterThan(0);
    expect(result.meta.subset?.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(calls[1]?.schema).length).toBeLessThan(
      JSON.stringify(calls[0]?.schema).length,
    );
  });

  it('passes other failures on, with their status', async () => {
    const { model } = scripted([new PlannerError('No credentials', 503)]);
    await expect(modelPlanner({ model }).plan(request(), ops)).rejects.toMatchObject({
      status: 503,
    });
  });
});
