# PRD: <feature name>

| | |
|---|---|
| Status | Draft · In progress · In review (PR #) · Shipped (PR #) |
| Owner | <who drives it> |
| Requested by | <who asked, and when> |
| Last updated | YYYY-MM-DD |

## Problem

What's hard or impossible today, and for whom. One or two paragraphs. Quote the request if it came from a person.

## Goals

- What success looks like, in user terms.

## Non-goals

- What this deliberately does not do, so reviewers don't ask for it.

## User experience

How a person finds and uses it: where it lives in the UI, the main flow step by step, defaults, empty and error states. Screenshots or sketches welcome (put images in `docs/media/`).

## Requirements

Numbered so PRs and reviews can point at them.

1. …
2. …

## Design

How it works: modules touched, data model and storage, IPC added to `Api`, what runs where. Link code paths.

## Compliance, privacy and security

- Does it touch Claude access? It must use the official Agent SDK and Claude Code binary with the user's own sign-in ([decision 0001](../decisions/0001-official-claude-access-only.md)).
- Does it sign in to a third-party service? Use OAuth ([decision 0003](../decisions/0003-oauth-for-integrations.md)).
- What data leaves the machine, where to, and who can see it?
- Secrets: how are they stored and kept out of logs, shares and transcripts?

## Testing

Unit tests in `test/`, manual checks in `npm run dev`, what CI covers.

## Rollout

Default on or off? Settings toggle? Migration for existing saves (`normalize*` in `store.load()`)?

## Open questions

- …

## Future work

- …
