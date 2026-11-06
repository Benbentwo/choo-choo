# PRD: Review plan

| | |
|---|---|
| Status | In review (PR #38) |
| Owner | Claude |
| Requested by | Ben, 2026-11-06 ("consider how this link might be helpful": Google's Elephant-Goldfish Model) |
| Last updated | 2026-11-06 |

## Problem

In plan mode, the agent that writes the plan has the whole chat in context. It stops noticing what it knows but never wrote down, so plans carry unstated assumptions, vague steps and references to code that works differently. These surface only once code is being written. The [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) fixes this by having reviewers with no history (goldfish) read the spec the full-context agent (elephant) wrote.

## Goals

- One click on a plan card gets independent findings from reviewers who saw only the plan and the repo.
- Findings go back to the planning agent in one click, and it revises the plan.

## Non-goals

- EGM's brainstorm, draft and multi-stage design-doc pipeline, and its README bootstrap.
- Automatic review of every plan. It costs three Opus runs, so it's on demand.
- Reviewing code diffs: the Review tab and the reviewer agent already do that.

## User experience

1. In plan mode, the agent presents a plan card with **Approve and build**. Next to it is **Review plan**.
2. Clicking it shows "Fresh reviewers who haven't seen this chat are reading the plan…". The button reads "Reviewing…" and is disabled.
3. A card titled **Plan review** lists findings, each tagged with its reviewer (Design, Readiness, Codebase), with blockers marked.
4. **Revise the plan** sends the findings to the agent as the user's message. The agent revises and presents a new plan card, which can be reviewed again. **Dismiss** greys the card out.
5. If no reviewer finds anything, a one-line "No concerns from 3 fresh reviewers" appears. Failures show as one line too.

## Requirements

1. Reviewers get only the plan text: no chat history, CLAUDE.md, memory or plugins (`settingSources: []`).
2. Reviewers are read-only (`Read`, `Grep`, `Glob`) and run in the workspace directory.
3. Three reviewers run in parallel: design, implementation readiness and codebase fit.
4. A plan card can be reviewed once, and only one review runs per chat at a time.
5. Stopping the chat stops a running review.

## Design

- [src/main/planReview.ts](../../src/main/planReview.ts): reviewer prompts, `reviewPlan()` runs them with the Agent SDK and merges the findings (`combineFindings`), and `revisePlanMessage()` builds the follow-up message.
- [src/main/agent.ts](../../src/main/agent.ts) `reviewPlan()`: stores the result as an `advisor` chat item with `source: 'planReview'` and `planItemId`, reusing the advisor card and `advisor:act`.
- IPC: `plan:review` → `Api.reviewPlan(chatId, planItemId)`.
- UI: `PlanItem` and `AdvisorItem` in [ChatView.tsx](../../src/renderer/src/components/ChatView.tsx).

## Compliance, privacy and security

- Runs on the official Agent SDK and the Claude Code binary with the user's own sign-in ([0001](../decisions/0001-official-claude-access-only.md)).
- The plan text goes through `redactSecrets` before reviewers see it. Nothing leaves the machine beyond the Claude calls.
- The prompts are adapted from EGM (Apache 2.0) and credited in THIRD_PARTY_NOTICES.md.

## Testing

`test/plan-review.test.ts` covers merging findings, failures and the revise message. Manual check: plan-mode chat → Review plan → Revise the plan.

## Rollout

Always available, with no setting. Old saves need no migration because the new item fields are optional.

## Open questions

- Should the reviewer model follow the advisor model setting instead of always using Opus?

## Future work

- Drift check: compare the orchestrator's memory and docs against the code during Archive and reflect, using EGM's drift-report idea.
