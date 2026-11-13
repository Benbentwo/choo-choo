# PRD: Rich copy from chat

| | |
|---|---|
| Status | Shipped |
| Owner | Ben |
| Requested by | Ben, 2026-11-12 (Slack and links 2026-11-13) |
| Last updated | 2026-11-13 |

## Problem

Copying Claude's replies out of a chat and pasting into Notion, Google Docs or Slack either lost structure (plain text) or dragged the app's dark-theme classes and inline styles along, so tables, headings and code blocks pasted badly.

Slack can't show tables or headings at all: a pasted table runs its cells together and headings become plain lines. Links Claude writes to files in the workspace (`[richCopy.ts](src/renderer/src/richCopy.ts:12)`) only mean something inside the app, so they paste as dead links. And there was no way to copy a link's URL.

## Goals

- Copy part of a reply and paste it into a doc tool with its headings, lists, links, code and tables intact, styled by the destination.
- Paste the same reply into Slack and have it read well: tables as aligned code blocks, headings as bold lines.
- Every link that pastes works: file links open the file on GitHub, bare URLs are links, links with nowhere to go become plain text.
- Right-click a link to copy its URL.

## Non-goals

- A "Copy as Markdown" command or per-message copy buttons.
- Changing copy anywhere outside chat text (diffs, terminal, sidebar, inputs).
- Detecting the paste destination. The clipboard can't know where it will be pasted.

## Decision: a separate Copy for Slack

Notion and Docs want real tables and headings; Slack can't show either. One clipboard payload can't serve both, so ⌘C stays shaped for docs (Notion, Docs, Confluence, email) and **Copy for Slack** is a separate action: Edit › Copy for Slack (⌥⌘C) and the right-click menu on selected chat text. Bold, italics, lists, links, quotes and code are the same in both. Link fixing applies to both.

## User experience

- Select text in a reply and press ⌘C: rich targets get clean HTML, plain-text targets the same text as before.
- Select text and press ⌥⌘C, or right-click › Copy for Slack: tables become code blocks with padded columns, headings bold paragraphs, horizontal rules are dropped and task-list boxes become ☑/☐. The plain-text version is Slack-style (`*bold*`, `_italic_`, `` `code` ``, ``` blocks, `•` bullets, links as `text (url)`) for when Slack takes plain text.
- Right-click a link anywhere in the app: Open Link and Copy Link. Copy Link copies the URL the link would have after pasting (a file link's GitHub URL).

## Requirements

1. When the selection touches chat text (`.prose-chat`), ⌘C puts clean HTML on the clipboard as `text/html` and the selection's text as `text/plain`.
2. Clean HTML has no classes, inline styles, buttons, inputs or SVGs; only `href`, `colspan`, `rowspan` and `start` attributes survive; wrapper `div`/`span` elements are unwrapped.
3. A selection that starts and ends inside one table (rows or cells, not inside a single cell) is wrapped back in its `table`/`tbody`/`tr` so it pastes as a table.
4. Selections outside chat text, and copies from inputs, textareas and editable fields, use the browser's default copy.
5. Links in copied HTML:
   - `http(s)` and `mailto` links are kept; `www.` links get `https://`.
   - Relative and absolute paths inside the workspace become `https://github.com/<owner>/<repo>/blob/<branch>/<path>`, with `:12`, `:12-20` and `#L12` turned into GitHub line anchors; folders (trailing `/`) use `tree`.
   - In-page anchors, other schemes, paths outside the workspace, and any path when the repo isn't on GitHub are unwrapped to plain text.
   - A URL in inline code, or bare in text, becomes a link.
6. Copy for Slack applies 1–5, then replaces tables with `<pre>` text, headings with `<p><b>`, removes `<hr>`, and writes Slack-style plain text.
7. The right-click menu appears only for links and non-empty selections, and not where an element already has its own menu or in text fields.

## Design

`src/renderer/src/richCopy.ts` installs, from `main.tsx` (main window only, not the add-on background window), a document `copy` listener, a `contextmenu` listener and a `copy-slack` menu listener. `selectionCopy(sel, mode)` clones each selected range, re-wraps table fragments, strips styling, fixes links (`fixLinks`) and for Slack reshapes (`slackify`, `slackText`). Copy for Slack writes through main's `clipboard:write` because it runs outside a copy event.

`src/shared/linkHref.ts` `resolveHref()` decides each link's target from a `LinkContext` (GitHub slug, branch, workspace folder). The chat view's root carries `data-workspace-id` and fetches the context through `ws:link-context` when shown, so the synchronous copy handler has it.

Main's `menu:context` builds the native right-click menu; Copy calls `webContents.copy()` so it goes through the same copy handler.

## Compliance, privacy and security

- No Claude access, sign-in or network use beyond the existing cached `git remote` lookup. Data only goes to the system clipboard on the user's own copy.
- Copied links can only be `http(s)` or `mailto`; other schemes are dropped.

## Testing

`test/richCopy.test.ts` (jsdom): styling stripped, links and code kept, table rows re-wrapped, non-chat selections left alone, file links mapped to GitHub, bare and code URLs linked, dead anchors dropped, Slack HTML and text shape, ⌘C still keeps tables for Notion. `test/linkHref.test.ts`: link resolution rules. Manual: paste a reply with a table and a file link into Notion with ⌘C and into Slack with ⌥⌘C.

## Rollout

Always on; no setting.

## Open questions

- File links point at the workspace's branch; if the branch was never pushed they 404 until it is.

## Future work

- A "Copy as Markdown" item in the message menu.
