# ADR 0004: Pages as flat elements, with regions

- Status: accepted
- Date: 2026-10-03

## Context

Pages were sections of blocks, two levels deep, because structured outputs can't describe recursive schemas. That fixed every page to one shape, and integrating an existing application meant rewriting its pages in that shape before anything could adapt. Structured outputs also need `additionalProperties: false` on every object, so a page can't be a map of elements keyed by ID either.

## Decision

A page is a flat list of **elements**, each with an ID, a block, its props and the IDs of its children, plus a root ID and a list of **named queries** that blocks can share. Nesting goes as deep as the page allows (four levels by default) with a schema that never recurses. Policy checks that the elements form one tree: unique IDs, a root nothing holds, one parent each, everything reachable, within the depth and size limits.

Every page has three built-in blocks: `section` (a title and a layout) and `tabs` (one section at a time) arrange other elements, and `region` embeds part of the application as it already is. Regions are declared on the contract, optionally about one source's rows, and a page about that source (its **entity**) may embed them. A standard page can be a single region: the existing page, untouched. Integration never has to rewrite a page; a redesign adds blocks around a region or replaces it.

The first format still works. Standard pages and `setPage` accept sections of blocks, which convert mechanically to a root section holding one section per section, and stored definitions migrate on load (`schemaVersion` 2). Standard pages are validated when the contract is defined, for every context value, so a broken one fails at startup rather than in front of a user. The planner schema holds one inline union over every block, however many there are.

## Consequences

Pages can take any shape the user asks for, and an application can adopt Aptuitive page by page, starting from regions. Element IDs are free text the model writes, so they are checked for shape only. Renderers draw a tree instead of two fixed levels; converted pages keep the markup they had, so existing styles still apply.
