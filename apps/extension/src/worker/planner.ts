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
import { meter, PLANS_PER_MINUTE, rate, TOKEN_BUDGET } from './limits.ts';
import { getSecret } from './secrets.ts';

const paced = rate(PLANS_PER_MINUTE);
const running = new Set<AbortController>();
let generation = 0;

/** Stops every plan under way: after Forget, no meter comes back. */
export function forgetPlans(): void {
  generation += 1;
  for (const controller of running) controller.abort();
  running.clear();
}

/**
 * Plans with the person's own key for a model, in the worker: the key never reaches a page or a
 * content script. Progress keeps the port, and so the worker, alive while the plan streams. Each
 * port carries one request, checked field by field, within a rate and a monthly token budget.
 */
export function servePlanner(port: chrome.runtime.Port): void {
  const controller = new AbortController();
  running.add(controller);
  port.onDisconnect.addListener(() => {
    controller.abort();
    running.delete(controller);
  });
  const send = (reply: PlanReply) => {
    try {
      port.postMessage(reply);
    } catch {
      // The page went away.
    }
  };
  let asked = false;
  port.onMessage.addListener((raw: unknown) => {
    void (async () => {
      const parsed = planMessage.safeParse(raw);
      const loaded = parsed.success ? adapterById(parsed.data.adapter) : undefined;
      const origin = port.sender?.origin;
      if (
        asked ||
        !parsed.success ||
        !loaded ||
        !origin ||
        !loaded.adapter.origins.includes(origin) ||
        parsed.data.request.contract.id !== loaded.contract.id ||
        parsed.data.request.contract.hash !== loaded.contract.hash
      ) {
        send({ kind: 'error', code: 'failed', problem: 'Not a request this extension takes' });
        return;
      }
      asked = true;
      if (!paced()) {
        send({
          kind: 'error',
          code: 'over-budget',
          problem: `More than ${PLANS_PER_MINUTE} requests in a minute; wait a moment`,
        });
        return;
      }
      if ((await meter('tokens')) >= TOKEN_BUDGET) {
        send({
          kind: 'error',
          code: 'over-budget',
          problem: `This month's ${TOKEN_BUDGET.toLocaleString('en')} tokens are used; more are available next month`,
        });
        return;
      }
      const model = await storedModel();
      if (!model) {
        send({ kind: 'error', code: 'no-key', problem: 'Add a key for a model in the side panel' });
        return;
      }
      const started = generation;
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
        if (usage && started === generation) await meter('tokens', usage.input + usage.output);
        send({ kind: 'result', result });
      } catch (error) {
        send({ kind: 'error', code: 'failed', problem: (error as Error).message });
      } finally {
        running.delete(controller);
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
