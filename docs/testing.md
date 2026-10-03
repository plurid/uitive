# Testing

Aptuitive is deterministic when you need it to be: a clock that moves only when told, state held in memory, sessions on demand and a planner without a model. Adaptation can be tested like the rest of an application, in any test runner. The examples here use Vitest, and they run with this repository's tests.

## Set up

Give each test a fresh client, with a fixed clock and a memory store:

<!-- example: docs/examples/testing/toolbar.test.ts#setup -->

```ts
// A clock that only moves when told to, and state that starts empty every time.
const fresh = () => createAptuitive({ contract, now: () => 0, store: memoryStore() });
const visible = (client: ReturnType<typeof fresh>) =>
  client.surface('toolbar').visible.map((item) => item.id);
```

- `now` is the clock. A fixed one means sessions end only when the test says so.
- `memoryStore()` starts empty, and every load from it is an independent copy, as a page reload would be. Share one store between two clients to test what survives a reload.
- Without a `planner`, the client plans with the deterministic planner: no network, no key and the same answer every time.

## Nothing changes for someone who changes nothing

The first test every integration needs: until a person uses the application or asks for something, their interface is the application as it ships.

<!-- example: docs/examples/testing/toolbar.test.ts#unchanged -->

```ts
it('is the standard toolbar for someone who changes nothing', () => {
  const client = fresh();
  expect(client.surface('toolbar')).toEqual(client.standard('toolbar'));
});
```

## Commands

`ask` answers plain commands with the deterministic planner, at once:

<!-- example: docs/examples/testing/toolbar.test.ts#commands -->

```ts
it('answers plain commands without a model, and reverts them', async () => {
  const client = fresh();
  const hidden = await client.ask('hide Bold');
  expect(hidden.status).toBe('done');
  expect(visible(client)).not.toContain('bold');
  client.revertAdaptation(hidden.id);
  expect(visible(client)).toContain('bold');
});
```

The result is an adaptation: its `status`, the operations it `applied` and those `rejected`, with reasons. `revertAdaptation` undoes all of it, as the banner's Revert does.

## Learning, session by session

Learning takes sessions, and tests make them on demand:

<!-- example: docs/examples/testing/toolbar.test.ts#learning -->

```ts
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
```

- `record` is one use of an action, with how it was reached.
- `nextSession()` ends the session now, as if the person came back later: a safe moment, when pending changes apply.
- In a test, nothing plans by itself. Call `plan()`, or `learn()` as the provider does once a session.
- To see why a change applied, `client.explain(id)` gives the title and reason the person reads, with true numbers.

## Personas

A persona is a simulated person: how often they use each action, and how they reach what isn't in view. `simulate` drives a client through sessions as that person would, with a seeded random source, so a run is the same every time:

<!-- example: docs/examples/testing/toolbar.test.ts#personas -->

```ts
it('serves a writer who quotes and links, over weeks of use', async () => {
  const writer: Persona = {
    name: 'Writer',
    description: 'Quotes sources and links them',
    weights: { quote: 6, link: 4, bold: 1 },
  };
  const reports = await simulate(fresh(), writer, { sessions: 8, seed: 7 });
  expect(reports.at(-1)?.visible.toolbar).toContain('quote');
});
```

Each session starts at a safe moment, the persona works through 12 to 24 actions, and a plan follows; `plan: false` leaves planning out. Each report holds the session's visible lists and what applied or was planned. A persona's `shift` changes its habits from a given session on, to test that the interface follows; `palette` is how often it searches for an action instead of opening More.

`<apt-debug>` runs the same simulation in a browser, with its "Simulate a week" buttons: see [Without React](without-react.md#the-elements).

## Components

Test components as usual, such as with Testing Library: render them inside `AptuitiveProvider` with a fresh client. The provider plans once when it mounts, so render inside an async `act`, or await what the test expects. A page's generic blocks read through the bindings: give the client `fromRows` bindings, or a stubbed `fetch`, so tests never reach a real API.

## In CI

- `aptuitive check` exits with 1 when the contract or the bindings fail a check: run it with the other checks.
- `aptuitive generate blocks --check` exits with 1 when generated block specs no longer match their components.
- A model planner never runs in tests: leave `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` and `GOOGLE_API_KEY` empty in the test environment, and test the server's handler with the deterministic planner, as `docs/examples/server/handler.ts` does when there is no key.
