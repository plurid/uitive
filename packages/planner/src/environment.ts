import { anthropic } from './anthropic.js';
import { google } from './google.js';
import { environment, type Model } from './model.js';
import { openai } from './openai.js';

/** The model each provider plans with when `UITIVE_MODEL` names none. */
export const DEFAULT_MODELS = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-6.1-sol',
  google: 'gemini-3.8-flash',
} as const;

/**
 * The model whose key the environment holds, so a server plans with whichever provider it has a key
 * for: Anthropic (`ANTHROPIC_API_KEY`), else OpenAI (`OPENAI_API_KEY`), else Gemini
 * (`GEMINI_API_KEY` or `GOOGLE_API_KEY`). `UITIVE_MODEL` names the model, else each provider's
 * default. Without a key, nothing, for the deterministic planner to take over. Runtimes without a
 * process environment, such as Cloudflare Workers, pass their own variables.
 */
export function environmentModel(
  variables?: Readonly<Record<string, string | undefined>>,
): Model | undefined {
  const read = (name: string) =>
    variables === undefined ? environment(name) : variables[name] || undefined;
  const named = read('UITIVE_MODEL');
  const anthropicKey = read('ANTHROPIC_API_KEY');
  if (anthropicKey !== undefined) {
    return anthropic({ apiKey: anthropicKey, model: named ?? DEFAULT_MODELS.anthropic });
  }
  const openaiKey = read('OPENAI_API_KEY');
  if (openaiKey !== undefined) {
    return openai({ apiKey: openaiKey, model: named ?? DEFAULT_MODELS.openai });
  }
  const googleKey = read('GEMINI_API_KEY') ?? read('GOOGLE_API_KEY');
  if (googleKey !== undefined) {
    return google({ apiKey: googleKey, model: named ?? DEFAULT_MODELS.google });
  }
  return undefined;
}
