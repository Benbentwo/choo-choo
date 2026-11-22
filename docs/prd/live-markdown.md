# PRD: Live Markdown in the message box

| | |
|---|---|
| Status | Shipped (PR #132) |
| Owner | Claude (project thread "Format markdown live in the prompt box") |
| Requested by | Ben, 2026-11-16 |
| Last updated | 2026-11-16 |

## Problem

The message box was a plain textarea, so Markdown only looked like Markdown after Claude read it. Ben: "If you use backtick, type something, and then backtick again, it should format it for you so you can preview what it's going to look like." Slack and Linear do this; it catches a missing backtick or asterisk before sending.

## Goals

- Format GitHub-flavored Markdown in place as it's typed: `inline code` once the closing backtick is in, **bold**, *italic*, ~~strikethrough~~, links, ``` code blocks, lists, quotes and headings.
- The text sent is exactly what was typed: plain Markdown. Formatting is only how it looks.
- Sent messages in the chat look the way the box showed them.
- Everything the box did before keeps working: @mentions, /commands, pasted and dropped images, spellcheck suggestions on right-click, Enter to send, Enter inside an open ``` block adds a line, ⌘Enter sends from anywhere, ⇧Tab plan mode, queued and steered messages, drafts per chat.

## Non-goals

- A separate preview pane or a rich-text editor that converts Markdown into something else.
- Tables, images and HTML rendering inside the box (they stay plain text).

## User experience

Type in the chat's message box (or the New workspace box). Closed spans format at once. While the caret is inside a span its syntax characters (backticks, asterisks, a link's `](url)`) show again, dimmed, so they can be edited; move away and they hide. Code blocks get a dark monospace background including their fence lines; list markers turn the accent color; quotes get a left rule; headings get bigger and bold.

Keys: Enter sends; ⇧Enter adds a line and continues a list (`- `, `1. `); Backspace on an empty list item removes the marker; ⌘B, ⌘I and ⌘E wrap the selection in `**`, `*` or a backtick; ⌘Z / ⇧⌘Z undo and redo.

## Requirements

1. The value of the box is the typed text, unchanged; `sendMessage` gets it as before.
2. Inline code, bold, italic, strikethrough and links format only once closed.
3. Syntax characters hide when the caret is outside their span and show dimmed when inside or when selected.
4. Code block lines (including an unclosed block, which runs to the end) render monospace on a code background; nothing inside a code block is formatted as Markdown.
5. `[WIP]` and other bracketed text that isn't a link stays plain.
6. The user's sent message shows the same formatting, with bare URLs and GitHub link pills as before.
7. @mention and /command autocomplete, image paste/drop, spellcheck menu, Enter/⌘Enter/⇧Tab/Esc behave as before.

## Design

- `src/renderer/src/components/MarkdownInput.tsx`: a CodeMirror 6 editor (`@codemirror/view`, `state`, `commands`, `lang-markdown`) with the GFM Markdown parser, history, line wrapping and `spellcheck="true"` on the content element, so Electron's existing context-menu handler (`editMenuItems`) offers suggestions. A view plugin turns spans from `livePreviewSpans` into decorations; hidden syntax is `Decoration.replace` and is atomic for the arrow keys. Paste and drop of image files go to the composer, not into the text.
- `src/renderer/src/livePreview.ts`: pure functions over the Lezer syntax tree. `livePreviewSpans(state, selection)` returns marks, hidden ranges and line classes; `formatMessage(text)` uses the same spans to render a sent message (`FormattedUserText` in `GithubLink.tsx`, used by `ChatView`).
- `Composer.tsx` and `NewWorkspace.tsx` use `MarkdownInput` in place of their textareas. The composer's key handling is unchanged in substance; it reads the caret from the editor.
- The editor's content element carries `data-testid="composer-input"` (chat) or `new-workspace-input` (New workspace) for the demo recorder.

## Compliance, privacy and security

No change to Claude access or data flows: the same text goes to the same place.

## Testing

`test/livePreview.test.ts` covers spans (closing backtick, caret inside, links vs `[WIP]`, code blocks, unclosed fences) and sent-message formatting. `scripts/demo/record.cjs composer-checks` drives the real app: @mention completion, the /command list, Enter inside a fence, undo/redo, sending, ⌘B. The README GIF is `composer-markdown`.

## Rollout

On for everyone; no setting. Drafts are plain text as before, so nothing migrates.

## Future work

- Paste a URL over selected text to make a link.
- Tables and task-list checkboxes rendered in the box.
