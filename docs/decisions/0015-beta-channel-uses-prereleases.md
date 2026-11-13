# 0015: The beta channel is GitHub prereleases, built on every merge

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Decided by | Ben (asked for per-merge updates on an opt-in channel); Claude (prereleases over drafts) |

## Context

Mac signing and notarization work on CI. Ben wants every merged PR to reach people who opt into a beta or bleeding-edge setting, while everyone else gets manually published releases. He suggested publishing each build as a draft release.

Draft releases are only visible to people with push access to the repo. The app checks anonymously, and electron-updater's GitHub provider never sees drafts, so a draft can't be an update feed. Release Drafter also keeps one draft for the next stable release's notes.

## Decision

- Each merge to main (that changes more than docs) runs the Beta workflow after Release Drafter. It builds, signs and notarizes the app and publishes it as a GitHub **prerelease** tagged `v<next>-beta.<run number>`, where `<next>` is the draft's next version. The prerelease stays a draft only while files upload.
- Stable releases are unchanged: Release Drafter's draft, published by the Release workflow, marked Latest, and pushed to the Homebrew cask.
- Settings > Updates > **Update channel**: Stable (default) or Beta. Beta sets electron-updater's `allowPrerelease`; Stable clears it. `allowDowngrade` stays off, so leaving Beta keeps your build until a newer stable release.
- The channel is called "Beta" rather than "bleeding edge" because the word is familiar.

## Consequences

- Semver order makes the channels meet: `0.2.0-beta.57` < `0.2.0` < `0.2.1-beta.58`, so publishing a stable release moves beta users onto it.
- The run number only grows, so a later merge always sorts newer even if the draft's version changes.
- Betas only reach signed builds; unsigned builds can't update in place.
- Each merge spends about 15 to 25 minutes of macOS runner time (free for this public repo) and a notarization. A newer merge cancels an older build. Only 10 betas are kept.
- People watching the repo for releases get notified about prereleases too.
- The README download badge and link ignore prereleases.

## Alternatives considered

- **Draft releases as the beta feed**: not downloadable without repo access, and the updater skips them.
- **A second repo or bucket for betas**: more secrets and hosting for no gain over prereleases.
- **Signing only on a schedule (nightly)**: cheaper, but Ben asked for each merge.
