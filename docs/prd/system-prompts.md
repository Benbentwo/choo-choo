# PRD: Custom system prompts

| | |
|---|---|
| Status | In review (PR #32) |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-06 |

## Problem

People want to add standing instructions to every agent, or to agents in one repo, and sometimes replace Claude Code's prompt entirely. See the Agent SDK guide on [modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts).

While building this we found that chats were running with an **empty** system prompt: the SDK sends `""` when the `systemPrompt` option is omitted, so agents lacked Claude Code's tool guidance and safety rules unless plan mode with the scout was on.

## Goals

- Global and per-repo prompts, each either added to Claude Code's prompt or replacing it.
- Every chat always gets Claude Code's preset unless the person explicitly replaces it.

## Non-goals

- Changing the orchestrator's prompt (it keeps its own).
- Per-chat prompts.

## User experience

Settings > Prompts: one editor for all repos and one per repo, each with a mode: **Add to Claude Code's prompt** (default) or **Replace Claude Code's prompt** (with a warning). Changes apply to new chats, since a session's prompt is fixed on its first request.

## Requirements

1. Precedence: a repo *replace* wins outright. A global *replace* is the base, with repo text after it. Otherwise the `claude_code` preset is the base with global text, then repo text, then the app's own hints appended.
2. A replacement prompt gets a one-line note that system reminders (such as CLAUDE.md) are app context, as the SDK docs recommend.
3. Chats always pass a `systemPrompt` option.

## Design

`src/shared/systemPrompt.ts` (`buildSystemPrompt`, `REMINDER_NOTE`), `PromptCustom` on `Settings.systemPrompt` and `Repo.systemPrompt`, `api.setRepoPrompt`. Called from `agent.ts`.

## Testing

`buildSystemPrompt` tests in `test/extras.test.ts`.
