# ADR 0016: Adapters for real sites are the product

- Status: accepted
- Date: 2026-10-10
- Amends ADR 0006: its last consequence, that the extension's first target stays a private prototype until legal advice says otherwise, no longer holds; its decisions stand.

## Context

ADR 0006 gave the engine two front doors and shipped the extension's first adapter, for a real payments dashboard, inside this repository, as a prototype whose fate waited on others. Uitive is open source and a product. The engine is what anyone should be able to read, run and build on. An adapter for a real site is different work: anchors checked against the live page, a curation of the site's API, and repairs every time the site ships a redesign. That upkeep is what the product offers, and keeping an adapter for one company's product in a public repository gives it away while the company may be a customer of the first front door.

## Decision

The owners decide what ships, and they decided:

- This repository ships the engine: the extension's service worker, content script, side panel and build, the adapter format (`@plurid/uitive-adapter`), the tools that discover and generate adapters, and an adapter for Acme Payments, a fictional dashboard in `tools/fixtures/payments-dashboard`, which the extension's tests run against.
- Adapters for real sites are maintained in Uitive's private repository and ship in its own builds of the extension, built from this repository's code with `--adapters`.
- Anyone can write and build adapters of their own the same way, from any folder.

## Consequences

The public extension builds, tests and demonstrates itself without any real site. The build takes adapter folders, so a product, or anyone, ships exactly the adapters it chooses, and the generic code holds no site's conventions (ADR 0017). The demo is its own fictional product, with its own sidebar, keys and look, so it shows the format works beyond one site. The adapters that were once public stay in this repository's history.
