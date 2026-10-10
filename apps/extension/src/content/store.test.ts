import { createUitive, heuristicPlanner } from '@plurid/uitive-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contract } from '../../adapters/acme-payments.ts';
import { fakeChrome } from '../__fixtures__/chrome.ts';
import { chromeStore } from './store.ts';

const KEY = 'definition:acme-payments';
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
let fake: ReturnType<typeof fakeChrome>;

beforeEach(() => {
  fake = fakeChrome();
  vi.stubGlobal('chrome', fake.chrome);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the extension store', () => {
  it('knows every write of its own still on its way, not only the last', async () => {
    const store = await chromeStore('definition:x');
    const heard = vi.fn();
    store.watch?.(heard);
    store.save({ step: 'A', order: { b: 1, a: 2 } });
    store.save({ step: 'B', order: { b: 1, a: 2 } });
    store.save({ step: 'C', order: { b: 1, a: 2 } });
    await settle();
    expect(heard).not.toHaveBeenCalled();
    expect(store.load()).toEqual({ step: 'C', order: { b: 1, a: 2 } });
  });

  it("adopts another tab's change, and not its own echoes around it", async () => {
    const mine = await chromeStore('definition:x');
    const theirs = await chromeStore('definition:x');
    const heard = vi.fn();
    mine.watch?.(heard);
    mine.save({ step: 'A' });
    await settle();
    theirs.save({ step: 'theirs' });
    await settle();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(mine.load()).toEqual({ step: 'theirs' });
  });

  it('writes nothing it already holds, so no echo is left waiting for', async () => {
    const mine = await chromeStore('definition:x');
    const theirs = await chromeStore('definition:x');
    mine.save({ step: 'A' });
    await settle();
    mine.save({ step: 'A' });
    theirs.save({ step: 'B' });
    await settle();
    theirs.save({ step: 'A' });
    await settle();
    // Another tab's write of a value this one wrote before is still news.
    expect(mine.load()).toEqual({ step: 'A' });
    theirs.save({ step: 'C' });
    await settle();
    expect(mine.load()).toEqual({ step: 'C' });
  });

  it('forgets a write that failed', async () => {
    const mine = await chromeStore('definition:x');
    const theirs = await chromeStore('definition:x');
    fake.chrome.storage.local.failNext = true;
    mine.save({ step: 'lost' });
    await settle();
    theirs.save({ step: 'lost' });
    await settle();
    expect(mine.load()).toEqual({ step: 'lost' });
    const heard = vi.fn();
    mine.watch?.(heard);
    theirs.save({ step: 'next' });
    await settle();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('hears a clear from elsewhere, such as Forget', async () => {
    const store = await chromeStore('definition:x');
    store.save({ step: 'A' });
    await settle();
    await chrome.storage.local.clear();
    await settle();
    expect(store.load()).toBeUndefined();
  });

  it("keeps every use and change a client makes in quick succession, as a person's do", async () => {
    const store = await chromeStore(KEY);
    const adopted = vi.fn();
    store.watch?.(adopted);
    const client = createUitive({ contract, store, planner: heuristicPlanner() });
    client.resume();
    await client.learn();
    client.record('nav.invoices', { via: 'region', surface: 'sidebar' });
    await Promise.resolve();
    client.record('nav.partners', { via: 'region', surface: 'sidebar' });
    const asked = await client.ask('hide Reports');
    client.record('nav.home', { via: 'region', surface: 'sidebar' });
    await settle();
    expect(adopted).not.toHaveBeenCalled();
    const stored = fake.chrome.storage.local.data.get(KEY) as {
      events: { action: string }[];
      definition: { operations: unknown[] };
    };
    expect(stored.events.map((event) => event.action)).toEqual(
      expect.arrayContaining(['nav.invoices', 'nav.partners', 'nav.home']),
    );
    expect(asked.applied).toHaveLength(1);
    expect(stored.definition.operations).toHaveLength(
      client.getSnapshot().definition.operations.length,
    );
  });
});
