import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  action,
  createUitive,
  defineApp,
  page,
  source,
  type AnySourceSpec,
  type PlanProgress,
} from '@plurid/uitive-core';
import { payments } from '../../core/src/__fixtures__/payments.js';
import { scale } from '../../core/src/__fixtures__/scale.js';
import { ops } from './__fixtures__/ops.js';
import { PlannerError, type Model, type ModelCall, type ModelReply } from './model.js';
import { modelPlanner } from './plan.js';
import { RULES } from './prompt.js';
import { outputSchema, size } from './schema.js';

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

const request = () => createUitive({ contract: ops, now: () => 0 }).request('command', 'tidy up');

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
    const ask = createUitive({ contract: scale, now: () => 0 }).request(
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

  it('never counts an unprompted plan as asked for, whatever basis the model claims', async () => {
    const { model } = scripted([{}]);
    const planned = createUitive({ contract: ops, now: () => 0 }).request('plan');
    const result = await modelPlanner({ model }).plan(planned, ops);
    expect(result.operations.length).toBeGreaterThan(0);
    expect(result.operations.every((entry) => entry.scope === undefined)).toBe(true);
  });
});

describe('modelPlanner when the repair fails', () => {
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

  it('keeps what policy accepted of the first answer, and says why', async () => {
    for (const [second, why] of [
      [{ text: 'Sorry, here you go: {oops' }, "The repaired answer didn't follow the plan's form"],
      [{ stop: 'cut' }, "The model couldn't make a plan"],
      [{ stop: 'refused' }, "The model couldn't make a plan"],
      [new PlannerError('OpenAI rate limit reached', 429), 'The model is busy; try again shortly'],
      [new PlannerError('OpenAI timed out', 502), "The model couldn't make a plan"],
    ] as const) {
      const { model, calls } = scripted([{ text: JSON.stringify(orphan) }, second]);
      const result = await modelPlanner({ model }).plan(request(), ops);
      expect(calls).toHaveLength(2);
      expect(result.operations.map((entry) => entry.change.kind)).toEqual(['list', 'choice']);
      expect(result.meta).toMatchObject({ unrepaired: why, stages: 2 });
      expect(result.meta.repaired).toBeUndefined();
    }
  });

  it('still fails when the person canceled, or when no part of the first answer was valid', async () => {
    const caller = new AbortController();
    const { model } = scripted([
      { text: JSON.stringify(orphan) },
      new PlannerError('Canceled', 499),
    ]);
    caller.abort();
    await expect(
      modelPlanner({ model }).plan(request(), ops, { signal: caller.signal }),
    ).rejects.toMatchObject({ status: 499 });
    const { model: stray } = scripted([{ text: 'not json' }, { stop: 'cut' }], 'text');
    await expect(modelPlanner({ model: stray }).plan(request(), ops)).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe('modelPlanner scopes', () => {
  const empty = JSON.stringify({ status: 'done', candidates: [], note: '', pages: [] });
  const enumOf = (call: ModelCall | undefined) =>
    (call?.schema.$defs as Record<string, { enum: string[] }>).action?.enum;

  it('prepares a schema for each request’s actions, not only its sources', async () => {
    const sources: Record<string, AnySourceSpec> = {};
    for (let index = 0; index < 9; index++) {
      sources[`s${index}`] = source({
        label: `Thing ${index}`,
        description: `Things ${index}`,
        row: z.object({ id: z.string(), name: z.string() }),
        key: 'id',
        title: 'name',
      });
    }
    const big = defineApp({
      id: 'big',
      description: 'Nine sources',
      actions: {
        frobnicate: action({ label: 'Frobnicate widgets', description: 'Frobnicates' }),
        zorch: action({ label: 'Zorch gadgets', description: 'Zorches' }),
      },
      sources,
      surfaces: {
        home: page({})({ label: 'Home', description: 'Home', standard: () => ({ sections: [] }) }),
      },
    });
    const { model, calls } = scripted([{ text: empty }, { text: empty }]);
    const planner = modelPlanner({ model });
    const client = createUitive({ contract: big, now: () => 0 });
    await planner.plan(client.request('command', 'frobnicate'), big);
    await planner.plan(client.request('command', 'zorch'), big);
    expect(enumOf(calls[0])).toContain('frobnicate');
    expect(enumOf(calls[1])).toContain('zorch');
    expect(enumOf(calls[1])).not.toContain('frobnicate');
  });

  it('scopes a contract with few sources when its enums would be too large', async () => {
    const many = defineApp({
      id: 'many',
      description: 'Many actions',
      actions: {
        ...Object.fromEntries(
          Array.from({ length: 900 }, (_, index) => [
            `do-${index}`,
            // Runnable, with a param: forms would offer every one of them.
            action({
              label: `Task ${index}`,
              description: 'Something to do',
              effect: 'write',
              params: z.object({ note: z.string() }),
            }),
          ]),
        ),
        frobnicate: action({ label: 'Frobnicate widgets', description: 'Frobnicates' }),
      },
      surfaces: {
        home: page({})({ label: 'Home', description: 'Home', standard: () => ({ sections: [] }) }),
      },
    });
    const { model, calls } = scripted([{ text: empty }]);
    const result = await modelPlanner({ model }).plan(
      createUitive({ contract: many, now: () => 0 }).request('command', 'frobnicate'),
      many,
    );
    expect(result.meta.subset).toEqual([]);
    expect(size(calls[0]?.schema).largestEnum).toBeLessThanOrEqual(400);
    expect(enumOf(calls[0])).toContain('frobnicate');
  });

  it('retries a schema too complex with half the sources, never none', async () => {
    // An empty answer in the form payments' schema asks for.
    const required = outputSchema(payments).required as string[];
    const nothing = Object.fromEntries(
      required.map((key) => [key, key === 'status' ? 'done' : key === 'note' ? '' : []]),
    );
    const { model, calls } = scripted([
      new PlannerError('Schema too complex', 502, 'too-complex'),
      { text: JSON.stringify(nothing) },
    ]);
    // Nothing on screen and no word that names a source: retrieval alone would pick none.
    const ask = createUitive({ contract: payments, now: () => 0 }).request('command', 'calmer');
    const result = await modelPlanner({ model }).plan(ask, payments);
    const sources = (call: ModelCall | undefined) =>
      (call?.schema.$defs as { query?: { properties: { source: { enum: string[] } } } }).query
        ?.properties.source.enum;
    const half = Math.ceil(payments.sourceIds.length / 2);
    expect(sources(calls[0])).toEqual(payments.sourceIds);
    expect(sources(calls[1])).toHaveLength(half);
    expect(result.meta.subset).toHaveLength(half);
    expect(calls[1]?.contract).toContain(`(${half} of ${payments.sourceIds.length} sources`);
  });
});
