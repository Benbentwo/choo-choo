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
- **Security reviewer**: adds a Security review button to the Review tab; findings show in the same list and inline in diffs, tagged "security".
- **Quick worker** (Haiku): `/quick <task>` hands mechanical work to it.
- **Advisor**: after each finished turn, a second model (Sonnet by default) reviews it with read-only tools and posts notes as a card with Send to agent and Dismiss. Per-chat toggle in the composer. A red dot in the sidebar marks a workspace with an unhandled blocker. Optional auto-send of blockers, at most once per message (off by default; Ben chose opt-in).
- Subagent calls show as one collapsible card per agent with its steps inside.

## Requirements

1. All agents are Agent SDK subagents or SDK queries; they use the user's Claude Code login or API key.
2. All off by default (`DEFAULT_EXTRAS`); older saves are filled in by `normalizeExtras`.
3. Read-only agents get read-only tool lists and a read-only rule in their prompt.
4. Prompts adapted from oh-my-pi keep its MIT notice (file header and THIRD_PARTY_NOTICES.md).

## Design

`src/main/extras.ts` (`SUBAGENTS`, advisor), `src/shared/agentRules.ts` (review criteria and security rules shared by subagents and the Review tab), `Extras` in `src/shared/types.ts`. Also added: Settings > Claude Code to choose the bundled or installed `claude` binary (`src/main/claudeBinary.ts`).

## Testing

`test/extras.test.ts`, `test/review.test.ts`.
