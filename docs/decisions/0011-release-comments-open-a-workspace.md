# 0011: Comments in release builds open a workspace on choo-choo

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Decided by | Ben |

## Context

Comment mode (⌘⇧K) started as a dev tool: the note lands in `.feedback/` and a Claude Code session edits the running checkout. A release build has no checkout, so the same gesture had nowhere to go. choo-choo is a public MIT repo, and the app already makes workspaces, so it can work on its own source like any other repo.

## Decision

`app.isPackaged` picks the default. Dev keeps writing to the local checkout. Release builds open a workspace on Benbentwo/choo-choo, reusing an added checkout, else cloning it, else (without push access) forking and cloning the fork. A prefilled GitHub issue is the fallback. The whole-window screenshot is opt-in in release builds.

## Consequences

- Anyone running the app can turn a UI complaint into a PR in one step, and their PR goes upstream.
- Forking writes to the person's GitHub account; it only happens when they press Fix it without push access.
- Workspaces branch from current main, not the build's commit, so the prompt carries the commit and tells the agent to check what changed since.

## Alternatives considered

- **Only file issues**: no agent, so no fix; it stays as the fallback.
- **Check out the build commit**: the fix would need a rebase before it could merge.
- **Hide comment mode in release builds**: loses the cheapest feedback channel the app has.
