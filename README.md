# Choo Choo

A Mac desktop app for running many Claude Code agents in parallel, each in its own git worktree, then reviewing and shipping their work from one window.

Choo Choo is an open-source alternative to [Conductor](https://conductor.build). It aims to match Conductor's workflow closely so you can switch without relearning anything, and it reads the same `conductor.json` scripts and env vars. See [docs/PARITY.md](docs/PARITY.md) for the feature list.

> Choo Choo is an independent project. It is not affiliated with, endorsed by or sponsored by the makers of Conductor or by Anthropic. "Conductor" and "Claude" are trademarks of their owners and are used here only to describe compatibility.

## Signing in

Choo Choo runs agents through Anthropic's official [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview) and the unmodified Claude Code binary that ships with it. It never handles your Claude password or tokens itself. Use one of these:

1. **Your Claude Code login.** Install [Claude Code](https://docs.claude.com/en/docs/claude-code/setup), run `claude`, and sign in with `/login`. Choo Choo's agents use that login.
2. **An Anthropic API key.** Create one in the [Anthropic Console](https://console.anthropic.com/) and paste it into Settings > Anthropic API key, or set `ANTHROPIC_API_KEY`.

Your use of Claude is covered by Anthropic's terms for whichever sign-in you pick. Don't point Choo Choo at tools that reuse a Claude subscription by imitating Claude Code; that is against Anthropic's terms.

Codex is optional: install the Codex CLI (`npm i -g @openai/codex`) and run `codex login`.

## Install

Every push to `main` builds test copies of the app. Open the latest [Preview build](https://github.com/Benbentwo/choo-choo/actions/workflows/preview.yml) run, download `choo-choo-apple-silicon` (or `choo-choo-intel`) from Artifacts, unzip it and open the .dmg. Drag Choo Choo to Applications, then clear the download quarantine once, because these builds aren't signed:

```sh
xattr -cr "/Applications/Choo Choo.app"
```

Tagged releases are on the [Releases](https://github.com/Benbentwo/choo-choo/releases) page and update themselves.

## How it works

- Each workspace is a git worktree under `~/choo-choo/workspaces/<repo>/<city>`, on its own branch.
- App data lives in `~/Library/Application Support/Choo Choo/data`.
- Setup, run and archive scripts come from `choo-choo.json`, falling back to `conductor.json`.
- Scripts and agents see `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_WORKSPACE_PATH`, `CONDUCTOR_DEFAULT_BRANCH` and `CONDUCTOR_PORT`, also available as `CHOO_*`.
- PR features use the `gh` CLI, so install it and run `gh auth login`.

## Shared sessions

Share a workspace with a coworker from the workspace's ⋯ menu > Share with coworkers. Choo Choo pushes one commit to a hidden ref, `refs/choo-choo/shares/<id>`, in the repository's `origin` remote. It holds the branch, your uncommitted and untracked files (not gitignored ones), and every chat in the workspace. You get a `choo-choo://share` link to send. By default the share updates after every agent turn.

Your coworker clicks the link, or uses Open shared session on the home screen, which also lists every share in their repositories. Choo Choo clones the repo if they don't have it, makes a workspace on your branch with your changes in place, and shows your chats. Their next message continues the conversation with their own Claude login, and the agent gets your transcript as context. While the workspace is open, new turns you make show up within 30 seconds, for chats they haven't continued themselves.

Only people who can read the repository can open a share, so a share in a public repository is public. Nothing about your Claude login or settings is included, and things that look like API keys or tokens are blanked out of the chats. Stop sharing deletes the ref.

## Develop

Requires macOS, Node 22+ and git.

```sh
npm install      # also downloads Electron and rebuilds node-pty for it
npm run dev      # launch with hot reload
npm run typecheck
npm test         # unit tests
npm run dist:mac # build arm64 and Intel .dmg and .zip files into dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to send a change.

### Comment mode: point at the UI and let Claude change it

Dev mode has a built-in way to give Claude Code feedback on the running app:

1. Run `npm run dev`.
2. Open Claude Code in this repo and say "watch for my comments". [CLAUDE.md](CLAUDE.md) tells it how: it runs `scripts/watch-feedback.sh` in the background and gets a line for each new comment.
3. In the app, press ⌘⇧K (or click the "Comment" pill in the bottom-right), click any element, type what should change, and press Enter.

Each comment is saved to `.feedback/` in your checkout with the element's selector, its React component, and two screenshots. Claude reads it, makes the change, and moves it to `.feedback/done/`. UI edits hot-reload; main-process edits restart the app. Comment mode only exists in dev builds, and `.feedback/` is gitignored, so comments stay on your machine.

## Release

Push a `v*` tag and the Release workflow builds the app and attaches it to a GitHub release. Add `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` repository secrets to sign and notarize it; without them the app is unsigned (right-click > Open the first time).

## License

[MIT](LICENSE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
