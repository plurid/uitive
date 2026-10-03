import Anthropic from '@anthropic-ai/sdk';
import type { PlanRequest } from '@plurid/uitive-core';
import {
  anthropic,
  DEFAULT_MODELS,
  google,
  modelPlanner,
  openai,
  type Model,
} from '@plurid/uitive-planner';
import { adapterById } from '../adapters.ts';
import { planMessage } from '../messages.ts';
import type { PlanReply } from '../messages.ts';
import { meter } from './limits.ts';
import { getSecret } from './secrets.ts';

/**
 * Plans with the person's own key for a model, in the worker: the key never reaches a page or a
 * content script. Progress keeps the port, and so the worker, alive while the plan streams.
 */
export function servePlanner(port: chrome.runtime.Port): void {
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  const send = (reply: PlanReply) => {
    try {
      port.postMessage(reply);
    } catch {
      // The page went away.
    }
  };
  port.onMessage.addListener((raw: unknown) => {
    void (async () => {
      const parsed = planMessage.safeParse(raw);
      const loaded = parsed.success ? adapterById(parsed.data.adapter) : undefined;
      const origin = port.sender?.origin;
      if (!parsed.success || !loaded || !origin || !loaded.adapter.origins.includes(origin)) {
        send({ kind: 'error', code: 'failed', problem: 'Not a request this extension takes' });
        return;
      }
      const model = await storedModel();
      if (!model) {
        send({ kind: 'error', code: 'no-key', problem: 'Add a key for a model in the side panel' });
        return;
      }
      try {
        const planner = modelPlanner({ model });
        const result = await planner.plan(
          parsed.data.request as unknown as PlanRequest,
          loaded.contract,
          {
            signal: controller.signal,
            onProgress: (progress) => send({ kind: 'progress', progress }),
          },
        );
        const usage = result.meta.usage;
        if (usage) await meter('tokens', usage.input + usage.output);
        send({ kind: 'result', result });
      } catch (error) {
        send({ kind: 'error', code: 'failed', problem: (error as Error).message });
      }
    })();
  });
}

/** The model the person has a key for: Claude, else OpenAI, else Gemini, as in the side panel. */
async function storedModel(): Promise<Model | undefined> {
  const claude = await getSecret('anthropic');
  if (claude) {
    return anthropic({ client: new Anthropic({ apiKey: claude, dangerouslyAllowBrowser: true }) });
  }
  const gpt = await getSecret('openai');
  if (gpt) return openai({ model: DEFAULT_MODELS.openai, apiKey: gpt });
  const gemini = await getSecret('google');
  if (gemini) return google({ model: DEFAULT_MODELS.google, apiKey: gemini });
  return undefined;
}
