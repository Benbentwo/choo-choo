# Choo Choo

Electron + React app (electron-vite). Main process in `src/main`, preload in `src/preload`, UI in `src/renderer`. See README.md for commands and docs/PARITY.md for the Conductor parity plan.

## Iterating from in-app comments

In dev mode (`npm run dev`) the app shows a "Comment ⌘⇧K" pill. The person clicks an element and types a note; the app writes `.feedback/<id>.json` (comment, CSS selector, React component chain, element text, rect) plus `<id>.element.png` and `<id>.full.png`. `.feedback/` is gitignored and local to each checkout.

When the person asks you to watch for comments, start a background monitor on `scripts/watch-feedback.sh --all` (one stdout line per comment). For each comment: read the JSON and both screenshots, make the change, then move the three files into `.feedback/done/`. Renderer edits hot-reload; main or preload edits rebuild and restart the app.
