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
      environmentModel({ GEMINI_API_KEY: 'g', UITIVE_MODEL: 'gemini-3.1-pro-preview' })?.name,
    ).toBe('gemini-3.1-pro-preview');
    expect(environmentModel({ ANTHROPIC_API_KEY: '' })).toBeUndefined();
    expect(environmentModel({})).toBeUndefined();
  });

  it('plans with the provider UITIVE_MODEL names or implies', () => {
    const keys = { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' };
    expect(environmentModel({ ...keys, UITIVE_MODEL: 'gpt-6.1-sol' })).toMatchObject({
      provider: 'openai',
      name: 'gpt-6.1-sol',
    });
    expect(environmentModel({ ...keys, UITIVE_MODEL: 'gemini-3.8-flash' })).toMatchObject({
      provider: 'google',
      name: 'gemini-3.8-flash',
    });
    expect(environmentModel({ ...keys, UITIVE_MODEL: 'openai:my-finetune' })).toMatchObject({
      provider: 'openai',
      name: 'my-finetune',
    });
    // A name that doesn't tell its provider goes to whichever has a key.
    expect(environmentModel({ ...keys, UITIVE_MODEL: 'my-finetune' })).toMatchObject({
      provider: 'anthropic',
      name: 'my-finetune',
    });
    // The named provider plans or none does, never another provider with a model it lacks.
    expect(environmentModel({ ANTHROPIC_API_KEY: 'a', UITIVE_MODEL: 'gpt-6.1-sol' })).toBe(
      undefined,
    );
  });

  it('reads the process environment when given no variables', () => {
    const saved = { ...process.env };
    try {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.UITIVE_MODEL;
      process.env.OPENAI_API_KEY = 'o';
      expect(environmentModel()?.provider).toBe('openai');
    } finally {
      process.env = saved;
    }
  });
});
