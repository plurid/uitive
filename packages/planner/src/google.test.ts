import { describe, expect, it } from 'vitest';
import { events, fetching, json } from './__fixtures__/responses.js';
import { google } from './google.js';
import type { ModelCall } from './model.js';

const call = (extra: Partial<ModelCall> = {}): ModelCall => ({
  rules: 'Rules',
  contract: 'The contract',
  messages: [
    { role: 'user', content: 'tidy up' },
    { role: 'assistant', content: '{}' },
    { role: 'user', content: 'fix it' },
  ],
  schema: { type: 'object', properties: { status: { type: 'string', const: 'done' } } },
  maxTokens: 900,
  ...extra,
});

const streamed = (finishReason = 'STOP') =>
  events([
    {
      modelVersion: 'gemini-3.8-flash-001',
      candidates: [
        {
          content: { parts: [{ text: 'Thinking it over', thought: true }, { text: '{"status":' }] },
        },
      ],
    },
    {
      candidates: [{ content: { parts: [{ text: '"done"}' }] }, finishReason }],
      usageMetadata: {
        promptTokenCount: 200,
        candidatesTokenCount: 30,
        cachedContentTokenCount: 150,
        thoughtsTokenCount: 40,
      },
    },
  ]);

describe('google', () => {
  it('calls Gemini with structured output, streaming, and leaves thoughts out of the answer', async () => {
    const send = fetching(streamed());
    const seen: string[] = [];
    const reply = await google({
      model: 'gemini-3.8-flash',
      apiKey: 'g-test',
      fetch: send,
    }).generate(call({ onText: (text) => seen.push(text) }));
    const [url, init] = send.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
    );
    expect(init.headers['x-goog-api-key']).toBe('g-test');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toEqual({
      systemInstruction: { parts: [{ text: 'Rules' }, { text: 'The contract' }] },
      contents: [
        { role: 'user', parts: [{ text: 'tidy up' }] },
        { role: 'model', parts: [{ text: '{}' }] },
        { role: 'user', parts: [{ text: 'fix it' }] },
      ],
      generationConfig: {
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['done'] } },
        },
      },
    });
    expect(reply).toEqual({
      text: '{"status":"done"}',
      stop: 'done',
      model: 'gemini-3.8-flash-001',
      usage: { input: 50, output: 70, cacheRead: 150, cacheWrite: 0 },
    });
    expect(seen.at(-1)).toBe('{"status":"done"}');
  });

  it('asks for JSON without a schema, or plain text, for weaker models', async () => {
    const send = fetching(streamed());
    await google({ model: 'gemma', apiKey: 'k', structured: 'json', fetch: send }).generate(call());
    expect(JSON.parse((send.mock.calls[0]?.[1] as { body: string }).body).generationConfig).toEqual(
      {
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
      },
    );
  });

  it('tells a cut answer and a declined one apart', async () => {
    const cut = await google({
      model: 'm',
      apiKey: 'k',
      fetch: fetching(streamed('MAX_TOKENS')),
    }).generate(call());
    expect(cut.stop).toBe('cut');
    const unsafe = await google({
      model: 'm',
      apiKey: 'k',
      fetch: fetching(streamed('SAFETY')),
    }).generate(call());
    expect(unsafe.stop).toBe('refused');
    const blocked = events([{ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }]);
    expect(
      (await google({ model: 'm', apiKey: 'k', fetch: fetching(blocked) }).generate(call())).stop,
    ).toBe('refused');
  });

  it('reports what went wrong with the status the handler should give', async () => {
    const saved = [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY];
    process.env.GEMINI_API_KEY = '';
    process.env.GOOGLE_API_KEY = '';
    try {
      await expect(
        google({ model: 'm', fetch: fetching(streamed()) }).generate(call()),
      ).rejects.toMatchObject({
        status: 503,
        message: 'No Gemini credentials: set GEMINI_API_KEY',
      });
    } finally {
      process.env.GEMINI_API_KEY = saved[0] ?? '';
      process.env.GOOGLE_API_KEY = saved[1] ?? '';
    }
    const invalid = json(
      { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } },
      400,
    );
    await expect(
      google({ model: 'm', apiKey: 'k', fetch: fetching(invalid) }).generate(call()),
    ).rejects.toMatchObject({
      status: 503,
      message: 'Gemini rejected the credentials',
    });
    const busy = json({ error: { code: 429, message: 'Resource exhausted' } }, 429);
    await expect(
      google({ model: 'm', apiKey: 'k', fetch: fetching(busy) }).generate(call()),
    ).rejects.toMatchObject({
      status: 429,
    });
  });
});
