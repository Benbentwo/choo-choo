# PRD: Markdown preview diffs and syntax-colored diffs

| | |
|---|---|
| Status | Shipped (PR #137); Mermaid diagrams (PR #145) |
| Owner | Choo Choo maintainers |
| Requested by | Ben, 2026-11-18 |
| Last updated | 2026-11-20 |

## Problem

A change to a Markdown file (a README, a plan, a doc) is hard to review as raw source: you read `##`, `**` and table pipes instead of the document. GitHub's rich diff shows the rendered file but you can't comment on it there. Ben: "We need a preview diff for Markdown files. Ideally, you could still comment on the Markdown-styled view of the files. This is something GitHub can't do."

Code diffs were also drawn in a single color, so the green and red rows lost the syntax colors you get everywhere else. Ben: "It'd be nice to be able to have code coloring even with the green-red background of the diff view."

## Goals

- Markdown files' diffs open as the rendered document, with what changed marked block by block.
- You can leave a comment on a rendered block, and it goes to the agent or into your GitHub review exactly like a comment on code lines.
- Every code diff keeps syntax colors on its added, removed and context rows, together with the word-level highlights.

## Non-goals

- Word-level marks inside rendered Markdown. A changed paragraph shows its old version in red above its new one.
- Rendering images from the repo. Relative image paths don't load in the preview.
- A preview for the "Since your review" interdiff. The preview always shows all changes.

## User experience

- A `.md`/`.markdown`/`.mdx` file opened from Changes or the Review tab shows **Preview | Code** in the diff header. Preview is the default; the choice is remembered.
- Preview draws the new version of the file. Added blocks (paragraphs, headings, list items, tables, code blocks, quotes) have a green bar and tint; removed blocks a red bar and tint; an edited block shows its old version in red, then the new one in green. The left gutter shows each block's lines (`+14`, `−8`, `5–9`).
- Hover a block and its gutter turns into **+ Comment**. Click it to comment on the block, shift-click another block to take in a run of blocks. The usual comment box opens under it with **Send to GitHub review | Agent**, ⌘↵ and ⌘⇧↵.
- Queued comments, pending review comments, GitHub threads and reviewer findings show under the block that holds their line, in both views.
- Fenced code blocks inside the preview are syntax colored.
- A ```mermaid fenced block draws as its diagram, in the app's light or dark colors. A changed diagram shows the old one in red above the new one, and you comment on it like any block. Hover it for **Source** to see the text; a diagram that doesn't parse shows the error over its source.
- A Markdown file opened as a file (All files, ⌘P, a link) also reads as the rendered document, with the same Preview | Code switch ([#135](https://github.com/Benbentwo/choo-choo/issues/135)). Opened at a line, it shows the source at that line.
- The Code view, and every other file's diff, colors code by language (TypeScript, Python, Go, Rust, CSS, Markdown, YAML, shell, and the rest of CodeMirror's languages), on top of the green and red rows.

## Requirements

1. Markdown files show a Preview | Code switch; Preview is the default and the last choice sticks across files and restarts.
2. The preview splits both versions into Markdown blocks (list items on their own) and marks each as unchanged, added, removed or changed.
3. A comment on a block records the block's lines on that side (new, or old for removed text) and its source as the code excerpt.
4. A comment for GitHub is narrowed to the block's lines that are in the PR's diff, since GitHub takes comments only there; when none are, GitHub is disabled with the reason.
5. Comments, threads and findings appear under their block; ones that fit no block show above the document.
6. "Since your review" turns the preview off (the Preview button is disabled with a note) because the interdiff can't be drawn as a document.
7. Markdown file tabs (not diffs) show the same Preview | Code switch and share the remembered choice.
8. ```mermaid blocks in the preview (diffs and file tabs) render as diagrams with Mermaid in strict security mode (no scripts or click handlers, labels sanitized), redraw on theme change, and fall back to the source with the parse error.
9. Code diffs are colored per language, loaded on demand; files with no known language stay plain. Colors come from the theme (dark and light sets).

## Design

- `src/renderer/src/syntax.ts`: Lezer parsers from `@codemirror/language-data` (each language is its own lazy chunk). `highlightDiff` tokenizes each hunk's new side (context + added) and old side (context + removed) so strings and comments that span lines stay colored. `mergeRuns` cuts a line at syntax and word-diff boundaries so both are drawn.
- Colors: `SYNTAX_DARK` / `SYNTAX_LIGHT` in `src/shared/themes.ts`, applied as `--syn-*` variables by `appearance.ts`, used by `.syn-*` classes in `styles.css`.
- `src/renderer/src/mdPreview.ts`: `markdownBlocks` (via `@lezer/markdown` with GFM) and `previewBlocks`, which turns a full-context diff into the ordered list of blocks with status and line ranges; `clampToDiff` narrows a block to the PR's diff lines.
- `src/renderer/src/components/MarkdownDiff.tsx` renders the blocks with react-markdown; `MermaidDiagram.tsx` draws ```mermaid blocks (`mermaidSource` in `mdPreview.ts` spots them); `mermaid` is loaded on first use as its own chunk. `DiffView.tsx` owns selection, the comment box and placement, shared with the code view.
- IPC: `getFileDiff(workspaceId, file, full?)`; `full` runs `git diff -U1000000` so the diff holds the whole file.

## Compliance, privacy and security

- No Claude access or sign-in changes. Nothing new leaves the machine: comments follow the existing routes (agent message or GitHub review through `gh`).

## Testing

- `test/mdPreview.test.ts`: Mermaid fence detection, block splitting, statuses and ordering, list items, clamping, syntax tokens across lines and per hunk side, merging with word diff.
- Demo scene `markdown-diff` in `scripts/demo/record.cjs` drives the real app: preview, a comment on a block, Code view, a colored TSX diff. Scene `mermaid-diff` shows a changed diagram and a comment on it (README GIF `docs/media/gifs/mermaid-diff.gif`).

## Rollout

On by default for Markdown files; Code is one click away. No settings or migrations.

## Future work

- Word-level marks inside rendered paragraphs.
- Load relative images from the worktree.
- Syntax colors in the plain file view (code files).
