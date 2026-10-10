import { describe, expect, it } from 'vitest';
import { editor } from './__fixtures__/editor.js';
import { emptyEditor } from './__fixtures__/usage.js';
import { summarize, type SessionRecord, type UsageEvent } from './usage.js';

const sessions = (count: number): SessionRecord[] =>
  Array.from({ length: count }, (_, index) => ({ index, startedAt: 0, contexts: {} }));

const row = (events: UsageEvent[], surface: string, action: string, from?: number) =>
  summarize(editor, emptyEditor(), events, sessions(6), 5, from).rows.find(
    (entry) => entry.surface === surface && entry.action === action,
  );

describe('summarize', () => {
  it('counts use reached on a surface there alone, and use from nowhere everywhere', () => {
    const fromFile: UsageEvent[] = [
      { action: 'print', via: 'overflow', session: 4, surface: 'file' },
      { action: 'print', via: 'overflow', session: 5, surface: 'FILE' },
    ];
    expect(row(fromFile, 'file', 'print')?.viaOverflow).toBe(2);
    expect(row(fromFile, 'toolbar', 'print')).toBeUndefined();

    const anywhere: UsageEvent[] = [{ action: 'print', via: 'overflow', session: 5 }];
    expect(row(anywhere, 'file', 'print')?.uses).toBe(1);
    expect(row(anywhere, 'toolbar', 'print')?.uses).toBe(1);

    // A surface the contract doesn't declare says nothing about where use belongs.
    const elsewhere: UsageEvent[] = [{ action: 'print', via: 'overflow', session: 5, surface: '' }];
    expect(row(elsewhere, 'toolbar', 'print')?.uses).toBe(1);
  });

  it('keeps its window to sessions whose use is all kept', () => {
    const events: UsageEvent[] = [
      { action: 'table', via: 'overflow', session: 3 },
      { action: 'table', via: 'overflow', session: 5 },
    ];
    expect(summarize(editor, emptyEditor(), events, sessions(6), 5).window).toBe(6);
    const partial = summarize(editor, emptyEditor(), events, sessions(6), 5, 4);
    expect(partial.window).toBe(2);
    expect(partial.rows.find((entry) => entry.action === 'table')?.uses).toBe(1);
  });
});
