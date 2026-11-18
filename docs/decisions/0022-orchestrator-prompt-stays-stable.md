# 0022: Orchestrator prompts stay stable; changing context rides with the turn

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-18 |
| Decided by | Ben (picked the usage savings in the "Cut usage in project thread handoffs" thread) |

## Context

Claude Code caches the prompt prefix: system prompt, tools, then the conversation. Anything in the system prompt that changes between turns makes the whole conversation be written to the cache again on the next turn. Project memory sat in the system prompt of every thread of a project, so one thread saving memory made every other thread rebuild its cache. See [usage savings PRD](../prd/usage-savings.md).

## Decision

With usage savings on (the default), an orchestrator's system prompt holds only what rarely changes: its role, repos, add-ons and rules. Context that changes between turns, such as project memory, is sent ahead of the turn's message only when the session doesn't already have that version (tracked per chat as a hash), and again after a compaction.

## Consequences

- Saving memory no longer costs a cache rebuild in every thread.
- New per-turn context for orchestrators should follow the same pattern (`turnPrefix` from `queryOptions`), not go into the system prompt.
- A session that compacts mid-turn has no memory for the rest of that turn; the next turn sends it again.

## Alternatives considered

- **Keep memory in the system prompt, cache it separately**: Claude Code controls cache breakpoints; Choo Choo can't put one after the system prompt.
- **Tell threads to read the memory file with a tool**: costs a tool call each turn and the thread may skip it.
