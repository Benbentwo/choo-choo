# PRD: Orchestrator

| | |
|---|---|
| Status | Shipped (PR #19); project groups, automatic updates, cloud workspaces and PR status added later |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-10 |

## Problem

Running many agents means a lot of manual coordination: splitting work, starting workspaces, checking in, sending follow-ups. Ben first asked to tie Choo Choo into claude.ai Projects (memory, threads). There is no public API for Projects, project memory or chat history (only the admin-only Compliance API), and reusing a claude.ai login is against Anthropic's terms. The real need was an orchestrator: give it intent, and it launches and directs agents.

## Goals

- One chat per repo that turns intent into parallel workspaces and follows them to done.
- A memory per repo that persists across sessions and that the person can read and edit.
- Project groups: one orchestrator and one memory for work that spans several repos. This is Choo Choo's stand-in for a claude.ai project, which has no API.
- Report back without being asked: when work it started finishes, the orchestrator checks it and tells the person.

## Non-goals

- Editing code itself. The orchestrator directs; workspace agents do the work.
- Any claude.ai integration, including claude.ai Projects (no public API, see Problem).

## User experience

An orchestrator icon next to each repo in the sidebar opens (or creates) that repo's orchestrator chat. The person describes what they want. The orchestrator starts workspaces, gives each agent a task, waits, reads transcripts and diffs, and sends follow-ups. Workspaces it starts are marked as orchestrated.

When a workspace it started finishes and the orchestrator is idle, Choo Choo starts an orchestrator turn with an automatic update (marked as not from the person). The orchestrator checks the work, sends next steps, and tells the person where things stand. Settings › General › Orchestrator updates turns this off; then a note appears instead, as before.

Project groups: "New project group…" in the sidebar's view menu (or ⌘K) asks for a name and repos. Groups list above the repos in the sidebar; clicking one opens its orchestrator, and Edit renames, changes repos or deletes it. The group orchestrator runs in the first repo's checkout, can read the others, and starts each workspace in the repo the work belongs to.

## Requirements

1. One orchestrator per repo, running in the repo's main checkout (`Workspace.orchestrator = true`).
2. It cannot edit files: `Edit`, `MultiEdit`, `Write` and `NotebookEdit` are disallowed.
3. Tools: list, start, message, read, wait on (up to 30 minutes), stop and archive workspaces, and update memory.
4. Messaging a workspace whose agent is still running fails; the orchestrator waits first. Waiting returns when agents stop or need the person to approve a tool call.
5. Memory lives at `~/choo-choo/memory/<repo>.md` (max ~20 KB), rendered into the system prompt every turn. The person can edit the file directly. A project group's memory lives at `~/choo-choo/memory/groups/<group>.md`.
6. `start_workspace` takes `where: "cloud"` to run the agent in a Claude Code cloud session (the same path as Run in cloud). Cloud workspaces report `in-cloud` and their link; `message_workspace` queues follow-ups into the session. Their transcript isn't visible locally, so the orchestrator follows them with `pr_status`.
7. `start_workspace` takes `pr` or `branch` to start on an existing pull request or branch, the same as New workspace from a PR or branch, so the workspace shows that PR from the start. If a workspace is already on it, the tool says so and points to `message_workspace`.
8. `pr_status` shows the PR for a workspace's branch and its checks, failures first, and can wait (up to 30 minutes) until no check is pending. It never asks for approval.
9. Automatic updates: finished workspaces are batched for 4 seconds, skipped if the orchestrator already read them since they finished, and held until the orchestrator's own turn ends. At most 8 automatic turns run between messages from the person; after that a note says updates are paused.
10. A project group needs a name and at least one repo. Removing a repo drops it from its groups. Deleting a group hides its orchestrator; workspaces and memory stay.
11. Add-ons that are on and hold `orchestrator:tools` add their tools, one MCP server per add-on (`addon-<plugin name>`), and a line each in the prompt. Their read-only tools run without asking. See [Add-ons](add-ons.md).

## Design

- `src/main/orchestrator.ts`: tools are an in-process MCP server (`createSdkMcpServer`, name `choo`) built with the Agent SDK's `tool()` and zod schemas. A small `Host` interface (create workspace, send, stop, archive, pending permissions) keeps the module free of Electron so it's unit-testable.
- The orchestrator keeps its own system prompt, passed through `extraOptions` (custom system prompts don't apply to it).
- `api.openOrchestrator(repoId)`, `api.openGroupOrchestrator(groupId)`, `api.saveGroup`, `api.deleteGroup`.
- An orchestrator works on a `Scope` (one repo, or a group's repos). Workspaces it starts record `orchestratorId` (repo or group id) so updates go to the orchestrator that started them; older workspaces fall back to their repo's orchestrator. A group's orchestrator workspace carries `groupId`.
- Groups are `AppState.groups` (`RepoGroup`: id, name, repoIds).

## Compliance, privacy and security

Runs on the Agent SDK with the user's own sign-in like any other chat. Memory stays on disk locally.

## Testing

`test/orchestrator.test.ts`.

## Future work

- Projects: threads and a repo › PR sidebar for project groups, behind Settings › Experimental. See [Projects](projects.md).

- Show orchestrated workspaces grouped under the orchestrator in the sidebar.
- Show a cloud workspace's progress inside Choo Choo (today only its PR and claude.ai/code show it).
