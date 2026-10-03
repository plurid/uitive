import type { Fetch, FetchResult, Planner, PlanRequest, PlanResult } from '@plurid/aptuitive-core';
import type { PlanReply } from '../messages.ts';

export class PlannerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Plans in the worker, which holds the person's key; the request is all that crosses. */
export function workerPlanner(adapter: string, sent: (request: PlanRequest) => void): Planner {
  return {
    name: 'model',
    plan(request, _contract, options) {
      // Plans nobody asked for stay with the deterministic planner: they cost nothing.
      if (request.kind !== 'command') {
        return Promise.reject(
          new PlannerError('unprompted', 'Only requests people make go to the model'),
        );
      }
      sent(request);
      const port = chrome.runtime.connect({ name: 'planner' });
      return new Promise<PlanResult>((resolve, reject) => {
        let settled = false;
        port.onMessage.addListener((reply: PlanReply) => {
          if (reply.kind === 'progress') {
            options?.onProgress?.(reply.progress);
            return;
          }
          settled = true;
          port.disconnect();
          if (reply.kind === 'result') resolve(reply.result as PlanResult);
          else reject(new PlannerError(reply.code, reply.problem));
        });
        port.onDisconnect.addListener(() => {
          if (!settled) reject(new PlannerError('failed', 'The planner stopped'));
        });
        port.postMessage({ adapter, request });
      });
    },
  };
}

/** Tries one planner, then another: a model when there's a key, the deterministic one otherwise. */
export function fallback(primary: Planner, secondary: Planner): Planner {
  return {
    name: primary.name,
    async plan(request, contract, options) {
      try {
        return await primary.plan(request, contract, options);
      } catch (error) {
        const result = await secondary.plan(request, contract, options);
        return { ...result, meta: { ...result.meta, fellBack: (error as Error).message } };
      }
    },
  };
}

/** Reads sources through the worker's official API connector, with the person's key. */
export function workerFetch(adapter: string, mode: () => 'test' | 'live'): Fetch {
  return async (request) => {
    const { signal: _signal, ...rest } = request;
    const reply = (await chrome.runtime.sendMessage({
      kind: 'fetch',
      adapter,
      mode: mode(),
      request: rest,
    })) as { ok: true; value: FetchResult } | { ok: false; problem: string } | undefined;
    if (!reply) throw new Error('The extension is unavailable');
    if (!reply.ok) throw new Error(reply.problem);
    return reply.value;
  };
}
