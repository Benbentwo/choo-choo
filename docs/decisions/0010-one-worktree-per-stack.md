# 0010: One worktree per stack of PRs

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Decided by | Claude (project thread), after Ben liked "the stack of PRs being under a workspace" in the mockups (2026-11-10). |

## Context

Ben wants a stack of PRs for one feature: iterate on any PR and have the ones above it kept up to date, and address feedback across all of them. A workspace in Choo Choo is one git worktree. Two shapes were possible: one workspace (and worktree) per PR, grouped in the sidebar; or one workspace whose worktree holds every branch of the stack.

Git won't let one worktree rebase or move a branch that is checked out in another worktree (`git rebase --update-refs` skips it, `git branch -f` refuses). With a worktree per PR, a restack would have to hop between worktrees and fail whenever one had uncommitted work.

## Decision

1. A stack lives in one workspace and one worktree. `Workspace.stack` lists its branches bottom to top; `Workspace.branch` is the one checked out.
2. "Working on a PR" means checking out its branch in that worktree. Everything that follows `ws.branch` (PR button, checks, comments, the PR watcher) follows the switch.
3. Restacking is done by the app with plain git, one layer at a time, cutting at the parent commit each layer was last built on. Agents commit to the branch they're on and never rebase other branches themselves.

## Consequences

- One chat and one agent work the whole stack, with its history across PRs.
- Only one PR of a stack is checked out at a time; working on two PRs of one stack at once isn't possible. Two independent features are two workspaces, as before.
- Switching PRs needs a clean worktree.
- Restacks are predictable and testable without an agent, and conflicts are the only part handed to one.
