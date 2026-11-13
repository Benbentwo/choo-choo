# Releasing

For maintainers. Users only need the install steps in the [README](../README.md#install).

## Stable releases

[Release Drafter](../.github/release-drafter.yml) keeps a draft release up to date as PRs merge, with notes grouped by label (`feature`, `bug`, `docs`, `chore`...) and the next version picked from them: `breaking` bumps major, `feature` or `enhancement` bumps minor, anything else bumps patch. PRs get area labels from the files they touch ([labeler.yml](../.github/labeler.yml)), and the label set lives in [labels.yml](../.github/labels.yml).

To ship, open **Actions > Release > Run workflow** (optionally type a version). It builds the app for Apple silicon and Intel, signs and notarizes it, attaches the `.dmg`, `.zip` and update files to the draft, and publishes it. Publishing the draft by hand on the Releases page works too; the workflow then attaches the files. The app's version comes from the release tag. Check **Test build only** to sign, notarize and check a build without touching any release.

## Betas

Every merge to `main` ships a beta: the [Beta workflow](../.github/workflows/beta.yml) builds, signs and notarizes the app and publishes it as a prerelease named after the draft's next version, like `v0.2.0-beta.57`. People on Settings > Updates > Update channel > **Beta** update to these; everyone else stays on **Stable**. Prereleases are never marked Latest, so the Homebrew cask and the download link skip them. Docs-only merges don't build, a newer merge cancels an older build, and only the 10 newest betas are kept. See [decision 0015](decisions/0015-beta-channel-uses-prereleases.md).

Unsigned test copies of every push to `main` are also on the [Preview build](../.github/workflows/preview.yml) runs, as the `choo-choo-apple-silicon` and `choo-choo-intel` artifacts.

## Homebrew cask

The cask lives in [Benbentwo/homebrew-tap](https://github.com/Benbentwo/homebrew-tap). Each stable release updates it through the [Homebrew cask workflow](../.github/workflows/homebrew.yml), which writes the cask with `scripts/homebrew-cask.sh`. Run that workflow by hand to point the cask at an existing release. Betas never go in the cask; beta testers install the stable cask and switch channel in Settings.

## Secrets

| Secret | Used for |
|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Developer ID certificate for signing |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization |
| `HOMEBREW_TAP_TOKEN` | Fine-grained token with Contents read and write on `Benbentwo/homebrew-tap` only, for the cask update |

Without the signing secrets the workflows still build, but the app is unsigned and can't update itself on macOS, so it offers `brew upgrade` (when Homebrew installed it) or the release page instead. Beta builds need the signing secrets.

## Claude Code version

Agents run the Claude Code binary bundled with the Agent SDK (the SDK's `claudeCodeVersion`), unless Settings > General > Claude Code picks your installed `claude`. Dependabot opens a PR whenever a new SDK is out; merge it and release to ship the newer Claude Code.
