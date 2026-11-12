# PRD: Remote sessions (phone, cloud and Claude desktop)

| | |
|---|---|
| Status | Shipped: Continue on phone (PR #41), Run in cloud (PR #42). In review: Open in Claude desktop |
| Owner | Claude (project thread "Continue workspaces from phone and cloud") |
| Requested by | Ben, 2026-11-06 ("How can we use Claude Code remote sessions?") |
| Last updated | 2026-11-12 |

## Problem

A choo-choo chat only moves forward while you sit at the Mac. Claude Code already lets you steer a local session from the Claude app or claude.ai/code (Remote Control) and run sessions on Anthropic's machines (cloud sessions, `--cloud` and `--teleport`). Choo Choo should hand a chat to those surfaces and take it back, without its own server or login.

## Goals

- Pick up a chat on your phone in two clicks, and see what happened there when you bring it back.
- Send a workspace to a cloud session so it keeps going with the laptop closed, and pull it back into its worktree.
- Move a chat to the Claude desktop app, as Claude Code's `/desktop` does, and bring it back.

## Non-goals

- A Choo Choo mobile app or web UI. The Claude app and claude.ai/code are the remote surfaces.
- Talking to claude.ai's APIs directly. Choo Choo only runs the official `claude` command.
- Codex chats and the orchestrator (its tools live inside Choo Choo).
- Agent view (`claude agents`). Choo Choo already supervises its own sessions; listing your terminal background sessions may come later.

## User experience

**Continue on phone.** A phone button sits on the chat tab row next to the usage graph button. It is enabled once the chat has a session and the agent isn't running. Clicking it replaces the composer with a panel:

- While Remote Control starts, the panel shows its terminal, so you can answer any first-run question (trust, Remote Control confirmation, the skip-permissions disclaimer).
- When Claude Code prints the session link, the panel shows a QR code, the link (open or copy) and **Bring back**. The terminal folds away behind **Show terminal**.
- If the link never appears in the output, after 20 seconds the panel points you to claude.ai/code to pick the session by the chat's title.
- **Bring back** stops Remote Control and adds the turns made on the phone to the chat, then a "Back from your phone" note. The composer returns.
- If Remote Control quits before connecting (for example Claude Code is signed in with an API key), the panel closes and the chat shows the last lines of its output with a sign-in hint.

**Run in the cloud.** The workspace's ⋯ menu has **Run in the cloud…**. A dialog asks what the cloud session should do (empty means "continue where this chat left off").

- Choo Choo commits any uncommitted changes ("Work in progress, moved to a cloud session"), pushes the branch, and runs `claude --cloud "<task + conversation so far>"` in a terminal. The cloud session clones the pushed branch.
- The composer becomes a cloud panel: QR code, link, a box to **send a follow-up** (`claude -p "<msg>" --cloud <id>`), **Bring back**, **Show terminal** and **Stop following**. Replies show on claude.ai/code and in the Claude app. Choo Choo can't read them, because there is no supported way to.
- **Bring back** runs `claude --teleport <id>` in the worktree, which checks out the session's branch and copies its conversation into a local session. As soon as that local session appears, Choo Choo stops the terminal, copies the cloud turns into the chat and resumes that session from then on. If the worktree has uncommitted changes, it asks you to commit or stash them first.
- **Stop following** leaves the cloud session running and returns the chat to normal.
- If `claude --cloud` quits before printing a session link, the chat shows why and stays local.

**Open in Claude desktop.** Asked for by Ben on 2026-11-12 ("add `/desktop` support"). Three ways in, all doing the same thing: a monitor button on the chat tab row (next to the phone button), **Open in Claude desktop** in the workspace's ⋯ menu, and typing `/desktop` (or `/app`) in the composer, which also shows in the `/` menu.

- Choo Choo runs `claude --desktop --resume <session>` in the worktree. That is Claude Code's own handoff: it checks Claude desktop is installed and new enough, refuses if the session is open in another terminal, and opens the app on the session through its `claude://resume?session=<id>` link. Choo Choo never opens that link itself.
- When it succeeds the composer becomes a panel, "Continuing in Claude desktop", with **Bring back** and **Open Claude desktop again**. The chat gets an "Opened in Claude desktop" note.
- **Bring back** copies the turns made in the app into the chat (same import as the phone) and returns the composer. Choo Choo's next turn resumes the same session.
- If Claude Code refuses (app missing or too old, not signed in with a Claude account, Linux), the error shows Claude Code's reason with a hint, and the chat stays here.

## Requirements

1. The handoff runs `claude --resume <session> --remote-control <chat title>` in the workspace, with the chat's model, effort and permission mode.
2. While a chat is on the phone, Choo Choo refuses to start its own turn on that session.
3. Bringing back, closing the process, archiving the workspace or closing the chat ends Remote Control. Turns made on the phone are copied into the chat.
4. After a restart, chats still marked as on the phone are brought back.
5. Imported turns never duplicate earlier history.
6. Run in cloud never loses local work: it commits and pushes before starting, and the cloud prompt carries the conversation with secrets redacted.
7. While a chat is in the cloud, Choo Choo refuses local turns. Follow-ups go to the cloud session.
8. Bring back from the cloud switches the workspace to the branch teleport checked out, and the chat continues the teleported session.
9. Open in Claude desktop runs only `claude --desktop --resume <session>` (an unmodified Claude Code), with `ANTHROPIC_API_KEY` cleared. It needs a session, an idle agent, a Claude chat outside the orchestrator, and no pending revert.
10. While a chat is in Claude desktop, Choo Choo refuses local turns until you bring it back. Archiving the workspace brings it back.

## Design

- `src/main/remote.ts`: `continueOnPhone`, `bringBack`, `recoverAfterRestart`, plus pure helpers (`phoneArgs`, `findSessionUrl`, `itemsFromTranscript`, `connectFailure`) covered by `test/remote.test.ts`.
- The process runs in a node-pty terminal with id `<workspace>:phone-<chat>`, so archiving the workspace kills it. Its output streams to the panel like a script terminal.
- The link is read from the output, including OSC 8 hyperlinks. The QR code is made with the `qrcode` package as an SVG data URL.
- Phone turns are read back with the Agent SDK's `getSessionMessages`, starting after `chat.lastUuid`. `--resume` keeps the session id, so the next Choo Choo turn resumes the same session.
- `Chat.remote` (`ChatRemote`: kind, startedAt, url, listOnly, qr) is persisted with the chat. IPC: `chat:phone`, `chat:phoneBack` (`Api.continueOnPhone`, `Api.bringBackFromPhone`).
- `agent.send` throws while `chat.remote` is set.
- `src/main/cloud.ts`: `runInCloud`, `sendToCloud`, `teleportBack`, `forgetCloud`, plus pure helpers (`cloudPrompt`, `sessionIdFromUrl`, `parseSendResult`) covered by `test/cloud.test.ts`. It uses terminal id `<workspace>:cloud-<chat>`. Teleport is detected by polling the SDK's `listSessions({ dir })` for a new session in the worktree. IPC: `chat:cloud`, `chat:cloudSend`, `chat:cloudBack`, `chat:cloudForget`. UI: `CloudPanel.tsx`.

- `src/main/desktop.ts`: `openInDesktop`, `bringBackFromDesktop`, plus pure helpers (`desktopArgs`, `DESKTOP_COMMAND`, `desktopFailure`) covered by `test/desktop.test.ts`. Claude Code's `--desktop` insists on a terminal (it refuses redirected input or output), so it runs in a hidden node-pty terminal `<workspace>:desktop-<chat>` that is killed when it exits, with a 60 second timeout. IPC: `chat:desktop`, `chat:desktopBack` (`Api.openInDesktop`, `Api.bringBackFromDesktop`). `chat:send` treats a bare `/desktop` or `/app` as the handoff. UI: `DesktopPanel.tsx`. `ChatRemote.kind` gains `'desktop'`.
- How `/desktop` works was confirmed from Claude Code 2.1.322 itself: `--desktop` with `--resume <id>`, `--continue` or nothing; it builds `claude://resume?session=<id>` (or `claude://code/new?folder=<path>`) and opens it with `open` on macOS. It needs Claude desktop 1.1.9669 or later and a claude.ai sign-in, and works on macOS and Windows x64.

## Compliance, privacy and security

- Uses only the official Claude Code binary with the person's own claude.ai sign-in ([decision 0001](../decisions/0001-official-claude-access-only.md)). Choo Choo never reads or sends Claude tokens and never calls claude.ai itself.
- `ANTHROPIC_API_KEY` is cleared for this process, because Remote Control doesn't work with API keys.
- What leaves the machine is what Remote Control sends to claude.ai for that session, under the person's account. Remote Control is available on Pro, Max, Team and Enterprise plans.

- Open in Claude desktop sends nothing anywhere itself: Claude Code opens the local app, which then runs the session under the person's own account.

## Testing

`test/remote.test.ts` covers arguments, quoting, link detection and transcript import. `test/cloud.test.ts` covers the cloud prompt, link parsing and follow-up results. `test/desktop.test.ts` covers the desktop arguments, the `/desktop` match and failure messages. The live handoffs need a Mac signed in to claude.ai, so check it by hand in `npm run dev`: start a chat, click the phone button, send a message from the Claude app, bring it back.

## Rollout

On for everyone; the button only appears on Claude chats outside the orchestrator. Older saves have no `remote` field, which means "here".

## Open questions

- Whether Claude desktop keeps writing to the same session id after `claude://resume`. If it forks to a new id, Bring back finds nothing new to copy and says so; the work in the worktree is still there.

- The Agent SDK has no switch to turn on Remote Control for an SDK session, so the chat is handed over instead of shared live. If the SDK gains one, Choo Choo could stay live while the phone is connected.
- Turns made on the phone have no file checkpoint, so reverting to one of them rewinds the conversation but not files.

- Choo Choo can't show the cloud session's replies, only send to it. Use claude.ai/code or the Claude app to watch it.
- Cloud sessions need the Claude GitHub App on the repo, or `/web-setup`. Without it, `claude --cloud` uploads the local repository as a bundle instead.

## Future work

- List `claude agents --json` background sessions in the sidebar.
