# PRD: Extra agents and advisor

| | |
|---|---|
| Status | Shipped (PR #10) |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-06 |

## Problem

Ben asked whether [oh-my-pi](https://github.com/can1357/oh-my-pi) could be a Choo Choo backend powered by a Claude subscription. It can't, compliantly (see [decision 0002](../decisions/0002-no-oh-my-pi-backend.md)). But its specialist agents (fast scout, strict reviewer, security reviewer, quick worker, advisor) are useful and can run on the official Agent SDK.

## Goals

- Offer oh-my-pi's agents inside Choo Choo, on the same sign-in as the main agent.
- Keep the default experience identical to Conductor: everything is off until turned on.

## Non-goals

- Any oh-my-pi runtime, login or provider code.

## User experience

Settings > Agents has a toggle per agent, plus the advisor and its model.

- **Scout** (Haiku, read-only search): used for research in plan mode; `@scout` in the composer.
- **Reviewer** (Opus): the Review tab uses its stricter rules. "Review before opening a PR" (default on when the reviewer is on) has Create PR run it first and stop on P0/P1 findings. `@reviewer`.
- **Security reviewer**: adds a Security review button to the Review tab; findings show as cards in its own review chat and inline in diffs.
- **Quick worker** (Haiku): `/quick <task>` hands mechanical work to it.
- **Advisor**: after each finished turn, a second model (Sonnet by default) reviews it with read-only tools and posts notes as a card with Send to agent and Dismiss. Per-chat toggle in the composer. A red dot in the sidebar marks a workspace with an unhandled blocker. Optional auto-send of blockers, at most once per message (off by default; Ben chose opt-in).
- **Claude Code advisor** (added 2026-11-06): Claude Code's own [advisor tool](https://code.claude.com/docs/en/advisor). A select in Settings > Agents: "Use my Claude Code setting" (default, keeps `advisorModel` from the user's settings), Off, Fable, Opus or Sonnet. Claude chats only. Claude decides when to consult it mid-turn (before choosing an approach, when stuck, before declaring done); each call shows as an "Advisor" line that expands to the guidance when the advisor model returns readable text. It sits beside the ported advisor rather than replacing it: the ported one reviews after every turn, works for Codex too, and shows its notes; the built-in one steers during the turn, needs the Anthropic API (not Bedrock/Vertex/Foundry) and a supported main model, and newer advisor models keep their guidance private.
- Subagent calls show as one collapsible card per agent with its steps inside.

## Requirements

1. All agents are Agent SDK subagents or SDK queries; they use the user's Claude Code login or API key.
2. All off by default (`DEFAULT_EXTRAS`); older saves are filled in by `normalizeExtras`.
3. Read-only agents get read-only tool lists and a read-only rule in their prompt.
4. Prompts adapted from oh-my-pi keep its MIT notice (file header and THIRD_PARTY_NOTICES.md).

## Design

The Claude Code advisor is `claudeAdvisorOptions` in `src/main/extras.ts`: a model choice goes in the query's `settings.advisorModel`, Off sets `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`. `server_tool_use` blocks named `advisor` and their `advisor_tool_result` become a tool item named `Advisor`, drawn by `BuiltinAdvisorItem` in `ChatView.tsx`.

`src/main/extras.ts` (`SUBAGENTS`, advisor), `src/shared/agentRules.ts` (review criteria and security rules shared by subagents and the Review tab), `Extras` in `src/shared/types.ts`. Also added: Settings > Claude Code to choose the bundled or installed `claude` binary (`src/main/claudeBinary.ts`).

## Testing

`test/extras.test.ts`, `test/review.test.ts`.
