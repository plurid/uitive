import { describe, expect, it, vi } from 'vitest';
import { createUitive } from '@plurid/uitive-core';
import { ops } from './__fixtures__/ops.js';
import { anthropic } from './anthropic.js';
import { PlannerError, type ModelCall } from './model.js';
import { modelPlanner } from './plan.js';

const reply = (overrides: Partial<{ text: string; stop_reason: string; model: string }> = {}) => ({
  model: overrides.model ?? 'claude-opus-5-5',
  stop_reason: overrides.stop_reason ?? 'end_turn',
  content: [{ type: 'text', text: overrides.text ?? '{}' }],
  usage: {
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 4000,
    cache_creation_input_tokens: 0,
  },
});

function fake(overrides: Parameters<typeof reply>[0] = {}) {
  const create = vi.fn(async (_body: unknown, _options: unknown) => reply(overrides));
  return { create, client: { beta: { messages: { create } } } as never };
}

const call = (extra: Partial<ModelCall> = {}): ModelCall => ({
  rules: 'Rules',
  contract: 'The contract',
  messages: [{ role: 'user', content: 'tidy up' }],
  schema: { type: 'object' },
  maxTokens: 900,
  ...extra,
});

describe('anthropic', () => {
  it('asks with structured outputs, a cached contract and the refusal fallback', async () => {
    const { create, client } = fake();
    await anthropic({ client }).generate(call());
    const [body, options] = create.mock.calls[0] as unknown as [
      {
        model: string;
        max_tokens: number;
        output_config: { effort: string; format: { type: string; schema: unknown } };
        system: { text: string; cache_control?: unknown }[];
        fallbacks: unknown;
        betas: unknown;
      },
      { maxRetries: number; timeout: number },
    ];
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(900);
    expect(body.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: { type: 'object' } },
    });
    expect(body.system.map((block) => block.text)).toEqual(['Rules', 'The contract']);
    expect(body.system[1]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.fallbacks).toBe('default');
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(options).toMatchObject({ maxRetries: 1, timeout: 60_000 });
  });

  it('reports the answer, how it stopped, usage and cost', async () => {
    const { client } = fake({ text: '{"status":"done"}' });
    expect(await anthropic({ client }).generate(call())).toEqual({
      text: '{"status":"done"}',
      stop: 'done',
      model: 'claude-opus-5-5',
      usage: { input: 1000, output: 500, cacheRead: 4000, cacheWrite: 0 },
      cost: 0.0148,
    });
    for (const [stop_reason, stop] of [
      ['refusal', 'refused'],
      ['max_tokens', 'cut'],
    ] as const) {
      const { client: other } = fake({ stop_reason });
      expect((await anthropic({ client: other }).generate(call())).stop).toBe(stop);
    }
  });

  it('can leave the fallback out', async () => {
    const { create, client } = fake();
    await anthropic({ client, fallbacks: false }).generate(call());
    expect((create.mock.calls[0]?.[0] as Record<string, unknown>).fallbacks).toBeUndefined();
  });

  it('streams where the client can', async () => {
    const final = reply({ text: '{"a":1}' });
    const stream = vi.fn(() => {
      let listener: ((delta: string, snapshot: string) => void) | undefined;
      return {
        on(_event: 'text', next: (delta: string, snapshot: string) => void) {
          listener = next;
          return this;
        },
        async finalMessage() {
          listener?.('', '{"a"');
          listener?.('', '{"a":1}');
          return final;
        },
      };
    });
    const seen: string[] = [];
    const client = { beta: { messages: { create: vi.fn(), stream } } } as never;
    await anthropic({ client }).generate(call({ onText: (text) => seen.push(text) }));
    expect(seen).toEqual(['{"a"', '{"a":1}']);
  });

  it('answers failures with the status the handler should give', async () => {
    const failing = (error: unknown) => ({
      beta: {
        messages: {
          create: vi.fn(async () => {
            throw error;
          }),
        },
      },
    });
    const statusError = (status: number, message: string) =>
      Object.assign(new Error(message), { status });
    const cases: [unknown, Partial<PlannerError>][] = [
      [
        statusError(401, 'invalid x-api-key'),
        { status: 503, message: 'Anthropic rejected the credentials' },
      ],
      [statusError(429, 'slow down'), { status: 429 }],
      [
        statusError(400, 'Schema is too complex for compilation'),
        { status: 502, reason: 'too-complex' },
      ],
      [statusError(500, 'overloaded'), { status: 502, message: 'Anthropic error 500: overloaded' }],
      [new Error('Could not resolve authentication method'), { status: 503 }],
    ];
    for (const [error, expected] of cases) {
      await expect(
        anthropic({ client: failing(error) as never }).generate(call()),
      ).rejects.toMatchObject(expected);
    }
  });

  it('plans through modelPlanner, reported as Anthropic', async () => {
    const text = JSON.stringify({
      status: 'done',
      candidates: [],
      note: '',
      lists: [],
      choices: [],
      pages: [],
    });
    const { client } = fake({ text });
    const result = await modelPlanner({ model: anthropic({ client }) }).plan(
      createUitive({ contract: ops, now: () => 0 }).request('command', 'tidy up'),
      ops,
    );
    expect(result.meta).toMatchObject({
      planner: 'anthropic',
      model: 'claude-opus-5-5',
      cost: 0.0148,
    });
  });
});
