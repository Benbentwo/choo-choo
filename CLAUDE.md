# Choo Choo

Electron + React app (electron-vite). Main process in `src/main`, preload in `src/preload`, UI in `src/renderer`. See README.md for commands and docs/PARITY.md for the Conductor parity plan.

## Project docs

Read [docs/README.md](docs/README.md) before starting a feature. It links the [product overview](docs/product.md), [architecture](docs/architecture.md), a PRD per feature area in `docs/prd/`, and decision records in `docs/decisions/`.

- Respect the decision records. In particular: agents use only the official Agent SDK and an unmodified Claude Code binary with the person's own sign-in, and Choo Choo never shows its own Claude login or handles Claude tokens ([0001](docs/decisions/0001-official-claude-access-only.md)). Integrations sign in with OAuth ([0003](docs/decisions/0003-oauth-for-integrations.md)).
- New feature: copy `docs/prd/TEMPLATE.md` to `docs/prd/<feature>.md` and add it to the table in `docs/README.md`.
- Changing a feature: update its PRD (status, behavior) and `docs/PARITY.md` in the same PR.
- Making a call later work should follow: add a record from `docs/decisions/TEMPLATE.md`.

## Iterating from in-app comments

In dev mode (`npm run dev`) the app shows a "Comment ⌘⇧K" pill. The person clicks an element and types a note; the app writes `.feedback/<id>.json` (comment, CSS selector, React component chain, element text, rect) plus `<id>.element.png` and `<id>.full.png`. `.feedback/` is gitignored and local to each checkout.

When the person asks you to watch for comments, start a background monitor on `scripts/watch-feedback.sh --all` (one stdout line per comment). For each comment: read the JSON and both screenshots, make the change, then move the three files into `.feedback/done/`. Renderer edits hot-reload; main or preload edits rebuild and restart the app.
