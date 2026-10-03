# ADR 0007: The agent kit: generated, curated, checked

- Status: accepted
- Date: 2026-10-03

## Context

Integration should take hours, with coding agents doing most of the work. Agents work well on steps they can check and badly on open-ended ones, and a large API (Stripe's description runs to 8 MB, with over 600 operations) is more than a planner should see. Generic code generators keep every union and nesting level, which the flat schemas of ADR 0002 can't use.

## Decision

Integration is a sequence of steps, each with a check: `detect`, `init`, `survey`, curation, `generate sources`, `generate blocks`, `discover` and `check`. The same steps ship as a CLI (`@plurid/aptuitive-cli`), as tools over the Model Context Protocol (`@plurid/aptuitive-mcp`) and as a Claude Code plugin whose skill holds the playbook.

- **Every page starts as a region**, so the application works unchanged from the first minute; integration adds, it never rewrites.
- **Sources and actions come from the API description** through our own mapper: list endpoints become sources with their filters, paging and item endpoints as capabilities; writes become actions. Choices live in `aptuitive/curation.json`, keyed by the generated IDs, and survive regeneration. The generated file is never edited.
- **Effects err on the safe side.** DELETE, and writes whose names say they move money or can't be undone (refund, capture, pay, cancel and the like), are destructive. A curation may lower an effect only with a stated reason.
- **Endpoints are data.** `restFetch` and `restPerform` turn the generated endpoints into bindings that call the API with the person's own session, never a stored key.
- **`check` is the gate**: the contract validates, its JSON round-trips, every request schema fits structured outputs (no optional fields, one union, at most 60 KB, enums of at most 400 values), labels are distinct and find what they name, and bindings exist.
- **Discovery reads structure, never rows.** It crawls the running application's accessibility tree, following links without pressing anything. The inference lives in `@plurid/aptuitive-adapter`, which the browser extension shares.
- **The MCP server stays in the project**: no tool reads or writes outside its root, API descriptions come from files, and discovery crawls local hosts, unless the network is allowed.

## Consequences

An agent can integrate an application by running steps until `check` passes, and the same contract serves the planner, the JSON format and the extension. Heuristics guess (a sort order, a reference, an effect); guesses are labelled in the survey's notes and corrected in the curation, and a wrong guess about effects asks for more confirmation, not less. APIs without a description need sources declared by hand, and the timed integrations will show how far the heuristics carry.
