# 0005: Electron, React and JSON files on disk

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-04 |
| Decided by | Build thread (Ben left the choice to us) |

## Context

The goal was a 1:1 Conductor replacement on the Mac, fast. The app needs Node for git, ptys and the Claude Agent SDK, and a dense, keyboard-driven UI.

## Decision

| Layer | Choice |
|---|---|
| Shell | Electron + electron-vite |
| UI | React 19, TypeScript, Tailwind v4, Zustand |
| Agent | `@anthropic-ai/claude-agent-sdk` |
| Terminal | xterm.js + node-pty |
| Git | `git` CLI (worktrees) + `gh` CLI |
| Storage | JSON in `~/Library/Application Support/Choo Choo/data` |
| Packaging | electron-builder, dmg and zip for arm64 and x64 |

## Consequences

- No native database dependency; state is human-readable and easy to back up.
- Using the `gh` and `git` CLIs reuses the person's existing auth.
- node-pty needs a native rebuild per Electron version, which can't run in the cloud sandbox, so terminal changes are verified on macOS CI.
- Large chats live in per-chat files so `state.json` stays small.

## Alternatives considered

- **Tauri or native Swift**: no first-class Node runtime for the Agent SDK.
- **SQLite**: adds a native module for little gain at this scale.
