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

## Rules of thumb

Things the code doesn't tell you, learned the hard way. [CLAUDE.md](../CLAUDE.md) has the short list for agents.

- **Theming.** Every theme color and font lives in `src/shared/themes.ts`. Re-skin there, not in `styles.css`.
- **Overlays from the title bar.** Header bars use `.drag` (`-webkit-app-region: drag`). A modal rendered inside one inherits it and Electron swallows its clicks. Render overlays opened from a header button with `createPortal(..., document.body)` and put `no-drag` on the backdrop. Browsers ignore app regions, so Playwright and browser screenshots won't catch this; check in the Electron window.
- **Settings.** Sections are listed down the left side from `SETTINGS_SECTIONS` in `src/renderer/src/components/Modals.tsx`; add a new section there. Settings search reads `SETTINGS_INDEX` in `src/renderer/src/settingsSearch.ts`, and `test/settingsSearch.test.ts` fails when a settings component draws a label the index doesn't list ([PRD](prd/settings-search.md)).
- **Examples.** The repo is public and MIT-licensed. Plans, mockups, screenshots, code, docs and PR text use generic examples, never details from anyone's job (employer, vendors, internal or compliance tasks), even when a request was phrased with one.
- **README GIFs.** A user-facing feature adds or updates its GIF in the same PR ([demo-gifs.md](demo-gifs.md)). Record in a Linux container, such as a cloud session: the recorder refuses to run on macOS because the app's data folder there ignores the fake `HOME`.
- **GitHub in tests.** Cloud sessions can't reach GitHub's GraphQL API. Test the PRs page and anything else that calls `gh api graphql` with a stand-in `gh` on `PATH` that answers from files; `scripts/demo/bin/gh` is one. The same trick lets an end-to-end test "merge" a PR through `gh pr view` and `gh pr checks`.
- **DOM in unit tests.** Vitest runs in Node. A test that needs a DOM starts with `// @vitest-environment jsdom` (see `test/richCopy.test.ts`).
- **End-to-end in the cloud.** The built app runs under Playwright and xvfb (`_electron.launch` with `node_modules/electron/dist/electron`, `--no-sandbox`, its own `XDG_CONFIG_HOME` and `CLAUDE_CONFIG_DIR`). Cloud containers can start real Claude agents, so a run that presses Start spends real usage: keep such runs few and tell the agent to reply briefly and stop. `npm ci` can fail there because `node-pty` can't fetch Electron headers; Electron itself installs and the app runs with the terminal panel closed. HTML5 drag doesn't work under Playwright in the container.
- **Claude Code version.** The app runs the Claude Code binary bundled with `@anthropic-ai/claude-agent-sdk` (its `claudeCodeVersion`), unless Settings › General picks your installed `claude` (`src/main/claudeBinary.ts`). To ship a newer Claude Code, merge the SDK bump and cut a release.
- **Checks on PRs.** CodeQL and Aikido Security run on pull requests. Treat their findings as review input: fix real issues and explain dismissals in the PR.

## Comment mode

In dev mode, press ⌘⇧K (or click the 💬 Comment bubble at the bottom right), click any element and type what should change. The note and screenshots land in `.feedback/`, and a Claude Code session told to "watch for my comments" makes the change ([CLAUDE.md](../CLAUDE.md) explains how). In a release build, the same bubble or ⌘⇧K opens a workspace on this repo with your note, or a prefilled GitHub issue.

## README GIFs

The feature GIFs in the README are recorded from the real app. See [demo-gifs.md](demo-gifs.md) to record or update one. A user-facing feature should add or update its GIF in the same PR.
