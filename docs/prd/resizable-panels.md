# PRD: Resizable sidebar and right panel

| | |
|---|---|
| Status | In review |
| Owner | Claude (cloud thread "Make side panes resizable and expandable") |
| Requested by | Ben, 2026-11-13 |
| Last updated | 2026-11-13 |

## Problem

The sidebar was always 280px and the right panel always 420px. Long workspace names were cut off, and the right panel (Changes, Checks, Review, add-on tabs, Usage) was too narrow for diffs and graphs. The only control was show or hide. Ben asked: "Can we make the right pane expandable and adjustable? Presumably the left pane as well."

## Goals

- Drag either panel's inner edge to size it, and have the size stick across restarts.
- Give the right panel the whole chat area for a while, and put it back quickly.

## Non-goals

- Expanding the sidebar to full width (a wider list shows nothing new).
- Per-workspace or per-layout widths. One width each, app-wide.
- Side-by-side diffs (separate work).

## User experience

- Hovering a panel's inner edge shows an accent line and a col-resize cursor; the tooltip says "Drag to resize · double-click to reset · drag far … to hide".
- While dragging, a pill shows the width in pixels. Dragging more than 80px past the minimum dims the panel and the pill says "Release to hide"; letting go hides it, the same as ⌘B or ⌘⌥B. The saved width is kept for when it comes back.
- Double-click an edge to go back to the default width.
- The right panel header (workspace and orchestrator alike) has an Expand button (⤢). Expanded, the right panel fills everything right of the sidebar and the chat panes fold into a 34px strip with the chat's title; clicking the strip, the ⤡ button, ⌘⇧E (View › Expand Right Panel) or Esc puts it back. Esc is ignored while typing in a field or terminal or while a modal is open. ⌘B still hides the sidebar for a full-window view.

## Requirements

1. Sidebar width 200–480px, default 280.
2. Right panel width from 320px to whatever leaves 420px for the chat, default 420; it shrinks with the window and grows back.
3. Widths are saved in Settings (`sidebarWidth`, `rightWidth`) when a drag ends.
4. Expanding keeps the chat panes mounted (hidden), so chats, terminals and add-on frames keep their state.
5. Hiding the right panel (⌘⌥B) also ends expanded mode.

## Design

- `src/shared/panelWidths.ts`: limits and the clamp and snap rules (tested in `test/panelWidths.test.ts`).
- `src/renderer/src/components/PanelEdge.tsx`: the handle. It sizes the panel element directly during a drag (no store writes per move) and calls back once at the end.
- `Sidebar.tsx` and `RightPanel.tsx` (`RightAside`, `ExpandButton`) read the saved widths. `store.ts` adds `rightExpanded`, `savePanelWidth`, `toggleRightExpanded`. `App.tsx` hides the panes and draws `ChatStrip` when expanded. The main menu adds Expand Right Panel (⌘⇧E).

## Compliance, privacy and security

UI only. Nothing leaves the machine.

## Testing

Unit tests for the width rules. Checked in the built app under Playwright + xvfb: drag both edges, double-click reset, drag to hide, expand and restore with button, strip, ⌘⇧E and Esc.

## Rollout

On for everyone. Existing settings have no widths, so the panels start at today's sizes.

## Future work

- Side-by-side diffs when the right panel is wide.
