# PRD: Managing projects, and PR status at a glance

| | |
|---|---|
| Status | In review (PR #53) |
| Owner | Claude |
| Requested by | Ben, in-app comments, 2026-11-06 |
| Last updated | 2026-11-10 |

## Problem

There was no way to take a project out of Choo Choo or clean up the workspace folders it left behind. The PR button showed "Open #n" whatever state the PR was in, so you had to open GitHub to see whether checks passed or the PR could merge.

## Goals

- Remove a project from its row in the sidebar, and choose then whether to delete its workspace folders.
- Delete any workspace, or folders kept from an earlier removal, later from Settings.
- See check status next to the PR button, and have the button offer the next step.

## Non-goals

- Deleting the repository itself. Removing a project never touches the repo folder, and branches stay in git.
- Merging without passing checks or a required review.

## User experience

- **Project menu (…)** on hover over a project row: Hide/Show in sidebar, Reveal in Finder, Manage workspaces…, Remove project….
- **Remove project** dialog: Cancel, "Remove, keep files", or "Remove and delete files". Kept folders show in Settings > Projects > Left on disk.
- **Settings > Projects**: every project with its workspaces, each with Delete (asks to confirm), plus Left on disk.
- **PR button**: a checks pill on its left (spinner with passed/total, a green dot for all passing, a red count for failures; it opens the Checks tab). The button itself reads, in order of priority: Resolve conflicts, Fix checks, Needs review, Merge, or Open #n.

## Requirements

1. Removing with "delete files" deletes each workspace's worktree and archived copy through `git worktree remove`, never the repo folder.
2. Removing with "keep files" records the folders as a leftover that can be deleted later.
3. Deleting a workspace removes its folders and chats; its branch stays.
4. Resolve conflicts and Fix checks send the agent a prompt with the base branch or the failing checks and links. Merge squash-merges.
5. Merge shows only when checks pass, the PR isn't a draft, no review is required or outstanding, and GitHub's merge state is clean.
6. Create PR opens a draft by default. While the PR is a draft, the PR menu offers Mark ready for review, which runs `gh pr ready`.
7. A workspace on a branch that already has a PR shows that PR, however the workspace was made. When the agent checks out another branch itself (`gh pr checkout 12`, `git switch feature`, as orchestrator-started agents often do), the workspace follows it: its branch is re-read before every PR lookup, after every agent turn and on every PR watch tick, and the PR button switches from Create PR to that branch's PR. Fork PRs (checked out from `refs/pull/<n>/head`) are looked up by number. Stacked workspaces and orchestrators manage their own branch and are left alone.
8. While an open PR is behind its base branch and has no conflicts, the PR menu offers Update branch with the number of commits behind. It runs `gh pr update-branch` (a merge of the base, as on GitHub), then pulls the result into the worktree: a fast-forward, or a merge when there are unpushed commits (backed out, with an error, if that conflicts). It is hidden while an agent is working.

## Design

- IPC: `removeProject`, `deleteWorkspace`, `deleteLeftover` (`src/main/index.ts`). Leftovers are stored in `AppState.leftovers`.
- PR state: `gh pr view` now also returns `reviewDecision` and `mergeStateStatus`. `src/shared/prStatus.ts` picks the button's action, with tests in `test/prStatus.test.ts`.
- Behind the base: `pr:get` asks GitHub's compare API (`compare/<base>...<head>`) for `behind_by` on open PRs. `mergeStateStatus` says BEHIND only when branch protection requires an up-to-date branch, so it can't be the only signal.
- Keeping PR state fresh: `src/main/prWatch.ts` probes each open workspace's PR (`pulls?head=…`) and its head commit's check runs with conditional requests through `gh api -i` and `If-None-Match`. Unchanged answers are 304s, which don't count against GitHub's rate limit. Probes run every 15s while the window is focused, every 60s otherwise, and right away when it comes to the front. When a probe returns 200 the main process sends `pr:changed`; the renderer bumps `prVersion[wsId]` and the PR button, Checks tab, hover preview and merged actions reload. A full reload also happens every 5 minutes, for changes the probes can't see (PRs from forks, commit statuses). There is no webhook relay: Choo Choo has no server, and webhooks need a public endpoint.
- Following the checked-out branch: `src/main/workspacePr.ts` reads `git branch --show-current` and, for fork PRs, `branch.<name>.merge`, and stores `Workspace.prNumber`. PR lookups pass the number when known, else the branch. The watch probes `pulls/<n>` for a known number, and starts a branch's probes over (with an immediate refresh) when the workspace moves to another branch.

## Compliance, privacy and security

- No Claude access or third-party sign-in is involved. Deletion runs only from an explicit click, and the dialog says what will be deleted.
