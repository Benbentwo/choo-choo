# PRD: Save usage in project threads, and models by role

| | |
|---|---|
| Status | In review |
| Owner | Ben |
| Requested by | Ben, 2026-11-18 |
| Last updated | 2026-11-18 |

## Problem

> I often hit the 5-hour limits. I assume this is because I use a lot of project threads, which then create many workspaces. Are there optimizations we could make to the handoff between them, without sacrificing output quality?

Each project thread is a long-lived Opus chat that starts workspaces, waits on them and reads what they did. Several things made those handoffs use more of the plan than the work needed:

- `read_workspace` returned the last 40 transcript entries (up to 4,000 characters per reply). That stayed in the thread's context, so every later turn of the thread paid for it again.
- A thread was woken once per finished workspace (up to 8 times per message from the person), and each wake is a full turn over the whole thread. Long gaps between wakes can outlive the prompt cache, so the whole thread is written to the cache again.
- Project memory sat in the system prompt of every thread. When one thread saved memory, every other thread's prompt changed, so each rebuilt its prompt cache on its next turn.
- The project chat, which only decides which thread gets a message, ran on the default model (Opus, high effort), and there was no way to set a different model for project chats, threads or their workspaces.

## Goals

- Use noticeably less of the plan in project threads and orchestrators with no loss in the quality of the work the workspaces do.
- Show where project work spends usage, so the savings can be checked on real data.
- One switch, on by default.
- Choose the model and thinking level for project chats, threads and the workspaces they start: defaults in Settings, overridable per project, and per chat as before (Ben, 2026-11-18).

## Non-goals

- Changing the model or effort of workspaces. They do the work; they keep the person's model.
- Changing how threads write tasks for workspaces.

## User experience

Settings › General › **Save usage in project threads** (on by default). With it on:

1. A workspace a thread or orchestrator starts gets a line at the end of its task asking it to finish with a short handoff report: status, what changed and the PR link, tests run, anything left.
2. `read_workspace` returns the status, changed files and that last reply. The thread passes `last` to also read transcript entries when the report isn't enough.
3. A thread gets one automatic update when all the workspaces it is waiting on have finished, not one per workspace. An error goes out right away, and no update waits more than 20 minutes for the rest of its batch. Workspaces waiting on a tool approval don't hold the batch. Threads are told to end their turn after starting work instead of waiting in it.
4. Project memory is sent with a turn, in a `<project-memory>` block ahead of the message, only when the session is new, when the memory changed since the session last got it, or after Claude Code compacted the conversation. It is not shown in the chat.

### Models by role

Settings › General › **Models in projects** (shown with Projects on) sets the model and thinking level for three roles. Each choice can be left on Default, which uses Default model and Default effort.

| Role | Out of the box |
|---|---|
| Project chat (routes each message to a thread) | Sonnet, Low |
| Threads | Default |
| Workspaces threads start | Default |

Edit project has the same three pickers; empty ones use Settings. A new chat starts on its role's pick. A thread can still name a model for one task in `start_workspace`, and every chat's model menu changes that chat. Changing a default doesn't change chats that already exist, except that a project chat made before this setting gets its role's pick once, on its next turn.

The Usage page gets a **Project work** card when there was orchestrated work in range: the share used by project and orchestrator chats, threads, and the workspaces they started; what share of all usage that was; and how much of the threads' and chats' usage went to writing the prompt cache.

## Requirements

1. Default on; `Settings.usageSavings !== false`.
2. Off restores the earlier behavior exactly: memory in the system prompt, transcript from `read_workspace`, one wake per finished workspace (still batched over 4 seconds), no task suffix.
3. Memory is never missing from a session: new sessions, forks, compactions and turns that never started get it again.
4. A chat that saves memory with `update_memory` is not sent that same version back.
5. Errors are never held back for a batch.

## Design

- `src/shared/usageSavings.ts`: the handoff report text, `memoryTurnPrefix` (FNV hash of the memory, prefix when the session lacks it), `holdUpdate` (batch rule), `ROUTER_MODEL`.
- `src/main/orchestrator.ts`: `systemPrompt(..., savings)` drops the memory and changes the waiting advice; `queryOptions(..., { chat })` appends the report request to started tasks, makes `read_workspace` report-first, records the memory hash in `update_memory`, and returns `turnPrefix` and `onSessionStart`.
- `src/main/agent.ts`: sends `turnPrefix` ahead of the first message of the turn (not saved as a chat item), calls `onSessionStart` on the init message, and clears `Chat.memoryHash` for a new or forked session and on `compact_boundary`.
- `src/main/index.ts`: `wakeOrchestrator` holds updates with `holdUpdate` while other workspaces reporting to the same chat still run.
- `src/shared/roleModels.ts`: `pickFor(role, settings, project)` resolves project › Settings › default, field by field. `Settings.roleModels`, `RepoGroup.models`; `Chat.rolePicked` marks a project chat given its role's pick. Used by `newThread`, the project chat's creation and `start_workspace` (through `Host.modelFor`). Pickers in `src/renderer/src/components/RoleModels.tsx`.
- `src/shared/usageHistory.ts` / `src/main/usageHistory.ts`: `Attributor.role` and `orchestrationSplit` for the Project work card.

## Compliance, privacy and security

- Uses only the Agent SDK and Claude Code's own model and effort options ([decision 0001](../decisions/0001-official-claude-access-only.md)).
- Nothing new leaves the Mac. The usage breakdown reads the same local summaries as the Usage page.

## Testing

`test/roleModels.test.ts` (defaults, overrides, cleaning), `test/usageSavings.test.ts` (report text, memory prefix, batch rule, usage split), `test/orchestrator.test.ts` (prompt without memory, memory sent once per version, report-first `read_workspace`), `test/usageHistory.test.ts` (roles).

## Rollout

On by default for everyone. No migration: the new chat fields are optional.

## Open questions

- How much each change saves on Ben's work laptop. The Project work card shows it; compare a week before and after.

## Future work

- Hand a thread's findings (files read, decisions) to the workspaces it starts, and use the scout subagent for searches (item 5 of the original proposal, not built).
