import { describe, expect, it } from 'vitest';
import { editor } from '../../packages/core/src/__fixtures__/editor.js';
import {
  createUitive,
  DEFAULT_STABILISER,
  simulate,
  type Persona,
  type SessionReport,
} from '@plurid/uitive-core';

// Persona evaluation with the deterministic planner: the properties every planner must keep.

const writer: Persona = {
  name: 'writer',
  description: 'Writes long reports: headings, quotes and links, never code',
  weights: { heading: 6, quote: 5, link: 5, bold: 3, 'export-pdf': 2, save: 1 },
};

/** Uses more toolbar items than fit: they must compete without churning. */
const crowded: Persona = {
  name: 'crowded',
  description: 'Uses seven toolbar items about equally',
  weights: { heading: 3, quote: 3, link: 3, bold: 3, italic: 3, 'export-pdf': 3, code: 3 },
};

const analyst: Persona = {
  name: 'analyst',
  description: 'Builds tables and exports them',
  weights: { table: 6, 'export-csv': 4, code: 3, bold: 2, image: 2 },
  shift: { session: 6, weights: { comment: 6, link: 4, quote: 3, bold: 1 } },
};

async function run(persona: Persona, seed = 1, sessions = 12): Promise<SessionReport[]> {
  let time = 0;
  const client = createUitive({ contract: editor, now: () => (time += 1000) });
  return simulate(client, persona, { sessions, seed });
}

/** Items that entered the toolbar at each session, compared with the session before. */
function changes(reports: SessionReport[]) {
  return reports.map((report, index) => {
    const before = new Set(reports[index - 1]?.visible.toolbar ?? report.visible.toolbar);
    const after = new Set(report.visible.toolbar);
    return {
      session: index,
      entered: [...after].filter((item) => !before.has(item)),
      left: [...before].filter((item) => !after.has(item)),
    };
  });
}

describe('persona evaluation (heuristic planner)', () => {
  it('never hides required items', async () => {
    for (const persona of [writer, analyst]) {
      for (const report of await run(persona)) {
        expect(report.visible.toolbar).toContain('share');
        expect(report.visible.file).toContain('save');
      }
    }
  });

  it('applies no more structural changes per session than the budget', async () => {
    for (const persona of [writer, analyst]) {
      for (const report of await run(persona)) {
        expect(report.applied?.applied.length ?? 0).toBeLessThanOrEqual(DEFAULT_STABILISER.budget);
      }
    }
  });

  it('brings each persona’s most used items onto the toolbar by the fourth session', async () => {
    const reports = await run(writer);
    expect(reports[3]?.visible.toolbar).toEqual(
      expect.arrayContaining(['heading', 'quote', 'link']),
    );
  });

  it('never oscillates: an item that moves stays put for the dwell time', async () => {
    for (const persona of [writer, analyst, crowded]) {
      const moves = changes(await run(persona, 3, 16));
      for (const move of moves) {
        for (const item of move.entered) {
          const leaves = moves.find(
            (later) => later.session > move.session && later.left.includes(item),
          );
          if (leaves)
            expect(leaves.session - move.session).toBeGreaterThanOrEqual(DEFAULT_STABILISER.dwell);
        }
      }
    }
  });

  it('adapts after a change of behaviour', async () => {
    const reports = await run(analyst, 2, 14);
    expect(reports[5]?.visible.toolbar).toEqual(expect.arrayContaining(['table', 'code']));
    expect(reports[11]?.visible.toolbar).toEqual(
      expect.arrayContaining(['comment', 'link', 'quote']),
    );
  });

  it('converges: a stable persona whose items fit stops changing the interface', async () => {
    for (const seed of [5, 6, 7]) {
      const moves = changes(await run(writer, seed, 14));
      expect(moves.slice(-6).every((move) => move.entered.length === 0)).toBe(true);
    }
  });

  it('keeps churn low when items compete for too few places', async () => {
    for (const seed of [1, 2, 3]) {
      const moves = changes(await run(crowded, seed, 16));
      const total = moves.slice(4).reduce((sum, move) => sum + move.entered.length, 0);
      expect(total).toBeLessThanOrEqual(3);
    }
  });

  it('repeats exactly for the same seed', async () => {
    const strip = (reports: SessionReport[]) => reports.map((report) => report.visible);
    expect(strip(await run(analyst, 9))).toEqual(strip(await run(analyst, 9)));
  });
});
