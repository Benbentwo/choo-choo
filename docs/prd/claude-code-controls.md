# PRD: Claude Code session controls

| | |
|---|---|
| Status | Shipped (PR #49) |
| Owner | Claude (project thread) |
| Requested by | Ben, 2026-11-06 ("Quick wins, then managers" from the Claude Code docs survey) |
| Last updated | 2026-11-24 |

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
- **Questions from Claude.** When Claude calls `AskUserQuestion`, the chat shows a question card under every permission setting, Full access included: each question with its options as buttons (checkboxes when several can be picked) and an "Other" box. One single-choice question answers on a click; otherwise Submit sends them all. The picks go back to Claude as the tool's `answers`. Skip, or sending a chat message instead, tells Claude the question went unanswered.
- **Goal.** A Goal button next to Plan opens a "Keep going until…" field. Start sends `/goal <condition>`, and Claude keeps taking turns until a separate model judges the condition met. While a goal is active, a "◎ Goal" row above the composer shows the condition, the number of checks, and the latest reason on hover, with a Clear button when idle. Typing `/goal …` yourself works the same way.
- **Model switch divider.** Picking another model in a chat that already has messages draws a rule across the chat: "Switched to model Sonnet 5.5". Switching again before sending updates it; switching back removes it. When the next turn starts, the model Claude Code reports (e.g. `claude-sonnet-5-5`) is added to the rule. If Claude Code reports a different model without a pick (an alias now points at a newer model), a rule appears then too.
- **Effort.** Low, Medium, High, Extra high and Max. Codex gets xhigh for Max.
- **Fast mode.** A toggle in the model menu's Session section. The model button shows "· fast".
- **Spend cap per message.** A number in the model menu, with a default in Settings > General. A run that hits it stops with a message saying so.
- **Compact conversation.** Sends `/compact`.
- **Output style.** Settings > Prompts > Output style sets the style for every Claude chat: Claude Code's setting (the default: whatever `~/.claude/settings.json` says), Default, each style Claude Code reports (its built-ins, such as Concise, Explanatory, Learning and Proactive, plus styles from plugins and `~/.claude/output-styles`), or Custom, which shows a box for your own prompt. Custom runs on top of Claude Code's Default style and adds the prompt to the end of the system prompt under "# Output style". The model menu's Output style section lets one chat pick its own: Settings default (shows which), Default, the same styles plus the repo's `.claude/output-styles`, and Custom when a custom prompt is saved. A change applies from a chat's next message.
- **Claude Code /code-review.** A button in the Review tab runs Claude Code's built-in review skill. Findings it reports with its ReportFindings tool show in the Review list and inline in diffs. CONFIRMED findings count as high and PLAUSIBLE ones as medium.
- **Background tasks.** While a turn runs, background shells, subagents and workflows are listed above the composer with their latest progress and a Stop button.

## Requirements

1. Every feature goes through the Agent SDK options or a slash command in the chat's own session ([decision 0001](../decisions/0001-official-claude-access-only.md)).
2. Fast mode, output style and the Claude Code advisor go in one `settings` object, built by `chatSettings`.
3. A goal clears when Claude Code reports it cleared (`active_goal` with no value), when the person sends `/goal clear`, or when a turn finishes successfully. Claude Code only ends a turn under a goal once the goal is resolved.
4. A spend cap of 0 or empty means no cap. A chat's cap overrides the Settings default.
5. A message sent while Claude is working goes into the running turn's streaming input. Settings > General "Messages sent while Claude works" picks how: Steer (default) sends it with priority `next`, so Claude Code folds it in at the next tool step; Queue sends it with priority `later`, so it runs as its own turn afterwards. The turn's input stays open while Claude Code reports queued sends (`queued_turn_count`). When the turn can't take a message (Codex, or the turn is ending), it waits and is sent when the turn finishes.
6. A chat's output style wins over the Settings one. With neither, Choo Choo passes no style, so Claude Code's own setting applies. Custom with an empty prompt behaves like no style.
7. The style list comes from Claude Code (`available_output_styles` from an idle session started with user settings, once per launch), so new built-in and plugin styles show up without an app change. When Claude Code can't be asked, the list falls back to Explanatory and Learning.

## Design

- `src/main/claudeOptions.ts`: `permissionMode`, `questionReply`, `chatSettings`, `budgetFor`, `goalCommand`, `goalFrom`, `applyTaskEvent`, `listOutputStyles`. `src/shared/outputStyle.ts`: `resolveOutputStyle` (chat over Settings, Custom to `default` plus appended text). `src/main/models.ts`: `cliOutputStyles`.
- `src/main/agent.ts`: passes `permissionMode`, `settings`, `maxBudgetUsd`, handles `active_goal` and `task_*` messages, and emits `tasks` with chat events. `stopTask` calls the query's `stopTask`.
- `src/shared/modelSwitch.ts`: `onModelPicked` (from `chat:update`) and `onModelReported` (from the `system`/`init` message's `model`) add, update or drop the `model` chat item. `Chat.reportedModel` keeps the last reported model.
- `Chat` adds `fast`, `budgetUsd`, `outputStyle` and `goal`. `Settings` adds `defaultBudgetUsd`, `outputStyle` and `outputStyleCustom`. `Effort` adds `xhigh` and `max`. `Permission` adds `auto`.
- IPC: `listOutputStyles(wsId?)` (no workspace: Settings, without repo styles) and `stopTask(chatId, taskId)`.
- Renderer: `Composer.tsx` (Goal, tasks, Session and Output style sections), `Modals.tsx` (`OutputStyleSetting` in Settings > Prompts), `RightTabs.tsx` (the /code-review button), and `review.ts` (`reportedFindings`).

## Compliance, privacy and security

All Claude Code features run in the person's own Claude Code session. Auto mode's classifier calls are billed as Claude Code describes in its [auto mode docs](https://code.claude.com/docs/en/auto-mode-classifier-billing).

## Testing

`test/claudeOptions.test.ts`, `test/remote.test.ts` and `test/modelSwitch.test.ts`.
