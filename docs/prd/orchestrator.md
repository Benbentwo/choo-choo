# PRD: Orchestrator

| | |
|---|---|
| Status | Shipped (PR #19) |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-06 |

## Problem

Running many agents means a lot of manual coordination: splitting work, starting workspaces, checking in, sending follow-ups. Ben first asked to tie Choo Choo into claude.ai Projects (memory, threads). There is no public API for Projects, project memory or chat history (only the admin-only Compliance API), and reusing a claude.ai login is against Anthropic's terms. The real need was an orchestrator: give it intent, and it launches and directs agents.

## Goals

- One chat per repo that turns intent into parallel workspaces and follows them to done.
- A memory per repo that persists across sessions and that the person can read and edit.

## Non-goals

- Editing code itself. The orchestrator directs; workspace agents do the work.
- Cross-repo orchestration.
- Any claude.ai integration.

## User experience

An orchestrator icon next to each repo in the sidebar opens (or creates) that repo's orchestrator chat. The person describes what they want. The orchestrator starts workspaces, gives each agent a task, waits, reads transcripts and diffs, and sends follow-ups. Workspaces it starts are marked as orchestrated.

## Requirements

1. One orchestrator per repo, running in the repo's main checkout (`Workspace.orchestrator = true`).
2. It cannot edit files: `Edit`, `MultiEdit`, `Write` and `NotebookEdit` are disallowed.
3. Tools: list, start, message, read, wait on (up to 30 minutes), stop and archive workspaces, and update memory.
4. Messaging a workspace whose agent is still running fails; the orchestrator waits first. Waiting returns when agents stop or need the person to approve a tool call.
5. Memory lives at `~/choo-choo/memory/<repo>.md` (max ~20 KB), rendered into the system prompt every turn. The person can edit the file directly.

## Design

- `src/main/orchestrator.ts`: tools are an in-process MCP server (`createSdkMcpServer`, name `choo`) built with the Agent SDK's `tool()` and zod schemas. A small `Host` interface (create workspace, send, stop, archive, pending permissions) keeps the module free of Electron so it's unit-testable.
- The orchestrator keeps its own system prompt, passed through `extraOptions` (custom system prompts don't apply to it).
- `api.openOrchestrator(repoId)`.

## Compliance, privacy and security

Runs on the Agent SDK with the user's own sign-in like any other chat. Memory stays on disk locally.

## Testing

`test/orchestrator.test.ts`.

## Future work

- Show orchestrated workspaces grouped under the orchestrator in the sidebar.
- Let the orchestrator open PRs and wait on checks.
