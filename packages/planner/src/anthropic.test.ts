import { describe, expect, it, vi } from 'vitest';
import { createAptuitive, type PlanProgress } from '@plurid/aptuitive-core';
import { scale } from '../../core/src/__fixtures__/scale.js';
import { ops } from './__fixtures__/ops.js';
import { anthropicPlanner, PlannerError } from './anthropic.js';

function fake(reply: Partial<{ text: string; stop_reason: string; model: string }> = {}) {
  const create = vi.fn(async (_body: unknown, _options: unknown) => ({
    model: reply.model ?? 'claude-opus-5-5',
    stop_reason: reply.stop_reason ?? 'end_turn',
    content: [{ type: 'text', text: reply.text ?? '{}' }],
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 4000,
      cache_creation_input_tokens: 0,
    },
  }));
  return { create, client: { beta: { messages: { create } } } as never };
}

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

describe('anthropicPlanner', () => {
  it('asks with the compiled schema, a cached contract and the refusal fallback', async () => {
    const { create, client } = fake({ text: JSON.stringify(answer) });
    await anthropicPlanner({ client }).plan(request(), ops);
    const [body, options] = create.mock.calls[0] as unknown as [
      {
        model: string;
        output_config: { effort: string; format: { type: string } };
        system: { cache_control?: unknown }[];
        fallbacks: unknown;
        betas: unknown;
      },
      { maxRetries: number },
    ];
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.system[1]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.fallbacks).toBe('default');
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(options.maxRetries).toBe(1);
  });

  it('turns the answer into operations, with usage and cost', async () => {
    const { client } = fake({ text: JSON.stringify(answer) });
    const result = await anthropicPlanner({ client }).plan(request(), ops);
    expect(result.operations.map((entry) => entry.change.kind)).toEqual(['list', 'choice', 'page']);
    expect(result.operations[0]).toMatchObject({
      scope: 'explicit',
      note: 'A calmer page',
      evidence: [{ intent: true }],
    });
    expect(result.operations[2]?.change).toMatchObject({ kind: 'page', context: '*', op: 'set' });
    expect(result.meta).toMatchObject({
      planner: 'claude',
      usage: { input: 1000, output: 500, cacheRead: 4000, cacheWrite: 0 },
      cost: 0.0148,
    });
  });

  it('reports refusals, truncation and unreadable answers as failures', async () => {
    for (const [reply, message] of [
      [{ stop_reason: 'refusal' }, 'The model declined this request'],
      [{ stop_reason: 'max_tokens' }, 'The plan was cut short'],
      [{ text: 'not json' }, 'The model returned something other than a plan'],
    ] as const) {
      const { client } = fake(reply);
      await expect(anthropicPlanner({ client }).plan(request(), ops)).rejects.toEqual(
        new PlannerError(message, 502),
      );
    }
  });

  it('can leave the fallback out', async () => {
    const { create, client } = fake({ text: JSON.stringify(answer) });
    await anthropicPlanner({ client, fallbacks: false }).plan(request(), ops);
    expect((create.mock.calls[0]?.[0] as Record<string, unknown>).fallbacks).toBeUndefined();
  });

  it('streams where it can, reporting elements as they arrive', async () => {
    const text = JSON.stringify(answer);
    const final = {
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
    const stream = vi.fn((_body: unknown, _options: unknown) => {
      let listener: ((delta: string, snapshot: string) => void) | undefined;
      return {
        on(_event: 'text', next: (delta: string, snapshot: string) => void) {
          listener = next;
          return this;
        },
        async finalMessage() {
          const middle = text.indexOf('"note"', text.indexOf('"elements"'));
          listener?.('', text.slice(0, middle));
          listener?.('', text);
          return final;
        },
      };
    });
    const seen: PlanProgress[] = [];
    const client = { beta: { messages: { create: vi.fn(), stream } } } as never;
    await anthropicPlanner({ client }).plan(request(), ops, {
      onProgress: (progress) => seen.push(progress),
    });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      { stage: 'planning', elements: 0 },
      { stage: 'planning', elements: 2 },
    ]);
  });

  it('sends what policy would reject back once, then takes the repaired plan', async () => {
    const broken = {
      ...answer,
      pages: [
        { ...answer.pages[0], elements: [{ id: 'top', block: 'gauge', props: {}, children: [] }] },
      ],
    };
    const replies = [broken, answer];
    const create = vi.fn(async (_body: unknown, _options: unknown) => ({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(replies.shift() ?? broken) }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }));
    const client = { beta: { messages: { create } } } as never;
    const result = await anthropicPlanner({ client }).plan(request(), ops);
    expect(create).toHaveBeenCalledTimes(2);
    const second = create.mock.calls[1]?.[0] as { messages: { role: string; content: string }[] };
    expect(second.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(second.messages[2]?.content).toContain('page detail (*): No block "gauge"');
    expect(result.meta).toMatchObject({
      repaired: true,
      stages: 2,
      usage: { input: 200, output: 100 },
    });
    expect(result.operations.map((entry) => entry.change.kind)).toEqual(['list', 'choice', 'page']);

    const stubborn = vi.fn(create.getMockImplementation() as never);
    replies.push(broken, broken);
    await anthropicPlanner({ client: { beta: { messages: { create: stubborn } } } as never }).plan(
      request(),
      ops,
    );
    expect(stubborn).toHaveBeenCalledTimes(2);
  });

  it('scopes large contracts, and retries a grammar too complex to compile with less', async () => {
    const tooBig = Object.assign(new Error('Schema is too complex for compilation'), {
      status: 400,
    });
    let calls = 0;
    const schemas: unknown[] = [];
    const create = vi.fn(async (body: { output_config: { format: { schema: unknown } } }) => {
      calls++;
      schemas.push(body.output_config.format.schema);
      if (calls === 1) throw tooBig;
      return {
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({ status: 'done', candidates: [], note: '', pages: [] }),
          },
        ],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      };
    });
    const client = { beta: { messages: { create } } } as never;
    const ask = createAptuitive({ contract: scale, now: () => 0 }).request(
      'command',
      'refund the disputed charges',
    );
    const result = await anthropicPlanner({ client }).plan(ask, scale);
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.meta.stages).toBe(2);
    expect(result.meta.subset?.length).toBeGreaterThan(0);
    expect(result.meta.subset?.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(schemas[1]).length).toBeLessThan(JSON.stringify(schemas[0]).length);
  });
});
