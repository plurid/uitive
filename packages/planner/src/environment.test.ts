import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, environmentModel } from './environment.js';

describe('environmentModel', () => {
  it('plans with whichever provider the environment has a key for', () => {
    expect(environmentModel({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' })).toMatchObject({
      provider: 'anthropic',
      name: DEFAULT_MODELS.anthropic,
    });
    expect(environmentModel({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' })).toMatchObject({
      provider: 'openai',
      name: DEFAULT_MODELS.openai,
    });
    expect(environmentModel({ GOOGLE_API_KEY: 'g' })).toMatchObject({
      provider: 'google',
      name: DEFAULT_MODELS.google,
    });
    expect(
      environmentModel({ GEMINI_API_KEY: 'g', APTUITIVE_MODEL: 'gemini-3.1-pro-preview' })?.name,
    ).toBe('gemini-3.1-pro-preview');
    expect(environmentModel({ ANTHROPIC_API_KEY: '' })).toBeUndefined();
    expect(environmentModel({})).toBeUndefined();
  });

  it('reads the process environment when given no variables', () => {
    const saved = { ...process.env };
    try {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.APTUITIVE_MODEL;
      process.env.OPENAI_API_KEY = 'o';
      expect(environmentModel()?.provider).toBe('openai');
    } finally {
      process.env = saved;
    }
  });
});
