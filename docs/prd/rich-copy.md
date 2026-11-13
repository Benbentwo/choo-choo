# PRD: Rich copy from chat

| | |
|---|---|
| Status | Shipped |
| Owner | Ben |
| Requested by | Ben, 2026-11-12 |
| Last updated | 2026-11-13 |

## Problem

Copying Claude's replies out of a chat and pasting into Notion, Google Docs or Slack either lost structure (plain text) or dragged the app's dark-theme classes and inline styles along, so tables, headings and code blocks pasted badly.

## Goals

- Copy part of a reply and paste it into a doc tool with its headings, lists, links, code and tables intact, styled by the destination.

## Non-goals

- A "Copy as Markdown" command or per-message copy buttons.
- Changing copy anywhere outside chat text (diffs, terminal, sidebar, inputs).

## User experience

Select text in a reply and press ⌘C. Nothing else changes: plain-text targets still get the same text, rich targets get clean HTML.

## Requirements

1. When the selection touches chat text (`.prose-chat`), put clean HTML on the clipboard as `text/html` and the selection's text as `text/plain`.
2. Clean HTML has no classes, inline styles, buttons or SVGs; only `href`, `colspan`, `rowspan` and `start` attributes survive; wrapper `div`/`span` elements are unwrapped.
3. A selection that starts and ends inside one table (rows or cells, not inside a single cell) is wrapped back in its `table`/`tbody`/`tr` so it pastes as a table.
4. Selections outside chat text, and copies from inputs, textareas and editable fields, use the browser's default copy.

## Design

`src/renderer/src/richCopy.ts` installs one document `copy` listener from `main.tsx` (main window only, not the add-on background window). `selectionHtml()` clones each selected range, re-wraps table fragments and strips styling.

## Compliance, privacy and security

- No Claude access, sign-in or network use. Data only goes to the system clipboard on the user's own copy.

## Testing

`test/richCopy.test.ts` (jsdom): styling stripped, links and code kept, table rows re-wrapped, non-chat selections left alone. Manual: paste a reply with a table into Notion.

## Rollout

Always on; no setting.

## Open questions

- None.

## Future work

- A "Copy as Markdown" item in the message menu.
