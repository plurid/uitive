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

/** At most `limit` calls in any minute; answers whether this one may go ahead. */
export function rate(limit: number, window = 60_000) {
  let times: number[] = [];
  return (): boolean => {
    const now = Date.now();
    times = times.filter((time) => now - time < window);
    if (times.length >= limit) return false;
    times.push(now);
    return true;
  };
}

const month = () => new Date().toISOString().slice(0, 7);

// Storage has no transactions: two reads, then two writes, would count one.
let queue: Promise<unknown> = Promise.resolve();
function serially<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.catch(() => undefined);
  return next;
}

type Kind = 'reads' | 'tokens';
const meterKey = (kind: Kind) => `meter:${kind}:${month()}`;
const read = async (key: string) =>
  ((await chrome.storage.local.get(key))[key] as number | undefined) ?? 0;

/** Reads and tokens this month, kept locally: what the person's keys have been spent on. */
export function meter(kind: Kind, add = 0): Promise<number> {
  return serially(async () => {
    const key = meterKey(kind);
    const found = await read(key);
    if (add === 0) return found;
    await chrome.storage.local.set({ [key]: found + add });
    return found + add;
  });
}

/** Spends from this month's budget if enough is left: false, and nothing spent, when not. */
export function spend(kind: Kind, budget: number, amount = 1): Promise<boolean> {
  return serially(async () => {
    const key = meterKey(kind);
    const found = await read(key);
    if (found + amount > budget) return false;
    await chrome.storage.local.set({ [key]: found + amount });
    return true;
  });
}

/** API reads a month. */
export const READ_BUDGET = 2_000;
/** Model tokens a month, read and written. */
export const TOKEN_BUDGET = 5_000_000;
/** Requests to a model in any minute. */
export const PLANS_PER_MINUTE = 10;
