# 0020: Usage history stays local, and per-workspace shares are estimates

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Decided by | Ben (feature), Claude (mechanism) |

## Context

Ben asked for a history of his plan usage and a dashboard. Claude Code reports a window's percent (`/usage`) but only for now, and its transcripts carry per-response tokens but are deleted after 30 days by default. Nothing reports how much of a window one response used.

## Decision

Choo Choo keeps its own history on the Mac: window readings while it runs, and a summary of each response copied from Claude Code's transcripts (no text). It shows per-workspace and per-chat shares of a window as estimates, splitting each reading's rise across recent responses by API-list-price cost, and labels any rise it can't explain as "Not on this Mac".

## Consequences

- History outlives Claude Code's transcript cleanup, and needs no server or extra request.
- Readings exist only while Choo Choo is open; the charts show those gaps instead of filling them.
- Shares can be off when the server's accounting differs from list-price weighting; the UI says they are estimates.

## Alternatives considered

- **Read windows from claude.ai or an Anthropic usage API**: not available for subscriptions, and reaching into claude.ai would break [0001](0001-official-claude-access-only.md).
- **Show only token counts**: tokens across models aren't comparable; price weighting is closer to how windows fill.
- **Store full transcripts**: more than the dashboard needs, and holds message text.
