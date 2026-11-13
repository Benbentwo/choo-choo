# Product overview

## One line

Choo Choo is an open-source Mac app for running a team of Claude Code agents in parallel, each in its own git worktree, and reviewing and shipping their work from one window.

## Why it exists

On November 4, 2026, the Conductor team announced that Conductor is joining Meta. Conductor Cloud winds down in November 2026 and the Mac app gets new models and critical fixes until early 2027. A lot of developers rely on Conductor's workflow and want to keep working that way.

Choo Choo started as a 1:1 replacement for Conductor on the Mac and is now positioned as an open, MIT-licensed alternative that anyone can read, fork and keep going. We speak about Conductor and its team respectfully; we never criticize Conductor or Meta.

## Who it's for

- **Conductor users** who want to switch without changing their repos or habits.
- **Developers running several agents at once** who need isolation (one worktree per agent), a fast review loop and one-click PRs.
- **Small teams** who want to hand a running session to a coworker.

## Principles

1. **Parity first, then deviate.** Match Conductor's layout and workflow closely so switching is painless. Ben decides where we deviate after parity; deviations are tracked in [PARITY.md](PARITY.md) under "Beyond Conductor".
2. **Drop-in compatible.** Read `conductor.json` and `CONDUCTOR_*` env vars, and import Conductor's local data. Your repos work unchanged.
3. **Official Claude access only.** Agents run on the Claude Agent SDK and the unmodified Claude Code binary with each user's own sign-in. Choo Choo never shows its own Claude login or handles Claude tokens. See [decision 0001](decisions/0001-official-claude-access-only.md).
4. **Local and plain.** Data lives on your Mac in JSON files. No Choo Choo server. Anything shared goes through the repo's own git remote ([decision 0004](decisions/0004-no-server-git-for-sharing.md)).
5. **Opt-in extras.** Features Conductor doesn't have stay off until you turn them on, so the default experience matches what Conductor users expect.
6. **Independent.** Not affiliated with Conductor's makers or Anthropic. No Conductor code, icons, images or text are copied.

## Core workflow

1. Add a repo (local folder, clone from URL, or pick from your GitHub repos).
2. Press **+** to start a workspace: a new worktree at `~/choo-choo/workspaces/<repo>/<city>` on its own branch. The setup script runs.
3. Chat with the agent: pick a model and effort, use plan mode, @files, /commands, images.
4. Review: Changes tab with diffs, agent code review with inline findings, Checks tab.
5. Ship: Create PR, watch checks, squash-merge.
6. Archive: the worktree moves to `~/choo-choo/archive`, optionally after a reflection that improves the repo's agent setup.

## Feature areas

The detailed requirements live in the [PRDs](prd/). Status as of 2026-11-06:

- Core Conductor parity (workspaces, chat, review, PRs, terminals, scripts, ⌘K, auto-update): shipped, see [PARITY.md](PARITY.md).
- [Import from Conductor](prd/conductor-import.md), [Orchestrator](prd/orchestrator.md), [Shared sessions](prd/shared-sessions.md), [Archive and reflect](prd/archive-and-reflect.md), [Extra agents and advisor](prd/extra-agents.md), [Appearance](prd/appearance.md), [Comment mode](prd/comment-mode.md): shipped.
- [Custom system prompts](prd/system-prompts.md) (PR #32) and [Telemetry](prd/telemetry.md) (PR #33): in review.
- [Integrations](prd/integrations.md) (Linear, Notion, plugins): Notion through Claude Code's own connection; others planned, OAuth only.
- [Add-ons](prd/add-ons.md): extend the app with views and tools from public or private sources; first version in review.

## Distribution

- Apple silicon and Intel `.dmg`/`.zip` from GitHub Releases, auto-update from releases.
- Homebrew: `brew install --cask benbentwo/tap/choo-choo`.
- Release builds are signed with a Developer ID and notarized (the secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` are set). Without them the workflow still builds, unsigned.

## Not goals (for now)

- Windows or Linux builds.
- A hosted cloud version or any Choo Choo account.
- Reusing a claude.ai login or Claude subscription outside the official Claude Code binary.
- claude.ai Projects integration: there is no public API for Projects, project memory or chat history. The [orchestrator](prd/orchestrator.md) and its project groups fill that need locally.
