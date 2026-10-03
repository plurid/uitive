# ADR 0003: Actions that run, with the user's yes

- Status: accepted
- Date: 2026-10-03

## Context

Actions were names on buttons: generated pages could place them, but pressing one needed glue the application wrote by hand, and every activation had to be recorded with an explicit `record()` call. Pages that show data need to act on it ("refund this payment"), and an interface the model helped design must never change data behind the user's back.

## Decision

An action may declare `params` (a flat zod object, like a source's row), an `effect` (`read`, `write` or `destructive`), a confirmation phrase, the rows it applies to (`when`) and the sources it changes (`invalidates`). A `ref` param makes it a row action, filled from the row it is pressed on. Actions without an effect stay interface-only, as before.

A runtime `perform` binding runs actions. `client.perform` parses params against the schema, then, for runs from interfaces Aptuitive drew, waits for the user: a write needs one explicit step that shows its params (a submitted form counts), and a destructive run needs its phrase typed. The waiting run is client state that any mounted interface can answer; with none mounted, the run is refused rather than silently allowed. Writes are refused while a suggested redesign is being previewed. The application's own controls (`origin: 'native'`) confirm in their own way.

Every confirmed run is recorded as usage, never with its params; cancelled and failed runs record nothing. A run's `invalidates` marks cached results stale, and its outcome may name where to go next.

## Consequences

Generated pages can act, safely, without per-action glue, and instrumentation comes for free wherever the application routes its buttons through `perform`. Planners still never run anything: they place actions, and policy keeps destructive ones and prefilled writes out of plans the user did not ask for. Applications must mount an interface that can confirm before generated pages can write.
