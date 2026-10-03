/** Requests a second, and at once: the API's limits are shared with the account's own systems. */
export function bucket(perSecond: number, concurrent: number) {
  let tokens = perSecond;
  let refilled = Date.now();
  let running = 0;
  const waiting: (() => void)[] = [];
  const pump = () => {
    const now = Date.now();
    tokens = Math.min(perSecond, tokens + ((now - refilled) / 1000) * perSecond);
    refilled = now;
    while (waiting.length > 0 && tokens >= 1 && running < concurrent) {
      tokens -= 1;
      running += 1;
      waiting.shift()?.();
    }
    if (waiting.length > 0) setTimeout(pump, Math.ceil(1000 / perSecond));
  };
  return async <T>(work: () => Promise<T>): Promise<T> => {
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      pump();
    });
    try {
      return await work();
    } finally {
      running -= 1;
      pump();
    }
  };
}

const month = () => new Date().toISOString().slice(0, 7);

/** Reads and tokens this month, kept locally: what the person's keys have been spent on. */
export async function meter(kind: 'reads' | 'tokens', add = 0): Promise<number> {
  const key = `meter:${kind}:${month()}`;
  const found = ((await chrome.storage.local.get(key))[key] as number | undefined) ?? 0;
  if (add === 0) return found;
  await chrome.storage.local.set({ [key]: found + add });
  return found + add;
}

export const READ_BUDGET = 2_000;
