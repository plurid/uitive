import { anthropic, google, modelPlanner, openai, type Model } from '@plurid/uitive-server';

// #region providers
// Claude: reads ANTHROPIC_API_KEY, or an `ant auth login` profile.
export const claude = modelPlanner({ model: anthropic({ model: 'claude-sonnet-5-5' }) });

// OpenAI: reads OPENAI_API_KEY.
export const gpt = modelPlanner({ model: openai({ model: 'gpt-6.1-sol' }) });

// Gemini: reads GEMINI_API_KEY.
export const gemini = modelPlanner({ model: google({ model: 'gemini-3.8-flash' }) });
// #endregion

// #region local
// Any server that speaks OpenAI's API, such as Ollama on this machine: no key, and JSON mode for
// models without structured outputs.
export const local = modelPlanner({
  model: openai({ model: 'qwen3', baseURL: 'http://localhost:11434/v1', structured: 'json' }),
});
// #endregion

// #region custom
// Any other provider: one call that returns the answer's text, how it stopped and what it used.
export const acme: Model = {
  provider: 'acme',
  name: 'acme-large',
  structured: 'json',
  async generate(call) {
    const response = await fetch('https://llm.acme.example/v1/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.ACME_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
        system: `${call.rules}\n\n${call.contract}`,
        messages: call.messages,
        maxTokens: call.maxTokens,
      }),
    });
    const answer = (await response.json()) as {
      text: string;
      truncated: boolean;
      tokens: { read: number; written: number };
    };
    return {
      text: answer.text,
      stop: answer.truncated ? 'cut' : 'done',
      model: 'acme-large',
      usage: {
        input: answer.tokens.read,
        output: answer.tokens.written,
        cacheRead: 0,
        cacheWrite: 0,
      },
    };
  },
};
// #endregion
