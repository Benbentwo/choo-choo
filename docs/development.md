# Developing Choo Choo

For people working on Choo Choo itself. To use the app, see the [README](../README.md#install).

## Build and run

Requires macOS, Node 22+ and git.

```sh
npm install      # also downloads Electron and rebuilds node-pty for it
npm run dev      # launch with hot reload
npm run typecheck
npm test         # unit tests
npm run dist:mac # build arm64 and Intel .dmg and .zip files into dist/
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) to send a change, and [releasing.md](releasing.md) for releases, betas, signing and the Homebrew cask.

## Project docs

Start at [docs/README.md](README.md): the [product overview](product.md), [architecture](architecture.md), a PRD for each feature area and the decision records behind them.

## Comment mode

In dev mode, press ⌘⇧K (or click the "Comment" pill), click any element and type what should change. The note and screenshots land in `.feedback/`, and a Claude Code session told to "watch for my comments" makes the change ([CLAUDE.md](../CLAUDE.md) explains how). In a release build, ⌘⇧K opens a workspace on this repo with your note, or a prefilled GitHub issue.

## README GIFs

The feature GIFs in the README are recorded from the real app. See [demo-gifs.md](demo-gifs.md) to record or update one. A user-facing feature should add or update its GIF in the same PR.
