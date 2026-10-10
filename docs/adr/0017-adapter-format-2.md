# ADR 0017: Adapter format 2: a site's modes and keys are data

- Status: accepted
- Date: 2026-10-10
- Refines ADR 0006's adapters; its decisions stand.

## Context

The first adapter format described anchors, routes, lists, regions, pages and connectors, but the extension's code assumed one site's conventions. Keys went in a `Bearer` header. Secret keys were recognized by one prefix and refused. Keys were "restricted keys", with that site's prefixes as placeholders. Every site was assumed to have a test mode and a live mode, and the page's mode came from the first connector's test-mode pattern, so an adapter with two connectors, or none, got the wrong mode. An adapter for another site couldn't say how that site works.

## Decision

Format 2 (`formatVersion: 2`) moves those conventions into the adapter:

- `testMode`, on the adapter: a path pattern that marks test data. Without one, the site has a single mode and its keys are live keys.
- `auth`, on each connector: the header that carries the key and what precedes it, `authorization` and `Bearer ` by default. Headers browsers don't let pages set are refused when the adapter is checked, and keys never go in URLs.
- `keys`, on each connector: the pattern a live key must fit, the pattern a test key must fit when the adapter has a test mode (and only then), keys refused whatever the mode with the reason shown, what the key is called (`API key` by default) and its placeholder by mode.
- `examples`, on the adapter: up to three requests the side panel suggests.

Checks compile every pattern, refuse forbidden headers and test keys without a test mode, and require test keys with one. The extension reads all of it from the adapter: no site's conventions remain in its code.

## Consequences

Adapters for sites with one mode, custom key headers or their own refusal rules work without changes to the extension. Adapters are compiled into each build, so no format-1 adapter needs to keep loading: the version bump is breaking for `@plurid/uitive-adapter`'s published types, not for anyone's stored data. A test mode is still marked by a path prefix only; a site that marks it otherwise needs another field when one exists.
