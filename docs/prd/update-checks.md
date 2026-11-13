# PRD: Update checks for Choo Choo and Claude Code

| | |
|---|---|
| Status | Shipped (PR #39); beta channel added |
| Owner | Claude |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-10 |

## Problem

Ben asked whether the app runs real Claude Code or the API, because "we'll want checks for when our app is updated, or when Claude Code has an update", and that the checks should be "in the settings to turn on or off".

On 2026-11-10, with signing working, Ben asked that "every PR we merge is an update to the application" for people who opt into a beta or bleeding-edge setting, while everyone else stays on manually published releases.

Agents run the real Claude Code binary. By default it's the copy bundled with the Agent SDK; Settings can pick your installed `claude` instead. Before this, only signed builds could find app updates, and nothing showed the Claude Code version.

## Goals

- See the Choo Choo and Claude Code versions in one place.
- Hear about a new Choo Choo release, and install it, whether the build is signed, unsigned, or installed by Homebrew.
- Hear about a new Claude Code release, and update an installed `claude` from the app.
- Turn each automatic check on or off.
- Pick an update channel: Stable (published releases) or Beta (a signed build of every merge to main).

## Non-goals

- Updating the bundled Claude Code on its own. It changes only with a Choo Choo release (it's inside the signed app).

## User experience

Settings > Updates has an **Update channel** menu (Stable or Beta, Stable by default), a toggle for each check (both on by default), the current versions, the result of the last check, "Check now" buttons that work even with a toggle off, and an install or update button when one applies. The sidebar shows a card when a Choo Choo update is available or downloaded, and a dismissible card for a new Claude Code. The app menu's "Check for Updates…" uses the same paths. The sidebar footer shows the running version next to "Choo Choo": `v<version>` in a packaged build, `<short sha>-dev` under `npm run dev` (hover for version and commit).

## Requirements

1. With its toggle on, each check runs 5 seconds after start and every 6 hours.
2. Signed builds download the update in place and offer "Restart to update".
3. Unsigned builds offer `brew upgrade --cask choo-choo` (then relaunch) when Homebrew installed the app, otherwise the release page.
4. The Claude Code version comes from the SDK's `claudeCodeVersion` (bundled) or `claude --version` (installed), compared with `@anthropic-ai/claude-code` on npm.
5. An installed `claude` updates with `claude update`. A bundled one that's behind offers switching to the installed `claude` when one exists.
6. On Beta, the app checks the newest of the recent releases, prereleases included, and the updater may download prereleases. On Stable, only the release marked Latest.
7. Never downgrade. Switching from Beta to Stable keeps the beta build until a stable release is newer than it.
8. Every merge to main that changes more than docs publishes a signed, notarized prerelease `v<next>-beta.<run>`, where `<next>` is Release Drafter's next version. It's a draft until all files are uploaded. Only the 10 newest betas are kept.
9. Prereleases never go to Homebrew and never trigger the Release workflow. There's no beta cask: Homebrew users install the stable cask and switch to Beta in Settings, since signed builds update themselves.
10. Each stable release points `Casks/choo-choo.rb` in `Benbentwo/homebrew-tap` at its dmgs (the Homebrew cask workflow, called by Release and runnable by hand). Signed releases get `auto_updates true`.

## Design

- [`src/main/updater.ts`](../../src/main/updater.ts): both checks, update method detection (`codesign` Developer ID check, Homebrew Caskroom), installs, menu dialog.
- [`src/shared/updates.ts`](../../src/shared/updates.ts): `UpdateStatus` and version parsing and comparison.
- [`src/renderer/src/components/Updates.tsx`](../../src/renderer/src/components/Updates.tsx): Settings tab and sidebar cards.
- `Api`: `updateStatus`, `checkForUpdates`, `installAppUpdate`, `updateClaude`, `onUpdateStatus`.
- Settings: `checkAppUpdates`, `updateChannel`, `checkClaudeUpdates`.
- [`.github/workflows/beta.yml`](../../.github/workflows/beta.yml): runs after Release Drafter on each push to main, creates a draft prerelease, builds with `-c.publish.releaseType=prerelease` (electron-builder writes `beta-mac.yml`), checks signing, publishes, prunes old betas. Manual runs are dry runs by default. Why prereleases and not drafts: [decision 0015](../decisions/0015-beta-channel-uses-prereleases.md).
- Dependabot opens a PR for each new Agent SDK; merging it and releasing ships the newer bundled Claude Code.

## Compliance, privacy and security

- Runs only the unmodified Claude Code binary (`--version`, `update`), per [decision 0001](../decisions/0001-official-claude-access-only.md).
- Sends anonymous GET requests to api.github.com (latest release, or the 30 most recent on Beta) and registry.npmjs.org (latest Claude Code). No user data.

## Testing

`test/updates.test.ts` covers version parsing and comparison, including numeric beta ordering (`beta.10` after `beta.9`). Install paths need a packaged build to try by hand.

## Rollout

Both toggles default on and the channel defaults to Stable. Betas reach only people already on a signed build, so the first signed stable release has to go out first. Older saves pick up the defaults through `DEFAULT_SETTINGS`.

## Open questions

- None.

## Future work

- Show which Claude Code the next Choo Choo release bundles.
