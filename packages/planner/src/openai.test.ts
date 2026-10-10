import { describe, expect, it, vi } from 'vitest';
import { events, fetching, json } from './__fixtures__/responses.js';
import type { ModelCall } from './model.js';
import { openai } from './openai.js';

const call = (extra: Partial<ModelCall> = {}): ModelCall => ({
  rules: 'Rules',
  contract: 'The contract',
  messages: [{ role: 'user', content: 'tidy up' }],
  schema: {
    type: 'object',
    properties: { status: { type: 'string', const: 'done' } },
    required: ['status'],
    additionalProperties: false,
  },
  maxTokens: 900,
  ...extra,
});

const streamed = (finish = 'stop') =>
  events([
    { model: 'gpt-6.1-sol-2026-09', choices: [{ delta: { content: '{"status":' } }] },
    { choices: [{ delta: { content: '"done"}' }, finish_reason: finish }] },
    {
      choices: [],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 100 },
      },
    },
    '[DONE]',
  ]);

describe('openai', () => {
  it("calls OpenAI's Chat Completions with strict structured outputs, streaming", async () => {
    const send = fetching(streamed());
    const seen: string[] = [];
    const reply = await openai({ model: 'gpt-6.1-sol', apiKey: 'sk-test', fetch: send }).generate(
      call({ onText: (text) => seen.push(text) }),
    );
    const [url, init] = send.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-6.1-sol',
      max_completion_tokens: 900,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: 'Rules\n\nThe contract' },
        { role: 'user', content: 'tidy up' },
      ],
    });
    // Strict mode takes no `const`: it becomes an enum of one.
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'plan',
        strict: true,
        schema: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['done'] } },
          required: ['status'],
          additionalProperties: false,
        },
      },
    });
    expect(reply).toEqual({
      text: '{"status":"done"}',
      stop: 'done',
      model: 'gpt-6.1-sol-2026-09',
      usage: { input: 20, output: 30, cacheRead: 100, cacheWrite: 0 },
    });
    expect(seen).toEqual(['{"status":', '{"status":"done"}']);
  });

  it('serves compatible servers, with JSON mode or plain text for those without structured outputs', async () => {
    const send = fetching(streamed());
    const local = openai({
      model: 'qwen3',
      baseURL: 'http://localhost:11434/v1/',
      structured: 'json',
      fetch: send,
    });
    await local.generate(call());
    const [url, init] = send.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.headers.authorization).toBeUndefined();
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.max_tokens).toBe(900);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(local.structured).toBe('json');

    const plain = fetching(streamed());
    await openai({
      model: 'qwen3',
      baseURL: 'http://localhost:11434/v1',
      structured: 'text',
      fetch: plain,
    }).generate(call());
    expect(JSON.parse((plain.mock.calls[0]?.[1] as { body: string }).body)).not.toHaveProperty(
      'response_format',
    );
  });

  it('reads an answer given in one piece, and how it stopped', async () => {
    const whole = json({
      model: 'gpt-6.1-sol',
      choices: [{ message: { content: '{"status":"done"}' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 5, completion_tokens: 7 },
    });
    const reply = await openai({
      model: 'gpt-6.1-sol',
      apiKey: 'k',
      fetch: fetching(whole),
    }).generate(call());
    expect(reply).toMatchObject({
      text: '{"status":"done"}',
      stop: 'cut',
      usage: { input: 5, output: 7 },
    });

    const refused = events([
      { choices: [{ delta: { refusal: 'I can’t help with that.' }, finish_reason: 'stop' }] },
    ]);
    const declined = await openai({ model: 'm', apiKey: 'k', fetch: fetching(refused) }).generate(
      call(),
    );
    expect(declined.stop).toBe('refused');
  });

  it('reports what went wrong with the status the handler should give', async () => {
    await expect(
      openai({ model: 'm', fetch: fetching(streamed()) }).generate(call()),
    ).rejects.toMatchObject({
      status: 503,
      message: 'No OpenAI credentials: set OPENAI_API_KEY',
    });
    const cases: [number, string, Record<string, unknown>][] = [
      [
        401,
        'Incorrect API key provided',
        { status: 503, message: 'OpenAI rejected the credentials' },
      ],
      [429, 'Rate limit reached', { status: 429 }],
      [400, 'Invalid schema: too many enum values', { status: 502, reason: 'too-complex' }],
      [
        404,
        'The model does not exist',
        { status: 502, message: 'OpenAI error 404: The model does not exist' },
      ],
    ];
    for (const [status, message, expected] of cases) {
      const send = fetching(json({ error: { message } }, status));
      await expect(
        openai({ model: 'm', apiKey: 'k', fetch: send }).generate(call()),
      ).rejects.toMatchObject(expected);
    }
    const down = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    await expect(
      openai({ model: 'm', baseURL: 'http://localhost:1234/v1', fetch: down as never }).generate(
        call(),
      ),
    ).rejects.toMatchObject({
      status: 502,
      message: "localhost:1234 couldn't be reached: connect ECONNREFUSED",
    });
  });

  it('takes any refusal of the schema as too complex, so a smaller one is tried', async () => {
    const send = fetching(
      json({ error: { message: "Invalid schema: 'pattern' isn't allowed" } }, 400),
    );
    await expect(
      openai({ model: 'm', apiKey: 'k', fetch: send }).generate(call()),
    ).rejects.toMatchObject({ status: 502, reason: 'too-complex' });
  });

  it('fails with a status when the stream reports an error, times out or is canceled', async () => {
    const errored = events([
      { choices: [{ delta: { content: '{"sta' } }] },
      { error: { message: 'The server is overloaded', type: 'server_error' } },
    ]);
    await expect(
      openai({ model: 'm', apiKey: 'k', fetch: fetching(errored) }).generate(call()),
    ).rejects.toMatchObject({
      status: 502,
      message: 'OpenAI failed mid-answer: The server is overloaded',
    });

    const encoder = new TextEncoder();
    /** A stream that sends a little, then waits until its call is aborted. */
    const stalling = vi.fn(async (_url: string, init: { signal?: unknown }) => {
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{"}}]}\n\n'));
          signal.addEventListener('abort', () => controller.error(signal.reason));
        },
      });
      return new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
      }) as never;
    });
    await expect(
      openai({ model: 'm', apiKey: 'k', timeoutMs: 50, fetch: stalling }).generate(call()),
    ).rejects.toMatchObject({ status: 502, message: 'OpenAI timed out' });

    const caller = new AbortController();
    const pending = openai({ model: 'm', apiKey: 'k', fetch: stalling }).generate(
      call({ signal: caller.signal }),
    );
    setTimeout(() => caller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ status: 499 });
  });
});
