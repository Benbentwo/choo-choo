# PRD: Comment mode

| | |
|---|---|
| Status | Shipped, dev builds only (PR #12) |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-06 |

## Problem

Iterating on UI with an agent is slow when you have to describe which element you mean. Pointing at it is faster. Screenshots work best for Ben's input; Claude can't watch video.

## Goals

- In `npm run dev`, click any element, type a note, and a Claude Code session working on the repo picks it up with full context.

## Non-goals

- Shipping this in release builds.
- Sending comments anywhere but the local checkout.

## User experience

1. `npm run dev`.
2. Open Claude Code in the repo and say "watch for my comments".
3. Press ⌘⇧K (or click the Comment pill), click an element, type, press Enter.

Claude makes the change and moves the comment to `.feedback/done/`. Renderer edits hot-reload; main or preload edits restart the app.

## Requirements

1. Each comment writes `.feedback/<id>.json` (comment, CSS selector, React component chain, element text, rect, window size), `<id>.element.png` (element plus 24px padding) and `<id>.full.png`.
2. The JSON is written last; its appearance signals the comment is complete.
3. `.feedback/` is gitignored.
4. The IPC handler is not registered in packaged builds (`app.isPackaged`).

## Design

`src/main/devFeedback.ts`, `src/renderer/src/dev/FeedbackOverlay.tsx`, `scripts/watch-feedback.sh` (prints one line per new comment; `--all` includes existing ones). Agent instructions are in `CLAUDE.md`.
