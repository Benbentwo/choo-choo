# Linux builds

| | |
|---|---|
| Status | In progress: packaging only |
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

## Future work (not done yet)

- Workflows: a `linux` job in `ci.yml`, `release.yml` (publish job moves to a final job needing both), `beta.yml`, and an unsigned `choo-choo-linux` artifact in `preview.yml`. Workflow files need a maintainer.
- Title bar: `titleBarStyle: 'hidden'` with `titleBarOverlay` from the theme; expose the platform through preload and move the sidebar padding.
- Keyboard: a shared `mod(e)` and `keyLabel()` so Linux shows `Ctrl+…`.
- Share links: `requestSingleInstanceLock` and a `second-instance` handler reading argv.
- Run the login-shell PATH fix on Linux; MCP sign-in without AppleScript; hide Conductor import off Mac; add `DejaVu Sans Mono` and `Ubuntu Mono` to the mono stacks.

## Out of scope

arm64 Linux, Flatpak, Snap, rpm, apt repository hosting, and Windows.
