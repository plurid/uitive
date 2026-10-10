# ADR 0012: The planner's handler guards the spend

- Status: accepted
- Date: 2026-10-09
- Extends ADR 0006: whoever pays holds the key, and the handler is where that key is spent.

## Context

The handler plans on the vendor's key, so every request it answers costs the vendor money. By default it let in requests whose URL named a local host, which the client controls through the `Host` header, so a deployed handler that kept the default planned for anyone. The documented production check accepted any cookie with the right name. The Node adapter built its URL from `Host` and let exceptions escape, so one malformed request could stop a server. Rate limits were keyed on a header the client writes, request bodies were checked only at the surface, and provider error bodies, with internal host names, reached the browser.

## Decision

The handler trusts nothing the client writes:

- `authorize` is required and has no default. `init`'s template allows requests only outside production, with a comment saying to replace it with the application's own session check, so a deployed handler refuses everyone until that check exists.
- The `Host` header decides nothing, and the Node adapter answers every request, with 400 or 500 when it must, and never rejects.
- Only same-site JSON is planned: other content types get 415, and `Sec-Fetch-Site: cross-site` gets 403.
- Every request is checked against a schema of the plan request, with strings and arrays capped, and the body is measured in bytes as it is read.
- Rate limits are keyed by a `client(request)` the application can define, by default the right-most `X-Forwarded-For` entry, and expired windows are swept.
- The browser gets a fixed message per status; details go to `onError` only.

## Consequences

Integrations must write an `authorize`, which is a breaking change for anyone who relied on the default. A handler behind a proxy that rewrites `X-Forwarded-For` differently defines `client`. Cross-site embeds of the planner need a same-site proxy. Errors in the browser say less, and the server's logs say all of it.
