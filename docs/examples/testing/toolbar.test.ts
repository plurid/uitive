import { createAptuitive, memoryStore, simulate, type Persona } from '@plurid/aptuitive-core';
import { describe, expect, it } from 'vitest';
import { contract } from '../quick-start/contract.js';

// #region setup
// A clock that only moves when told to, and state that starts empty every time.
const fresh = () => createAptuitive({ contract, now: () => 0, store: memoryStore() });
const visible = (client: ReturnType<typeof fresh>) =>
  client.surface('toolbar').visible.map((item) => item.id);
// #endregion

describe('the notes toolbar', () => {
  // #region unchanged
  it('is the standard toolbar for someone who changes nothing', () => {
    const client = fresh();
    expect(client.surface('toolbar')).toEqual(client.standard('toolbar'));
  });
  // #endregion

  // #region commands
  it('answers plain commands without a model, and reverts them', async () => {
    const client = fresh();
    const hidden = await client.ask('hide Bold');
    expect(hidden.status).toBe('done');
    expect(visible(client)).not.toContain('bold');
    client.revertAdaptation(hidden.id);
    expect(visible(client)).toContain('bold');
  });
  // #endregion

  // #region learning
  it('brings what someone keeps reaching for in More onto the toolbar, at a safe moment', async () => {
    const client = fresh();
    for (let session = 0; session < 3; session++) {
      client.record('table', { via: 'overflow', surface: 'toolbar' });
      client.record('table', { via: 'overflow', surface: 'toolbar' });
      client.nextSession();
    }
    await client.plan();
    // Planned changes wait for the next session, so nothing moves while someone works.
    expect(visible(client)).not.toContain('table');
    client.nextSession();
    expect(visible(client)).toContain('table');
  });
  // #endregion

  // #region personas
  it('serves a writer who quotes and links, over weeks of use', async () => {
    const writer: Persona = {
      name: 'Writer',
      description: 'Quotes sources and links them',
      weights: { quote: 6, link: 4, bold: 1 },
    };
    const reports = await simulate(fresh(), writer, { sessions: 8, seed: 7 });
    expect(reports.at(-1)?.visible.toolbar).toContain('quote');
  });
  // #endregion
});
