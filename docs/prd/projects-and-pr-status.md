# PRD: Managing projects, and PR status at a glance

| | |
|---|---|
| Status | In review (PR #53) |
| Owner | Claude |
| Requested by | Ben, in-app comments, 2026-11-06 |
| Last updated | 2026-11-07 |

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

## Design

- IPC: `removeProject`, `deleteWorkspace`, `deleteLeftover` (`src/main/index.ts`). Leftovers are stored in `AppState.leftovers`.
- PR state: `gh pr view` now also returns `reviewDecision` and `mergeStateStatus`. `src/shared/prStatus.ts` picks the button's action, with tests in `test/prStatus.test.ts`.

## Compliance, privacy and security

- No Claude access or third-party sign-in is involved. Deletion runs only from an explicit click, and the dialog says what will be deleted.
