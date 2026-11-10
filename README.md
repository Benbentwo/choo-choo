<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/choo-choo-horizontal-dark.svg">
  <img src="docs/brand/choo-choo-horizontal-light.svg" alt="Choo Choo" width="420">
</picture>

**Run a team of Claude Code agents in parallel on your Mac.**<br>
Each agent gets its own git worktree. You review the diffs and ship the PRs from one window.

An open-source, MIT-licensed alternative to [Conductor](https://conductor.build).

[![CI](https://github.com/Benbentwo/choo-choo/actions/workflows/ci.yml/badge.svg)](https://github.com/Benbentwo/choo-choo/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Benbentwo/choo-choo?include_prereleases&label=download)](https://github.com/Benbentwo/choo-choo/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![macOS](https://img.shields.io/badge/macOS-Apple%20silicon%20%7C%20Intel-lightgrey)

[Download](https://github.com/Benbentwo/choo-choo/releases/latest) · [Features](#features) · [Coming from Conductor](#coming-from-conductor) · [Docs](docs/README.md) · [Contributing](CONTRIBUTING.md)

</div>

<!-- Screenshot or GIF goes here: docs/media/hero.png (1600x1000, dark theme, a sample repo with 3 workspaces running). -->

## Why Choo Choo

On November 4, 2026, the Conductor team [announced that Conductor is joining Meta](https://www.conductor.build/changelog/0.93.0-conductor-is-joining-meta). Conductor Cloud is winding down, and the Mac app will keep getting new models and critical bug fixes until early 2027. Congratulations to the team: they built a workflow a lot of developers now rely on.

Choo Choo is an open-source, community-driven option for people who want to keep working that way for the long run. The code is MIT-licensed, so anyone can read it, fork it and keep it going. It is built to be a drop-in switch: it follows Conductor's layout and workflow closely, and it reads the same `conductor.json` scripts and `CONDUCTOR_*` environment variables, so your repos work without changes. See [docs/PARITY.md](docs/PARITY.md) for the full feature checklist.

> Choo Choo is an independent project. It is not affiliated with, endorsed by or sponsored by the makers of Conductor or by Anthropic. "Conductor" and "Claude" are trademarks of their owners and are used here only to describe compatibility.

## Features

- **Parallel agents, isolated worktrees.** Press + to start a workspace: a fresh git worktree and branch where a Claude Code agent works without touching your other checkouts.
- **Chat built for coding agents.** Opus, Sonnet and Haiku with effort levels, plan mode, @file mentions, /slash commands and skills, image attachments, and "revert to here" checkpoints.
- **Review before you ship.** Changes view with diffs, an agent code review whose findings show inline with Fix buttons, and per-tool permission prompts.
- **PRs in one click.** Create a PR (or draft), watch checks, re-run failures and squash-merge, all through your `gh` login.
- **Real terminals.** Setup, Run (⌘R) and terminal tabs per workspace, driven by `choo-choo.json` or `conductor.json`.
- **Start from Notion.** Sign in to Notion, then start a workspace from a Notion page or task. Agents can also search, read and update Notion while you're signed in.
- **Codex too.** Optionally run OpenAI's Codex CLI as a workspace agent.
- **Keyboard first.** ⌘K search, ⌘T/⌘W tabs, ⌘B/⌘J panels, ⌘⇧U next unread.
- **Native Mac app.** Apple silicon and Intel builds, desktop notifications, update checks for the app and for Claude Code (Settings > Updates, each with its own on/off toggle).

## Coming from Conductor

| | Conductor | Choo Choo |
|---|---|---|
| Source code | Closed | Open, MIT license |
| Agents | Claude Code, Codex | Claude Code (official Agent SDK), Codex |
| Workspaces | Git worktrees | Git worktrees at `~/choo-choo/workspaces/<repo>/<city>` |
| Repo scripts | `conductor.json` | `choo-choo.json`, falling back to `conductor.json` |
| Env vars | `CONDUCTOR_*` | `CONDUCTOR_*`, plus `CHOO_*` aliases |
| PRs and checks | Built in | Built in, via the `gh` CLI |
| Data | On your Mac | On your Mac, plain JSON files |

To switch, [install Choo Choo](#install), [sign in](#signing-in), then open Settings > Import from Conductor. It shows a preview, then brings over your projects, open workspaces (left where they are), their chats and your default model. Claude chats keep their session, so the agent picks up with full context. Conductor's database is copied and read, never changed. Your existing `conductor.json` setup and run scripts are picked up as they are.

Using Conductor Cloud? The import reads your Mac's local Conductor data, so first move each cloud workspace to your Mac in Conductor (right-click it > Transfer to local), then import.

## Install

With [Homebrew](https://brew.sh):

```sh
brew install --cask benbentwo/tap/choo-choo
```

`brew upgrade --cask choo-choo` picks up new releases. Until builds are signed, the cask clears the download quarantine for you, so the first launch isn't blocked.

Or install it by hand:

1. Download the `.dmg` for your Mac from the [latest release](https://github.com/Benbentwo/choo-choo/releases/latest): `arm64` for Apple silicon, `x64` for Intel.
2. Open it and drag Choo Choo to Applications.
3. Until builds are signed, macOS blocks the first launch. Clear the download quarantine once:

   ```sh
   xattr -cr "/Applications/Choo Choo.app"
   ```

You'll also want the [`gh` CLI](https://cli.github.com/) (`brew install gh`, then `gh auth login`) for PR features.

Want the newest code? Every push to `main` builds test copies: open the latest [Preview build](https://github.com/Benbentwo/choo-choo/actions/workflows/preview.yml) run and download `choo-choo-apple-silicon` or `choo-choo-intel` from Artifacts.

## Signing in

Choo Choo runs agents through Anthropic's official [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview) and the unmodified Claude Code binary that ships with it. It never handles your Claude password or tokens itself. Use one of these:

1. **Your Claude Code login.** Install [Claude Code](https://docs.claude.com/en/docs/claude-code/setup), run `claude`, and sign in with `/login`. Choo Choo's agents use that login.
2. **An Anthropic API key.** Create one in the [Anthropic Console](https://console.anthropic.com/) and paste it into Settings > Anthropic API key, or set `ANTHROPIC_API_KEY`.

Your use of Claude is covered by Anthropic's terms for whichever sign-in you pick. Don't point Choo Choo at tools that reuse a Claude subscription by imitating Claude Code; that is against Anthropic's terms.

Codex is optional: install the Codex CLI (`npm i -g @openai/codex`) and run `codex login`.

## How it works

- Each workspace is a git worktree under `~/choo-choo/workspaces/<repo>/<city>`, on its own branch.
- App data lives in `~/Library/Application Support/Choo Choo/data`.
- Setup, run and archive scripts come from `choo-choo.json`, falling back to `conductor.json`.
- Scripts and agents see `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_WORKSPACE_PATH`, `CONDUCTOR_DEFAULT_BRANCH` and `CONDUCTOR_PORT`, also available as `CHOO_*`.
- PR features use the `gh` CLI, so install it and run `gh auth login`.

### Orchestrator

Click the orchestrator icon next to a repository in the sidebar. Tell the orchestrator what you want and it splits the work into workspaces, gives each agent a task, waits for them, reads their transcripts and diffs, and sends follow-ups. It runs in the repo's main checkout and cannot edit files there. It keeps a memory file per repository at `~/choo-choo/memory/<repo>.md`, which it reads on every turn and which you can edit yourself.

## Integrations

Settings > Integrations lists the services you can sign in to. Each one signs in through your browser; there are no tokens to paste. Tokens are encrypted with the macOS keychain (Electron `safeStorage`) in `~/Library/Application Support/Choo Choo/data/integrations.json`.

**Notion** needs no setup: Choo Choo signs in to Notion's hosted MCP server (`mcp.notion.com`) and registers itself on the fly, so there is no Notion app or client secret. After signing in, pick the Notion tab in the new-workspace composer to start from a page or task (search, or paste a page link); the page becomes the agent's brief. While Notion is connected, agents also get Notion's tools to search, read and update pages. Turn that off with the checkbox under Notion.

Adding a service: write `src/main/integrations/<name>.ts` exporting a `Provider` (see `index.ts`), sign in with `startLoopback` and `pkce` from `oauth.ts` (or `mcpOAuth.ts` for a hosted MCP server), store the result with `setAuth` from `tokens.ts`, and add it to the `providers` list.

## Shared sessions

Share a workspace with a coworker from the workspace's ⋯ menu > Share with coworkers. Choo Choo pushes one commit to a hidden ref, `refs/choo-choo/shares/<id>`, in the repository's `origin` remote. It holds the branch, your uncommitted and untracked files (not gitignored ones), and every chat in the workspace. You get a `choo-choo://share` link to send. By default the share updates after every agent turn.

Your coworker clicks the link, or uses Open shared session on the home screen, which also lists every share in their repositories. Choo Choo clones the repo if they don't have it, makes a workspace on your branch with your changes in place, and shows your chats. Their next message continues the conversation with their own Claude login, and the agent gets your transcript as context. While the workspace is open, new turns you make show up within 30 seconds, for chats they haven't continued themselves.

Only people who can read the repository can open a share, so a share in a public repository is public. Nothing about your Claude login or settings is included, and things that look like API keys or tokens are blanked out of the chats. Stop sharing deletes the ref.

## Observability

Settings > Telemetry sends OpenTelemetry data from Claude agents to any OTLP collector (Honeycomb, Datadog, Grafana, or a local collector on `http://localhost:4318`). You get metrics for tokens, cost and tool decisions, an event per prompt, API request and tool result, and traces with a span per turn, model request and tool call. Every export carries `choo.repo`, `choo.workspace` and `choo.branch` resource attributes. Only structure is exported unless you turn on the content options. See the [Agent SDK observability guide](https://code.claude.com/docs/en/agent-sdk/observability).

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

Project docs live in [docs/](docs/README.md): the [product overview](docs/product.md), [architecture](docs/architecture.md), a PRD for each feature area and the decision records behind them.

### Comment mode: point at the UI and let Claude change it

Dev mode has a built-in way to give Claude Code feedback on the running app:

1. Run `npm run dev`.
2. Open Claude Code in this repo and say "watch for my comments". [CLAUDE.md](CLAUDE.md) tells it how: it runs `scripts/watch-feedback.sh` in the background and gets a line for each new comment.
3. In the app, press ⌘⇧K (or click the "Comment" pill in the bottom-right), click any element, type what should change, and press Enter.

Each comment is saved to `.feedback/` in your checkout with the element's selector, its React component, and two screenshots. Claude reads it, makes the change, and moves it to `.feedback/done/`. UI edits hot-reload; main-process edits restart the app. `.feedback/` is gitignored, so comments stay on your machine.

In a release build, ⌘⇧K (Help > Comment on Choo Choo…) works the same way, but **Fix it** opens a new workspace on this repo with your note and a screenshot, and Claude starts on the fix there. The first time, the app clones the repo, or your fork if you can't push to it, so the PR goes upstream. Pick **GitHub issue** instead to open a prefilled issue in your browser.

## Release

[Release Drafter](.github/release-drafter.yml) keeps a draft release up to date as PRs merge, with notes grouped by label (`feature`, `bug`, `docs`, `chore`...) and the next version picked from them: `breaking` bumps major, `feature` or `enhancement` bumps minor, anything else bumps patch. PRs get area labels from the files they touch ([labeler.yml](.github/labeler.yml)), and the label set lives in [labels.yml](.github/labels.yml).

To ship, open **Actions > Release > Run workflow** (optionally type a version). It builds the app for Apple silicon and Intel, attaches the `.dmg`, `.zip` and update files to the draft, and publishes it. Publishing the draft by hand on the Releases page works too; the workflow then attaches the files. The app's version comes from the release tag.

Add a `HOMEBREW_TAP_TOKEN` secret (a token that can push to `Benbentwo/homebrew-tap`) and each release also updates the Homebrew cask, written by `scripts/homebrew-cask.sh`. Add `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` repository secrets to sign and notarize builds (Actions > Release > Run workflow with **Test build only** checked signs, notarizes and checks a build without touching any release); without them the app is unsigned and can't update itself on macOS, so it offers `brew upgrade` (when Homebrew installed it) or the release page instead.

Agents run the Claude Code binary bundled with the Agent SDK (the SDK's `claudeCodeVersion`), unless Settings > General > Claude Code picks your installed `claude`. Dependabot opens a PR whenever a new SDK is out; merge it and release to ship the newer Claude Code. An installed `claude` can be updated from Settings > Updates, which runs `claude update`.

## License

[MIT](LICENSE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
