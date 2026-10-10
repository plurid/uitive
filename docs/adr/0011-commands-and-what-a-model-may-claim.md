# ADR 0011: Commands apply at once; a model never speaks for the person's pages

- Status: accepted
- Date: 2026-10-09
- Refines ADR 0001's policy and the user layer; ADR 0001's decision stands.

## Context

A command applies at once, and what a model's answer marks as named outright joins the user layer, which outranks the model layer. Only the model's word said the person had named it. A model reading "make the home page calmer" could answer with the deletion of a page the person made, or with a change the person had reverted twice and so blocked, and both applied as the person's own. Invariant 5 read as if every structural operation waited for a safe moment, while commands, and the goals stated in them, had always applied at once: that is how "I watch costs and budgets" reshapes a console in one step.

## Decision

Commands, and the goals stated in them, apply at once; planned changes alone wait for safe moments, the budget, dwell and agreement between plans. What a model reads as named outright joins the user layer, within what policy holds for everyone: required items, contract IDs, schemas and caps. Two things a model's answer never does, whatever it claims: delete a page the person made, and bring back a change the person blocked. The person deletes their pages themselves, from "Your interface"; a deletion matched deterministically from their own words still applies. A plan from use can't claim that anything was asked for at all: the planner drops that claim on plan requests.

## Consequences

The person's own pages and their twice-reverted changes are out of a model's reach, so a model that misreads a request can only make changes the person can revert. Asking a model to delete a page answers with where to do it instead. Invariant 5 now says it governs planned changes, and that commands and stated goals apply at once.
