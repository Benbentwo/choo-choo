# PRD: Live status and check-ins

| | |
|---|---|
| Status | In review |
| Owner | Choo Choo maintainers |
| Requested by | Ben, 2026-11-16 |
| Last updated | 2026-11-16 |

## Problem

During a long turn the chat showed a bare "Working…" for many minutes. Often the agent was in a shell loop polling CI or a deploy, which is fine, but nothing on screen said so, so the chat felt stuck. Stopping it would throw away work, and a message sent mid-turn ("How's this looking?") is only read at the agent's next step, which never comes while a blocking command runs.

> Sometimes it feels like it's stuck, and I don't want to stop it because presumably it's doing something, but I want to be able to check in with it.

## Goals

- A running chat always says what it is doing right now, in plain words, and for how long.
- Waits and polling loops read as waits, naming what they wait on ("Waiting on run 48213 · 14m").
- The person can ask "what are you working on / waiting on?" and get an answer within seconds, without interrupting or steering the turn.
- The background task list docked above the message box stays as it is.

## Non-goals

- Changing what the agent does. A check-in never enters the running turn unless the person forwards it.
- Live command output (stdout) in the chat. Claude Code doesn't stream a running command's output to the SDK.

## User experience

- **Live line.** Under a running chat, where "Working…" used to be: the current step and how long it has run, plus the whole turn's time once it differs. Bash steps use the description Claude gave the command; polling loops and watches show in amber as "Waiting on run N", "Waiting on PR #N checks", or "Waiting: <description>". Between steps it says Thinking or Writing. Hovering the label shows the raw command. The live Working row in the compact format also shows the step's elapsed time.
- **Check in.** A button at the right of the live line. It adds a dashed "Check-in" card to the chat that fills in with a short answer: what's running, what it waits on, for how long, what comes next, and a plain warning if it looks stuck. Claude keeps working the whole time.
- **/btw <question>** asks a specific side question the same way, running or not (as in Claude Code). `/btw` alone asks the default question.
- **Status questions sent mid-turn** ("How's this looking?", "what are you waiting on?", "any update?", "are you stuck?") get a check-in instead of being steered in. The card has **Also ask Claude** to send the question into the turn as well.
- The message box placeholder while running mentions `/btw`.

## Requirements

1. The live line replaces the bare "Working…" whenever a chat is running and no permission card is waiting.
2. Wait detection covers `until`/`while` loops that sleep, `sleep N`, `gh run watch`, `gh pr checks --watch`, `--watch`, `kubectl rollout status|wait`, `tail -f`, and the orchestrator's `wait_for_workspaces` / waiting `pr_status`.
3. A check-in never writes to the running Claude Code session.
4. Only one check-in per chat is answered at a time.
5. A check-in shows an error in the card if the model can't be reached; the turn is unaffected.

## Design

- `src/shared/liveStatus.ts`: `liveStatus(items)` finds the latest tool call without a result in the current turn and describes it (`describeTool`, `isWaitCommand`, `waitTarget`, which also resolves run ids held in shell variables); `formatElapsed`; `isStatusQuestion`; `statusBlock` for the check-in prompt.
- `src/main/checkIn.ts`: adds a `checkin` chat item, runs a one-turn, tool-less Sonnet `query()` through the Agent SDK with the status block, the last few messages before the turn and the turn's transcript (`renderTurn`, secrets redacted), streams the answer into the card. `src/main/agent.ts` exposes the running background tasks (`liveTasks`).
- IPC: `checkIn(chatId, question?)` and `forwardCheckIn(chatId, itemId)`. `sendFromPerson` in `src/main/index.ts` routes `/btw` and mid-turn status questions to the check-in.
- UI: `LiveLine` and `CheckInItem` in `src/renderer/src/components/ChatView.tsx`.

## Compliance, privacy and security

- Uses the official Agent SDK and the person's Claude Code binary and sign-in ([decision 0001](../decisions/0001-official-claude-access-only.md)).
- The transcript goes only to Claude, as the chat itself does, with obvious secrets masked first. Nothing is persisted outside the chat's own items.

## Testing

`test/liveStatus.test.ts` covers wait detection, targets, descriptions, the live status, elapsed formatting, status-question matching and `/btw`. The `check-in` demo scene (`scripts/demo/record.cjs`) drives it in the built app.

## Rollout

On by default; no settings. Old chats load unchanged.

## Open questions

- Should the orchestrator answer check-ins about its workspaces with their live lines too?

## Future work

- Show the live line on sidebar rows and project threads.
- Warn on its own when a step has been quiet far longer than usual.
