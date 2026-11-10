# PRD: Subscription limits in the sidebar

| | |
|---|---|
| Status | Shipped (PR #75); graph in review |
| Owner | Claude |
| Requested by | Ben, in-app comment, 2026-11-10 |
| Last updated | 2026-11-10 |

## Problem

> Let's expand this box a little bit to have a little bit of vertical room where we show the limits of your AI subscriptions. If you're using just one AI, it'll just show that constantly. But if you're using multiple, like Codex and Claude, it'll, on a five or something, kind of switch between the two, fading between them.

## Goals

- See at a glance how much of each plan's usage windows (5-hour, weekly, per-model weekly) is used, and when each resets.
- One subscription shows all the time. Two (Claude and Codex) fade between each other every 5 seconds.

## Non-goals

- Limits for API-key billing, Bedrock or Vertex, which have no plan windows.
- Any new sign-in. Only what Claude Code and the Codex CLI already know is shown.

## User experience

The sidebar footer gains a block above "Choo Choo": the provider and plan (e.g. "Claude Max"), then up to three windows, each with a bar, percent used and time until reset. Bars turn amber at 70% and red at 90%. With two providers, dots show which one is visible. Hovering pauses the rotation and clicking skips to the next. Nothing shows when no limits are known.

### Graph (Ben, 2026-11-10)

> Let's have time on the X-axis, Y-axis being your usage... a vertical dotted line of when your reset is and a horizontal line for where the cap is. And then maybe some text on whether you're on track or not... I would like a gradient graph.

The footer card shows a small gradient area graph for the provider's first window that has a reset time, with one line of pace text under it. Clicking the card opens a larger card with a graph and pace text for every window. In each graph:

- **X axis:** the window, from its start (reset time minus window length) to just past reset.
- **Y axis:** percent used.
- **Lines:** a red dashed line at the cap (100%), a dotted vertical line at reset, a faint dotted diagonal for an even pace, and a dashed line projecting the current rate.
- **Pace text:** "On track", "Ahead of pace: at this rate you hit the cap <when>, before it resets <when>", or "At the cap". The rate comes from readings over the last quarter of the window when they cover at least a twentieth of it, otherwise from the average since the window started.
- **History:** Codex history comes from its logs. Claude only reports the current number, so Choo Choo records readings in `limits-history.json` in its data folder, keeping 9 days. A Claude graph fills in from the first launch onward.

## Requirements

1. Claude: read through the Agent SDK's `/usage` data (`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`, behaviors skipped). If the method is missing or fails, Claude is just left out.
2. Codex: read the newest `rate_limits` snapshot from `~/.codex/sessions/**/rollout-*.jsonl`. Ignore snapshots older than 8 days, and count windows whose reset time has passed as 0%.
3. Refresh on launch, every 2 minutes, and when any chat finishes a turn. The main process caches for 1 minute.

## Design

`src/main/limits.ts` (`subscriptionLimits`, IPC `limits:get`), `src/renderer/src/components/LimitsFooter.tsx`. Tests: `test/limits.test.ts`.

## Compliance, privacy and security

- Claude access uses the official Agent SDK and Claude Code binary with the user's own sign-in ([decision 0001](../decisions/0001-official-claude-access-only.md)). No tokens are read or stored.
- Codex data comes from local log files the CLI already writes. Nothing leaves the machine.

## Open questions

- The Claude call relies on an SDK method marked experimental. If it changes, switch to the stable name, or to `rate_limit_event` messages from agent turns.
