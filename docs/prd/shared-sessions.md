# PRD: Shared sessions

| | |
|---|---|
| Status | Shipped (PR #18) |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-06 |

## Problem

A coworker can't pick up where you left off: they'd need your branch, your uncommitted files and the conversation that got there. Conductor has no way to do this.

## Goals

- Share a workspace (branch, uncommitted and untracked files, all chats) with a link.
- The coworker continues the conversation with their own Claude login, with your transcript as context.
- No new server or account; access follows repo access.

## Non-goals

- Real-time multi-user editing or a live shared view.
- Sharing Claude logins, SDK session files or settings.

## User experience

- Sharer: workspace ⋯ menu > Share with coworkers. Get a `choo-choo://share?remote=…&id=…` link. By default the share updates after every agent turn (auto-sync toggle). Stop sharing deletes it.
- Coworker: click the link, or Home > Open shared session, which lists every share in their repos. Choo Choo clones the repo if needed, creates a workspace on the sharer's branch with their changes in place, and shows the chats. While open, new turns from the sharer appear within 30 seconds for chats the coworker hasn't continued.

## Requirements

1. A share is one commit pushed to `refs/choo-choo/shares/<id>` in the repo's `origin`.
2. The commit's tree holds `share.json` (workspace info and chats); its parent is a worktree snapshot (uncommitted and untracked, not gitignored), whose parent is the branch HEAD.
3. Strings that look like API keys or tokens are blanked out of shared chats.
4. The UI shows repo visibility: a share in a public repo is public.
5. The coworker's first message in a shared chat sends the transcript as handoff context (`Chat.handoff`).
6. Opened shares poll every 30 seconds.

## Design

`src/main/share.ts` (bundle format, push/fetch/list/delete refs, redaction), `src/main/shareIpc.ts` (IPC, auto-sync after turns, polling), `src/renderer/src/components/ShareModals.tsx`. `choo-choo://` is registered as the app's protocol in `index.ts`. See [decision 0004](../decisions/0004-no-server-git-for-sharing.md) for why git refs.

## Compliance, privacy and security

No credentials or SDK sessions travel with a share; each person runs the conversation with their own sign-in. Gists were rejected because anyone with the link can read them.

## Testing

`test/share.test.ts`.

## Future work

- A live, multi-user view of a running session.
- Per-share expiry.
