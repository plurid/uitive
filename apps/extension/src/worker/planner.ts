import Anthropic from '@anthropic-ai/sdk';
import type { PlanRequest } from '@plurid/aptuitive-core';
import { anthropicPlanner } from '@plurid/aptuitive-planner';
import { adapterById } from '../adapters.ts';
import { planMessage } from '../messages.ts';
import type { PlanReply } from '../messages.ts';
import { meter } from './limits.ts';
import { getSecret } from './secrets.ts';

/**
 * Plans with the person's own Claude key, in the worker: the key never reaches a page or a
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
      const key = await getSecret('anthropic');
      if (!key) {
        send({ kind: 'error', code: 'no-key', problem: 'Add a Claude API key in the side panel' });
        return;
      }
      try {
        const planner = anthropicPlanner({
          client: new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }),
        });
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
