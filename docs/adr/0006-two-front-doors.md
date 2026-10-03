# ADR 0006: One engine, two front doors

- Status: accepted
- Date: 2026-10-03

## Context

Aptuitive began as an SDK that applications integrate: they declare a contract and bind it to their code. People also want to reshape interfaces they don't own, starting with a payments dashboard, and a browser extension can do that with the same engine. Two assumptions of the first design don't hold there: the application's code isn't available to declare a contract, and "API keys never reach client code; the planner runs only on the server" assumed the vendor pays for planning.

## Decision

There is one engine and two front doors. First-party applications declare contracts and bind them to their API client, router and design system. The extension loads **adapters**: JSON contracts (ADR 0002 to 0004) plus bindings to a third-party page (anchors, routes, endpoints the page already calls, and official API connectors), bundled as data.

The planner is its own package (`@plurid/aptuitive-planner`), free of Node and DOM APIs, so it runs on a server and in an extension's service worker alike. **Whoever pays holds the key**: in applications, the vendor's key stays on its server and never reaches client code; in the extension, the user's own key stays in the extension's storage and only its service worker calls the API.

No planner ever receives a third-party page's text. The extension sends what any request carries (the adapter contract, usage, definitions and the person's words) plus `PlanRequest.environment`, a structural summary: which anchors and sources it found, and counts of what it couldn't map. Model output stays declarative and is drawn by bundled components, so no generated code runs.

## Consequences

The extension stays within store rules on remote code, and text on a third-party page has no path into the model, so prompt injection through page content has nothing to work with. Vendors and users get the same guarantees from the same policy, stabiliser and definitions. Adapters break when sites change, so they need anchors with fallbacks, failure reports and repair. Terms of service vary by site; the extension's first target stays a private prototype until legal advice says otherwise.
