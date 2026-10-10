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

type Provider = keyof typeof DEFAULT_MODELS;

/** The provider a model's name belongs to, when the name tells. */
function providerOf(model: string): Provider | undefined {
  if (/^claude-/.test(model)) return 'anthropic';
  if (/^(gpt-|chatgpt-|o\d)/.test(model)) return 'openai';
  if (/^(gemini-|gemma-)/.test(model)) return 'google';
  return undefined;
}

/**
 * The model whose key the environment holds, so a server plans with whichever provider it has a key
 * for: Anthropic (`ANTHROPIC_API_KEY`), else OpenAI (`OPENAI_API_KEY`), else Gemini
 * (`GEMINI_API_KEY` or `GOOGLE_API_KEY`), each with its default model. `UITIVE_MODEL` names the
 * model, with its provider first when its name doesn't tell (`openai:qwen3`); a model whose
 * provider is named or known (`claude-…`, `gpt-…`, `gemini-…`) plans only with that provider's key.
 * Without a key, nothing, for the deterministic planner to take over. Runtimes without a process
 * environment, such as Cloudflare Workers, pass their own variables.
 */
export function environmentModel(
  variables?: Readonly<Record<string, string | undefined>>,
): Model | undefined {
  const read = (name: string) =>
    variables === undefined ? environment(name) : variables[name] || undefined;
  const asked = read('UITIVE_MODEL');
  const prefixed = /^(anthropic|openai|google):(.+)$/.exec(asked ?? '');
  const named = prefixed?.[2] ?? asked;
  const wanted =
    (prefixed?.[1] as Provider | undefined) ??
    (named === undefined ? undefined : providerOf(named));
  const keys: Record<Provider, string | undefined> = {
    anthropic: read('ANTHROPIC_API_KEY'),
    openai: read('OPENAI_API_KEY'),
    google: read('GEMINI_API_KEY') ?? read('GOOGLE_API_KEY'),
  };
  const provider = wanted ?? (Object.keys(keys) as Provider[]).find((name) => keys[name]);
  const apiKey = provider === undefined ? undefined : keys[provider];
  if (provider === undefined || apiKey === undefined) return undefined;
  const model = named ?? DEFAULT_MODELS[provider];
  if (provider === 'anthropic') return anthropic({ apiKey, model });
  if (provider === 'openai') return openai({ apiKey, model });
  return google({ apiKey, model });
}
