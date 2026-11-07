# PRD: Update checks for Choo Choo and Claude Code

| | |
|---|---|
| Status | Shipped (PR #39) |
| Owner | Claude |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-07 |

## Problem

Ben asked whether the app runs real Claude Code or the API, because "we'll want checks for when our app is updated, or when Claude Code has an update", and that the checks should be "in the settings to turn on or off".

Agents run the real Claude Code binary. By default it's the copy bundled with the Agent SDK; Settings can pick your installed `claude` instead. Before this, only signed builds could find app updates, and nothing showed the Claude Code version.

## Goals

- See the Choo Choo and Claude Code versions in one place.
- Hear about a new Choo Choo release, and install it, whether the build is signed, unsigned, or installed by Homebrew.
- Hear about a new Claude Code release, and update an installed `claude` from the app.
- Turn each automatic check on or off.

## Non-goals

- Updating the bundled Claude Code on its own. It changes only with a Choo Choo release (it's inside the signed app).

## User experience

Settings > Updates has a toggle for each check (both on by default), the current versions, the result of the last check, "Check now" buttons that work even with a toggle off, and an install or update button when one applies. The sidebar shows a card when a Choo Choo update is available or downloaded, and a dismissible card for a new Claude Code. The app menu's "Check for Updates…" uses the same paths.

## Requirements

1. With its toggle on, each check runs 5 seconds after start and every 6 hours.
2. Signed builds download the update in place and offer "Restart to update".
3. Unsigned builds offer `brew upgrade --cask choo-choo` (then relaunch) when Homebrew installed the app, otherwise the release page.
4. The Claude Code version comes from the SDK's `claudeCodeVersion` (bundled) or `claude --version` (installed), compared with `@anthropic-ai/claude-code` on npm.
5. An installed `claude` updates with `claude update`. A bundled one that's behind offers switching to the installed `claude` when one exists.

## Design

- [`src/main/updater.ts`](../../src/main/updater.ts): both checks, update method detection (`codesign` Developer ID check, Homebrew Caskroom), installs, menu dialog.
- [`src/shared/updates.ts`](../../src/shared/updates.ts): `UpdateStatus` and version parsing and comparison.
- [`src/renderer/src/components/Updates.tsx`](../../src/renderer/src/components/Updates.tsx): Settings tab and sidebar cards.
- `Api`: `updateStatus`, `checkForUpdates`, `installAppUpdate`, `updateClaude`, `onUpdateStatus`.
- Settings: `checkAppUpdates`, `checkClaudeUpdates`.
- Dependabot opens a PR for each new Agent SDK; merging it and releasing ships the newer bundled Claude Code.

## Compliance, privacy and security

- Runs only the unmodified Claude Code binary (`--version`, `update`), per [decision 0001](../decisions/0001-official-claude-access-only.md).
- Sends anonymous GET requests to api.github.com (latest release) and registry.npmjs.org (latest Claude Code). No user data.

## Testing

`test/updates.test.ts` covers version parsing and comparison. Install paths need a packaged build to try by hand.

## Rollout

Both toggles default on. Older saves pick up the defaults through `DEFAULT_SETTINGS`.

## Open questions

- None.

## Future work

- Show which Claude Code the next Choo Choo release bundles.
