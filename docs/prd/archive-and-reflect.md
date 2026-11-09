# PRD: Archive and reflect

| | |
|---|---|
| Status | Shipped (archive folder and retention PR #24; reflect PR #21; session feedback PR #30) |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-06 |

## Problem

Finished workspaces pile up, and deleting a worktree loses uncommitted work. Separately, the friction an agent hit during a session (wrong commands, missing context, repeated corrections) is lost when the workspace goes away, so the next agent hits it again.

## Goals

- Archive keeps the worktree, uncommitted files included, until a retention period ends.
- Archived workspaces are easy to find and restore.
- After a PR merges, offer to turn the session's lessons into changes to the repo's agent setup.

## Non-goals

- Applying reflection changes without the person's review.
- Changing anything outside the repo's agent setup files.

## User experience

- **Archive** (sidebar hover button or ⋯ menu): runs the archive script, moves the worktree to `~/choo-choo/archive/<repo>/<name>-<id>`, keeps the branch. Archived workspaces show in the sidebar's Archived list and dimmed in ⌘K recents; opening one restores it.
- **Retention**: Settings, default 30 days, 0 keeps forever. Cleanup runs at startup and every 6 hours and deletes the folder only; branch and transcript stay.
- **After merge**: the right panel header shows Continue and Archive. Archive opens "How did this session go?" (mood chips and free text) with Skip and archive, or Reflect and archive. ⋯ > Reflect on this session… opens the same popup without archiving.
- **Reflect**: an agent reviews the chats and proposes up to 5 changes. They open in a Reflect tab beside the workspace's chats, not a pop-up, so the person can switch to a chat to check something and come back without losing the results. Each change shows as an editable diff the person accepts, edits or rejects. Accepted changes are written to a new workspace whose agent opens a PR. Closing the tab stops the agent if it is still reading.

## Requirements

1. Archive moves the worktree with `git worktree move`; restore moves it back, or recreates it from the branch if the folder is gone.
2. Reflection targets only `CLAUDE.md`, `AGENTS.md`, `.claude/rules|skills|agents|commands`, `settings.json` and hooks, as full-file proposals.
3. The person's session feedback goes into the reflect prompt as primary evidence.
4. The reflect agent is read-only: only `Read`, `Glob` and `Grep`, and only inside the worktree (paths that escape fail closed).
5. Secrets are redacted from the transcript before it's sent.
6. Proposals that touch executable targets (hooks, settings) are unchecked by default with a warning.

## Design

`src/main/archive.ts`; `src/main/reflect.ts` (runner, `insideDir` sandbox); `src/shared/reflect.ts` (prompt, `condenseTranscript`, `feedbackBlock`, `parseReflectResult`); `src/renderer/src/components/Reflect.tsx`; `WorkspacePreview.tsx` for the hover card. IPC: `archiveWorkspace`, `restoreWorkspace`, `cleanupArchives`, `reflect`, `cancelReflect`, `applyReflection`.

## Compliance, privacy and security

Decisions from the GitHub Advanced Security review: redact secrets, sandbox the reader, uncheck executable targets. Declined as not worth it: base64-encoding the transcript, a regex content blocklist, an env-var gate. The bot repeats these findings on every push; reply pointing to the earlier thread.

## Testing

`test/archive.test.ts`, `test/reflect.test.ts`, `test/reflectSandbox.test.ts`. Not yet run live end to end.

## Open questions

- Should reflection run automatically (with results waiting) instead of on demand?
