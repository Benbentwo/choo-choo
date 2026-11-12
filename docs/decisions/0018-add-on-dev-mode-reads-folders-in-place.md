# 0018: Add-ons under development are read from their folder and reload as it changes

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-12 |
| Decided by | Ben (asked for an `npm run dev` style loop for add-ons and marketplaces); Claude (the design) |

## Context

Add-ons are Claude Code plugins ([0006](0006-add-ons-are-claude-code-plugins.md)). Claude Code already reads a plugin from a folder source in place (`readFromFolder` in `claude plugin list --json`), and Choo Choo serves view files with `no-store`, so a folder source picked up edits. But you had to reopen a view to see them, turn the add-on off and on to restart its background page, press Check again after a manifest change, and a single add-on needed a hand-written marketplace around it. Claude Code only installs plugins from a marketplace.

## Decision

- **Develop add-on…** in Settings › Add-ons takes a folder. A marketplace root is added as a source as it is. A single add-on is symlinked into a marketplace Choo Choo keeps in its data folder, named `choo-choo-dev`, so its id is `<name>@choo-choo-dev`.
- If a source with the folder's marketplace name is already added from elsewhere (usually the same repo from GitHub), Choo Choo asks before replacing it, then reinstalls the same add-ons from the folder. Ids stay the same, so grants and add-on data carry over.
- Every add-on read from a folder (`readFromFolder`) is a dev add-on, however it was added: it gets a Dev badge and a file watcher. A save restarts that add-on's frames (views reload, the background page restarts); a manifest save reads the manifest again first. The usual rules still apply: more permissions pause it until reviewed.
- Reload is a full restart of the add-on's frames, not hot module replacement. Add-ons with a build step run their own watcher (`vite build --watch` and the like) into the folder they serve from.

## Consequences

- Nothing is copied, so the folder is the source of truth, and a git checkout or worktree works as is.
- No new permission or trust path: loading a folder is the same as adding a folder source by hand, and turning the add-on on still shows its permissions.
- Add-ons from git sources are never watched; they change only when Claude Code updates them.
- View state is lost on each reload. An add-on that wants to keep it across reloads keeps it in `choo.store`.
- `fs.watch` with `recursive` needs macOS, Windows or a recent Linux kernel; Choo Choo targets the Mac.

## Alternatives considered

- **A dev-only loader that skips Claude Code**: the add-on's skills, hooks and MCP servers wouldn't load, so it wouldn't be the add-on people install.
- **Hot module replacement inside views**: needs a bundler-specific client in every add-on. A frame restart is fast for plain ES module add-ons and works for every kind.
- **Watching only add-ons loaded with Develop add-on**: folder sources added by hand would still need reopening, for no reason.
