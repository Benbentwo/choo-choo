# PRD: Usage history and the Usage page

| | |
|---|---|
| Status | In review |
| Owner | Claude |
| Requested by | Ben, 2026-11-12 |
| Last updated | 2026-11-13 |

## Problem

> Is it possible to keep track of historically your Claude subscription usage to show a more advanced usage dashboard if you want to look at it?

The sidebar shows where each plan window stands now, with a graph of the current window. Choo Choo kept 9 days of readings and nothing else, so there was no way to see how often you hit limits, which work used your plan, or when you work hardest.

## Goals

- See plan window usage (5-hour, weekly) over days, weeks and months, with every limit hit marked.
- See where usage went: by repo, project and folder, by model, and by hour of the week.
- Click a limit hit to see what filled that window, down to the chat.
- Use only data Claude Code already gives us, and keep it on the Mac.

## Non-goals

- Exact per-message share of a window. Claude doesn't report it; shares are estimates and say so.
- Usage from claude.ai or other computers, beyond showing the part of a window nothing on this Mac explains.
- Codex token history (Codex window readings are included).

## User experience

**Usage** in the sidebar nav (under Up next) opens a page with:

- Range: 24h, 7 days (default), 30 days, 90 days, All. Claude / Codex switch when Codex readings exist. Export CSV.
- Tiles: weekly window now, limit hits in range, time spent at a limit, API-equivalent value with response and chat counts.
- **Plan windows**: 5-hour and weekly percent over time, cap line, weekly reset lines, ▲ at each limit hit (clickable), gaps where Choo Choo was closed, crosshair tooltip.
- **Where it went**: share of API-equivalent cost by project, repo, or folder outside Choo Choo; top 6 plus Other.
- **By model**: stacked bars per hour, day or week (by range).
- **Busiest hours**: weekday by hour heatmap in local time.
- **Limit hits**: table; a row opens the window.

**Window view**: tiles (when it hit, how long you waited, chats, cost by model), a stacked area of the window's estimated share by where it was used with the waiting period dimmed, a table of chats by share, and Previous/Next window.

Settings › Usage history: Keep usage history (on), Keep for 3/6/12/24 months (12).

Empty states: no readings in range ("Choo Choo saves one every 2 minutes while it's open"), no responses, no hits, no readings in a window.

## Requirements

1. Save every plan window reading the footer takes (`limits.ts` `record()`), when it moved by 0.5 points, its reset time changed, or 15 minutes passed. Never save a reading older than the last one for its window.
2. Copy a summary of each Claude Code response from `~/.claude/projects/**/*.jsonl` (and `subagents/`): time, message id, session id, folder, model, input / cache write / cache read / output tokens, subagent flag. Never message text.
3. Sync 15 seconds after launch, every 15 minutes, and when the Usage page loads. Read only new bytes of each transcript, whole lines only. The first sync copies everything Claude Code still has.
4. Store by month as JSONL under `<userData>/data/usage/`; delete months older than the keep setting at launch.
5. Count a limit hit at the first reading at 100% of each window period (told apart by reset time).
6. Attribute a response by its session's chat (workspace → project or repo), then by folder (longest workspace or repo path), else "Outside Choo Choo · <folder>".
7. Weight models by API list price ("API-equivalent"), so an Opus response counts more than a Haiku one.
8. Window view: split each rise between two readings across the responses since the previous rise, by cost. A rise with none goes to "Not on this Mac".
9. Charts follow the data-viz rules: one axis, fixed categorical order, legend plus direct labels, status red only for the cap and hits, hover tooltips.

## Design

- `src/shared/usageHistory.ts`: types, prices, `findHits`, `buildDashboard`, `windowDetail`, `usageCsv`.
- `src/main/usageHistory.ts`: storage, `recordReading`, `syncTranscripts`, `attributor` from app state.
- IPC: `usage:dashboard`, `usage:window`, `usage:csv` (`Api.usageDashboard`, `usageWindow`, `exportUsageCsv`).
- UI: `src/renderer/src/components/UsagePage.tsx`; `usagePage` flag in the store; Settings section `usage` in `Modals.tsx`.
- See [decision 0020](../decisions/0020-usage-history-local-estimates.md).

## Compliance, privacy and security

- Claude data comes from Claude Code's own `/usage` (through the Agent SDK) and its local transcripts; no tokens read, no extra requests ([0001](../decisions/0001-official-claude-access-only.md)).
- Nothing leaves the machine. Stored summaries hold no prompt or reply text; folder paths and session ids only.

## Testing

`test/usageHistory.test.ts`: prices, dedupe, hits, dashboard grouping/buckets/heat, Other folding, window split with "Not on this Mac", CSV, reading dedupe, incremental transcript sync (partial lines, subagents, no text stored), attribution.

## Rollout

On by default. History starts at the first launch with this build; responses back to whatever Claude Code still keeps (30 days by default).

## Open questions

- Should the Projects filter on the page narrow every chart to one project?

## Future work

- Owner-of-window hints in the footer graph ("most of this window: webapp").
- Codex token history from its rollout logs.
