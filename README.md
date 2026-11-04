# Choo Choo

A Mac desktop app for running parallel Claude Code agents in isolated git worktrees. Built as a 1:1 replacement for Conductor.

See [docs/PARITY.md](docs/PARITY.md) for the feature plan.

## Develop

Requires macOS, Node 22+, git, and a Claude login (`claude` CLI signed in, or `ANTHROPIC_API_KEY`). Install the `gh` CLI for PR features.

```sh
npm install      # also rebuilds node-pty for Electron
npm run dev      # launch with hot reload
npm test         # unit tests
npm run dist:mac # build an arm64 .dmg and .zip into dist/
```

Workspaces are git worktrees under `~/choo-choo/workspaces/<repo>/<city>`, each on its own branch. App data lives in `~/Library/Application Support/Choo Choo/data`.

Scripts and agents see Conductor-compatible env vars: `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_WORKSPACE_PATH`, `CONDUCTOR_DEFAULT_BRANCH`, `CONDUCTOR_PORT` (also as `CHOO_*`).

## Release

Push a `v*` tag and the Release workflow builds the app and attaches it to a GitHub release. Add `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` secrets to sign and notarize it; without them the app is unsigned (right-click > Open the first time).
