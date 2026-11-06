# PRD: Remote sessions (phone and cloud)

| | |
|---|---|
| Status | In review: Continue on phone. Planned: Run in cloud / Bring back |
| Owner | Claude (project thread "Continue workspaces from phone and cloud") |
| Requested by | Ben, 2026-11-06 ("How can we use Claude Code remote sessions?") |
| Last updated | 2026-11-06 |

## Problem

A choo-choo chat only moves forward while you sit at the Mac. Claude Code already lets you steer a local session from the Claude app or claude.ai/code (Remote Control) and run sessions on Anthropic's machines (cloud sessions, `--cloud` and `--teleport`). Choo Choo should hand a chat to those surfaces and take it back, without its own server or login.

## Goals

- Pick up a chat on your phone in two clicks, and see what happened there when you bring it back.
- Later: send a workspace to a cloud session so it keeps going with the laptop closed, and pull it back into its worktree.

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

## Requirements

1. The handoff runs `claude --resume <session> --remote-control <chat title>` in the workspace, with the chat's model, effort and permission mode.
2. While a chat is on the phone, Choo Choo refuses to start its own turn on that session.
3. Bringing back, closing the process, archiving the workspace or closing the chat ends Remote Control. Turns made on the phone are copied into the chat.
4. After a restart, chats still marked as on the phone are brought back.
5. Imported turns never duplicate earlier history.

## Design

- `src/main/remote.ts`: `continueOnPhone`, `bringBack`, `recoverAfterRestart`, plus pure helpers (`phoneArgs`, `findSessionUrl`, `itemsFromTranscript`, `connectFailure`) covered by `test/remote.test.ts`.
- The process runs in a node-pty terminal with id `<workspace>:phone-<chat>`, so archiving the workspace kills it. Its output streams to the panel like a script terminal.
- The link is read from the output, including OSC 8 hyperlinks. The QR code is made with the `qrcode` package as an SVG data URL.
- Phone turns are read back with the Agent SDK's `getSessionMessages`, starting after `chat.lastUuid`. `--resume` keeps the session id, so the next Choo Choo turn resumes the same session.
- `Chat.remote` (`ChatRemote`: kind, startedAt, url, listOnly, qr) is persisted with the chat. IPC: `chat:phone`, `chat:phoneBack` (`Api.continueOnPhone`, `Api.bringBackFromPhone`).
- `agent.send` throws while `chat.remote` is set.

## Compliance, privacy and security

- Uses only the official Claude Code binary with the person's own claude.ai sign-in ([decision 0001](../decisions/0001-official-claude-access-only.md)). Choo Choo never reads or sends Claude tokens and never calls claude.ai itself.
- `ANTHROPIC_API_KEY` is cleared for this process, because Remote Control doesn't work with API keys.
- What leaves the machine is what Remote Control sends to claude.ai for that session, under the person's account. Remote Control is available on Pro, Max, Team and Enterprise plans.

## Testing

`test/remote.test.ts` covers arguments, quoting, link detection and transcript import. The live handoff needs a Mac signed in to claude.ai, so check it by hand in `npm run dev`: start a chat, click the phone button, send a message from the Claude app, bring it back.

## Rollout

On for everyone; the button only appears on Claude chats outside the orchestrator. Older saves have no `remote` field, which means "here".

## Open questions

- The Agent SDK has no switch to turn on Remote Control for an SDK session, so the chat is handed over instead of shared live. If the SDK gains one, Choo Choo could stay live while the phone is connected.
- Turns made on the phone have no file checkpoint, so reverting to one of them rewinds the conversation but not files.

## Future work

- **Run in cloud / Bring back**: `claude --cloud "<task>"` from the pushed branch, `claude -p "<msg>" --cloud <id>` for follow-ups, and `claude --teleport <id>` to pull it back into the worktree.
- List `claude agents --json` background sessions in the sidebar.
