# PRD: Image diffs (PNG and SVG)

| | |
|---|---|
| Status | Shipped (PR #141) |
| Owner | Choo Choo maintainers |
| Requested by | Ben, 2026-11-19 |
| Last updated | 2026-11-20 |

## Problem

A PR that adds or changes an image can't be reviewed in Choo Choo: a PNG's diff reads "No textual changes (binary or empty file)" and an SVG's diff is a wall of path coordinates. Ben: "When an image is being added to a pull request we should be able to click it and view it for review, support png and svg."

## Goals

- A changed PNG or SVG shows as pictures: before and after side by side, or just the new or removed image.
- Clicking an image opens it full size, so you can check the details before approving.
- An SVG's source is still one click away.

## Non-goals

- Formats other than PNG and SVG (JPEG, GIF, WebP, ICO). Adding one is a line in `src/shared/images.ts` when someone asks.
- Pixel diffs, onion skin or swipe views.
- Comments on an image (or a region of it). Line comments on an SVG work in its Code view.
- "Since your review" for images: the image view always compares against the base.

## User experience

- A `.png` or `.svg` opened from Changes or the Review tab shows the image instead of a line diff. A changed image shows **Before** (red frame) and **After** (green frame) side by side; a new one shows **Added**, a deleted one **Deleted**. Each has its pixel size and file size. Transparent areas show as a checkerboard.
- Click an image to open it full size over the app. **Fit** (default) scales it to the window, **100%** shows real pixels and scrolls. For a changed image, **Before | After** (or ← →) flips between the two in place. Esc or a click outside closes it.
- An SVG's diff header has **Preview | Code**. Preview is the default; Code shows the normal line diff with comments.
- A PNG or SVG opened as a file (All files, ⌘P, a link) shows the image with the same click to open full size; an SVG has the same Preview | Code switch, and opening it at a line goes to Code.
- Images over 10 MB show a note instead of the picture.

## Requirements

1. PNG and SVG files (by extension, any case) show as images in the diff and file views.
2. The before side is the file at the merge base (from its old path when renamed); the after side is the worktree file. A missing side means the file was added or deleted.
3. Clicking an image opens a full-size view with Fit and 100%, and Before | After when both exist (also ← →). Esc closes it.
4. SVGs keep a Code view with the line diff and comments.
5. Images over 10 MB are not sent to the renderer.

## Design

- `src/shared/images.ts`: which files are images and their MIME types, and the `ImageDiff` shape.
- `git.fileVersions(cwd, baseRef, file)` in `src/main/git.ts` reads both versions as bytes (`git show <merge-base>:<path>`, following a rename, and the worktree file).
- IPC `git:imageDiff` (`getImageDiff`) returns both sides as `data:` URLs, which the renderer's CSP already allows for `img-src`. SVGs load through `<img>`, so scripts inside them don't run.
- `src/renderer/src/components/ImageDiff.tsx`: `ImageDiff` (diff view), `ImageFile` (file view) and the full-size lightbox. `DiffView` and `FileView` switch to them for image files.

## Compliance, privacy and security

- No Claude access or sign-in changes. Nothing leaves the machine: images are read from the local repo and shown in the app.
- SVGs render as images (`<img src="data:image/svg+xml…">`), never inline in the DOM, so a hostile SVG in a PR can't run script in the app.

## Testing

- `test/images.test.ts`: extension detection; before and after bytes for a changed, added, deleted and renamed image.
- README GIF `docs/media/gifs/image-diff.gif`, recorded by the demo scene `image-diff` in `scripts/demo/record.cjs`: a changed PNG side by side, the full-size view flipping before and after, an SVG's Preview and Code.

## Rollout

On by default for PNG and SVG files. No settings or migrations.

## Future work

- More formats (JPEG, GIF, WebP).
- Swipe and onion-skin comparisons.
- Comments pinned to a point on an image.
