# 0025: Linux ships AppImage + deb, unsigned

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-23 |
| Decided by | Ben |

## Context

Linux is the first non-Mac platform. Shell, terminal, Stop and path handling already use POSIX tools, and Linux has no Gatekeeper or SmartScreen.

## Decision

- Publish x64 `AppImage` and `deb` builds, unsigned.
- Only the AppImage self-updates; `deb` users get the release-page link.
- Homebrew stays Mac only.

## Consequences

- Windows needs its own work (shell, `taskkill`, paths, signing) and is separate.
- arm64, Flatpak, Snap, rpm and an apt repo are not covered.
