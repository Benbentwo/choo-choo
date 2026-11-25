# Linux builds

| | |
|---|---|
| Status | Shipped: builds and releases; Linux title bar and Ctrl shortcuts still to do |
| Decision | [0025](../decisions/0025-linux-appimage-deb-unsigned.md) |

## Problem

Choo Choo ships only for macOS. Linux is the smallest step to a second platform: the shell, terminal, Stop and path code already work with POSIX tools, and there is no signing.

## Requirements

- Publish an x64 `AppImage` and `deb` with each release and beta, next to the Mac builds.
- Artifact names: `ChooChoo-${version}-x86_64.AppImage` and `choo-choo_${version}_amd64.deb`.
- Ship the SDK's Linux Claude binary (`claude-agent-sdk-linux-x64`), unmodified ([0001](../decisions/0001-official-claude-access-only.md)).
- `latest-linux.yml` sits next to `latest-mac.yml`, so Stable and Beta channels work unchanged.
- Self-update works for the AppImage; `deb` users get the release-page link.

## Done

- `linux` section in `electron-builder.yml` (AppImage and deb, x64, category Development, `choo-choo://` mime type).
- `scripts/install-claude-binaries.cjs <mac|linux>` replaces the Mac-only script (the old name still works); `build/afterPack.cjs` keeps the matching Claude binary on Linux.
- `npm run dist:linux`.
- Share links: packaged Linux builds take a single-instance lock. A `choo-choo://` link in the first launch's argv opens once the window loads; a second launch hands its argv to the running app (`second-instance`) and quits.
- PATH: packaged Linux builds pick up the login shell's PATH, as on macOS. Dev runs keep the PATH they started with.
- Preload exposes `window.api.platform`. Import from Conductor (Home and Settings › General) shows only on macOS.
- The mono font stacks fall back to `DejaVu Sans Mono` and `Ubuntu Mono`.
- Updates: the AppImage updates itself (`latest-linux.yml`, `beta-linux.yml`); a deb or unpacked build shows the release-page link (`updateMethod()` in `src/main/updater.ts`).
- The sidebar header drops the 84px macOS window-button gap on Linux, which keeps its native title bar.
- Workflows: `ci.yml` packages a Linux build, checks the bundled `claude --version` and smoke-launches it under `xvfb-run`. `release.yml` and `beta.yml` build the AppImage and deb after the Mac job and upload them to the same draft; a final `publish` job publishes only once both platforms are in. `preview.yml` keeps an unsigned `choo-choo-linux` artifact.

## Future work (not done yet)

- Title bar: `titleBarStyle: 'hidden'` with `titleBarOverlay` from the theme, instead of the native frame.
- Keyboard: a shared `mod(e)` and `keyLabel()` so Linux shows `Ctrl+…`.
- MCP sign-in without AppleScript.

## Out of scope

arm64 Linux, Flatpak, Snap, rpm, apt repository hosting, and Windows.
