# PRD: Claude Code session controls

| | |
|---|---|
| Status | In review |
| Owner | Claude (project thread) |
| Requested by | Ben, 2026-11-06 ("Quick wins, then managers" from the Claude Code docs survey) |
| Last updated | 2026-11-06 |

## Problem

Claude Code has session features that Choo Choo chats couldn't reach: auto mode, `/goal`, the higher effort levels, fast mode, spend caps, output styles, compacting, its own `/code-review`, and a view of background tasks. Ben asked for the quick wins from the [Claude Code docs survey](https://claude.ai/artifact/15aTrRanrSEBsvRxpNFNP6) first.

## Goals

- Each feature is one click away in a Claude chat, using Claude Code's own implementation.
- Nothing changes for a chat until the person turns something on.

## Non-goals

- `/ultrareview`. It runs in Anthropic's cloud and bills separately, so it waits for the cloud work in [remote sessions](remote-sessions.md).
- Moving tasks to the background. Each turn runs its own Claude Code process, so a backgrounded task would end with the turn.
- The auto-compact window setting.

## User experience

- **Auto mode.** The model menu's Permissions list (and the Settings default) gets "Auto (Claude Code decides)". Claude Code's classifier approves safe tool calls and blocks risky ones. Anything it sends back for a decision shows the usual permission card. The model button shows "· auto".
- **Goal.** A Goal button next to Plan opens a "Keep going until…" field. Start sends `/goal <condition>`, and Claude keeps taking turns until a separate model judges the condition met. While a goal is active, a "◎ Goal" row above the composer shows the condition, the number of checks, and the latest reason on hover, with a Clear button when idle. Typing `/goal …` yourself works the same way.
- **Effort.** Low, Medium, High, Extra high and Max. Codex gets xhigh for Max.
- **Fast mode.** A toggle in the model menu's Session section. The model button shows "· fast".
- **Spend cap per message.** A number in the model menu, with a default in Settings > General. A run that hits it stops with a message saying so.
- **Compact conversation.** Sends `/compact`.
- **Output style.** The model menu lists Default, Explanatory, Learning, and the styles in `~/.claude/output-styles` and the repo's `.claude/output-styles`.
- **Claude Code /code-review.** A button in the Review tab runs Claude Code's built-in review skill. Findings it reports with its ReportFindings tool show in the Review list and inline in diffs. CONFIRMED findings count as high and PLAUSIBLE ones as medium.
- **Background tasks.** While a turn runs, background shells, subagents and workflows are listed above the composer with their latest progress and a Stop button.

## Requirements

1. Every feature goes through the Agent SDK options or a slash command in the chat's own session ([decision 0001](../decisions/0001-official-claude-access-only.md)).
2. Fast mode, output style and the Claude Code advisor go in one `settings` object, built by `chatSettings`.
3. A goal clears when Claude Code reports it cleared (`active_goal` with no value), when the person sends `/goal clear`, or when a turn finishes successfully. Claude Code only ends a turn under a goal once the goal is resolved.
4. A spend cap of 0 or empty means no cap. A chat's cap overrides the Settings default.

## Design

- `src/main/claudeOptions.ts`: `permissionMode`, `chatSettings`, `budgetFor`, `goalCommand`, `goalFrom`, `applyTaskEvent`, `listOutputStyles`.
- `src/main/agent.ts`: passes `permissionMode`, `settings`, `maxBudgetUsd`, handles `active_goal` and `task_*` messages, and emits `tasks` with chat events. `stopTask` calls the query's `stopTask`.
- `Chat` adds `fast`, `budgetUsd`, `outputStyle` and `goal`. `Settings` adds `defaultBudgetUsd`. `Effort` adds `xhigh` and `max`. `Permission` adds `auto`.
- IPC: `listOutputStyles(wsId)` and `stopTask(chatId, taskId)`.
- Renderer: `Composer.tsx` (Goal, tasks, Session and Output style sections), `RightTabs.tsx` (the /code-review button), and `review.ts` (`reportedFindings`).

## Compliance, privacy and security

All Claude Code features run in the person's own Claude Code session. Auto mode's classifier calls are billed as Claude Code describes in its [auto mode docs](https://code.claude.com/docs/en/auto-mode-classifier-billing).

## Testing

`test/claudeOptions.test.ts` and `test/remote.test.ts`.
