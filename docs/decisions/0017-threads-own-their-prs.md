# 0017: A project's threads own their workspaces and PRs; the sidebar shows project › thread › repo › PR

| | |
|---|---|
| Status | Accepted. Supersedes the sidebar and ownership parts of [0013](0013-project-threads.md) |
| Date | 2026-11-12 |
| Decided by | Ben (threads should manage their own PRs, and the sidebar should group by thread); Claude (the design) |

## Context

[0013](0013-project-threads.md) made workspaces belong to the project and listed them by repo and PR, never by thread. A workspace only remembered the thread that started it (`threadId`) so its updates went back there. In use, the thread is the unit of work: it starts the PRs, gets their updates and has the context to finish them. Listing PRs by repo hid which conversation was responsible for each one, and every thread's `list_workspaces` showed the whole project's work.

## Decision

- A thread owns the workspaces it starts, and so their PRs. `Workspace.threadId` is that owner, no longer only an update target.
- The sidebar under a project is thread › repo › workspace (shown by its PR). Only threads with open work show. Work no thread owns (started before threads, or its thread was deleted) sits last under "No thread".
- In a thread, `list_workspaces` shows that thread's workspaces; `all: true` shows every workspace with its owning thread. `take_workspace` moves a workspace (and its PR) to the current thread. The thread's prompt says to leave other threads' work alone unless the person asks.
- The orchestrator chat still routes, and is told to send work on an existing PR to the thread that owns it.

## Consequences

- No new storage: `threadId` already existed.
- The "Show all repos" link under a project is gone: a repo with no work has no thread to sit under. The project's repos are still in its Edit dialog.
- One thread spanning several repos shows each repo under it, so one-repo threads carry an extra level. Accepted for a consistent tree.
- Ownership is not enforced in the tools: a thread can still message or archive another thread's workspace. The prompt steers it; the person can ask for anything.

## Alternatives considered

- **Keep project › repo › PR and label each PR with its thread:** keeps the tree shallow, but doesn't show a thread's work together, which is what Ben asked for.
- **Hard ownership (tools refuse other threads' workspaces):** safer, but blocks legitimate cross-thread help and the orchestrator chat's status answers. `take_workspace` makes moves explicit instead.
- **Hide the repo level when a thread touches one repo:** shorter, but the tree changes shape as work is added.
