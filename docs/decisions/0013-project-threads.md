# 0013: Projects route through an orchestrator chat to threads; the sidebar shows work by repo

| | |
|---|---|
| Status | Accepted; sidebar and ownership superseded by [0017](0017-threads-own-their-prs.md) |
| Date | 2026-11-10 |
| Decided by | Ben |

## Context

Ben asked for projects like Claude desktop's: one big idea across repos, several conversations, worktrees underneath. The first plan nested each workspace under the thread that started it. Ben wasn't sure a thread should own a worktree, and preferred the sidebar to show project › repos › PRs, with threads in a panel on the right like Claude desktop. He also wanted to type into one place and have messages land in the right thread.

## Decision

- A project is a project group with threads: chats on its orchestrator workspace. Its first chat is the orchestrator chat, which only routes (`send_to_thread`); threads do the work.
- Workspaces belong to the project. The sidebar lists them by repo and PR, never by thread. A workspace remembers the thread that started it only so its updates go back there.
- Ship behind Settings › Experimental so the Conductor layout doesn't change for anyone else.

## Consequences

- No new storage: groups, workspaces and chats gain two optional fields (`thread`, `threadId`).
- Routing costs one short orchestrator turn per message. Status questions are answered without forwarding.
- Turning the flag off falls back to one chat per group with tabs; threads show as tabs.

## Alternatives considered

- **A separate Projects tab:** two homes for the same workspaces.
- **Workspaces nested under threads:** Ben's call against it; topics drift and two threads can care about one PR.
- **Slack-style replies:** Ben chose whole-conversation threads like Claude desktop.
