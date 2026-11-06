# PRD: Import from Conductor

| | |
|---|---|
| Status | Shipped (PR #23, folder options in PR #25) |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-06 |

## Problem

Conductor users switching to Choo Choo have projects, open workspaces and chats they don't want to lose or recreate. Conductor Cloud users also need a path, since Cloud shuts down in November 2026.

## Goals

- One action moves a Conductor setup into Choo Choo: projects, open workspaces, their chats and the default model.
- Claude chats resume with full context, not just a pasted transcript.
- Zero risk to Conductor's own data.

## Non-goals

- Importing archived Conductor workspaces (they're counted and skipped).
- Importing directly from Conductor Cloud. Users first move cloud workspaces to their Mac in Conductor (right-click > Transfer to local).
- Two-way sync. This is a one-time import; running it again only adds what's new.

## User experience

Settings > Import from Conductor. The app shows a preview: each repo (new, already added, or missing on disk, and whether it has scripts), each open workspace (with chat count), archived workspaces skipped, and the settings it will bring over. The person can choose to keep using Conductor's workspaces folder for new workspaces. Import shows a result count (repos, workspaces, chats, messages).

## Requirements

1. Read Conductor's database at `~/Library/Application Support/com.conductor.app/conductor.db` from a temporary copy, never the original file.
2. Add each repo that still exists and is still a git repo; keep its hidden flag; carry Conductor's setup, run and archive scripts as app-level repo scripts (a `choo-choo.json` or `conductor.json` in the repo still wins).
3. Import active workspaces in place: same worktree path and branch, no files moved.
4. Import each chat with its title, model (Claude or Codex), effort and plan mode, and its messages converted to Choo Choo chat items.
5. For Claude chats, reuse Conductor's Claude session id. Since the worktree path is the same, Claude Code resumes with full context.
6. Skip anything already imported (matched by path), so re-running is safe.
7. Bring over the default model; optionally use Conductor's workspaces folder.

## Design

- `src/main/conductorImport.ts`: `withConductorDb` (temp copy, read-only), `readConductor`, `readMessages`, `mapModel`, `mapEffort`, `repoScripts`, `convertMessages`, `activeWorkspaces`, `preview`.
- `src/main/index.ts`: `previewConductor` and `importConductor` behind `api.previewConductorImport()` and `api.importFromConductor({ useWorkspacesRoot })`.
- Types: `ImportPreview`, `ImportResult` in `src/shared/types.ts`.

## Compliance, privacy and security

Everything stays on the Mac. No Conductor code or assets are used; only the user's own local data is read. Resuming a Claude session runs through the user's own Claude Code sign-in.

## Testing

`test/conductorImport.test.ts` covers mapping and message conversion against fixture rows.

## Open questions

- Conductor's schema may change in later releases; the reader should fail soft (preview shows nothing found) rather than crash.
