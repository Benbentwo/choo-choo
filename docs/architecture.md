# Architecture

Choo Choo is an Electron app built with electron-vite. Three processes, one shared types file.

```
┌──────────────────────────── Electron main (src/main, Node) ───────────────────────────┐
│ index.ts  IPC handlers, window, menus, choo-choo:// links, startup jobs               │
│ agent.ts  Claude turns via @anthropic-ai/claude-agent-sdk ─┐                         │
│ codex.ts  Codex turns via the `codex` CLI                  │                         │
│ extras.ts subagents + advisor  orchestrator.ts  reflect.ts │ spawn                   │
│ git.ts  github.ts (gh CLI)  pty.ts (node-pty)  share.ts    ▼                         │
│ store.ts  JSON state + per-chat items                 claude binary (unmodified)     │
└───────────────▲────────────────────────────────────────────────────────────────────────┘
                │ ipcRenderer.invoke / events (typed by Api in src/shared/types.ts)
┌───────────────┴──── preload (src/preload/index.ts) ── exposes window.api ─────────────┐
└───────────────▲────────────────────────────────────────────────────────────────────────┘
┌───────────────┴──── renderer (src/renderer, React 19 + Zustand + Tailwind v4) ────────┐
│ App.tsx, store.ts, components/* (Sidebar, Center/ChatView, RightPanel, BottomPanel…) │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## Rules of the road

- **The `Api` interface in `src/shared/types.ts` is the contract** between renderer and main. Add a method there, implement it in `src/main/index.ts` as an `ipcMain.handle`, and expose it in `src/preload/index.ts`.
- **Main does all I/O.** The renderer never touches the file system, git or the network directly.
- **Shared logic that needs tests and no Electron goes in `src/shared`** (themes, reflect prompt and parsing, review rules, system prompt builder). Main modules that must be testable keep Electron imports out (for example, `orchestrator.ts` takes a small `Host` interface).
- **Add-on code never runs in main or the app window.** Add-ons get views and a background page in sandboxed frames and the host API in `addonApi.ts`; a new capability is a new method with a permission ([decision 0006](decisions/0006-add-ons-are-claude-code-plugins.md), [0007](decisions/0007-add-on-tools-run-in-a-background-page.md)).
- **Theme colors and fonts live in `src/shared/themes.ts`.** Re-skin there, not in `styles.css`.
- **Shell out to the user's tools** (`git`, `gh`, `codex`, `claude`) rather than reimplementing them. That reuses the user's existing auth.

## Main process modules

| Module | Job |
|---|---|
| `index.ts` | App lifecycle, all IPC handlers, menus, notifications, `choo-choo://` deep links, startup jobs (archive cleanup every 6h) |
| `store.ts` | Loads and saves `state.json` and per-chat item files with atomic writes and a debounce; fills defaults on load |
| `agent.ts` | Runs a Claude turn with the Agent SDK: system prompt, permission mode, `canUseTool` prompts, resume/fork, streaming items to the renderer, auth hints |
| `claudeBinary.ts` | Picks the Claude Code binary: bundled with the SDK (default) or the user's installed `claude` |
| `models.ts` | Reads what the opus/sonnet/haiku aliases currently resolve to |
| `codex.ts` | Runs Codex turns through the `codex` CLI |
| `extras.ts` | Opt-in subagents (scout, reviewer, security reviewer, quick worker) and the advisor |
| `orchestrator.ts` | Orchestrator chat for a repo or project group, its in-process MCP tools and memory file |
| `reflect.ts` | Read-only reflection agent over a workspace's chats |
| `share.ts`, `shareIpc.ts` | Shared sessions over hidden git refs |
| `remote.ts` | Continue on phone: runs `claude --resume <id> --remote-control` in a terminal and imports the phone turns back |
| `cloud.ts` | Run in cloud: `claude --cloud`, follow-ups with `-p --cloud <id>`, and `claude --teleport` to bring it back |
| `conductorImport.ts` | Reads a copy of Conductor's SQLite database and maps it onto Choo Choo state |
| `archive.ts` | Moves worktrees to and from the archive folder; retention cleanup |
| `git.ts` | Worktrees, diffs, snapshots, grep |
| `github.ts` | PRs, checks, issues and repo lists through `gh` |
| `pty.ts` | Terminal sessions with node-pty |
| `scripts.ts` | Reads `choo-choo.json`, falling back to `conductor.json` |
| `commands.ts` | Lists slash commands and skills for autocomplete |
| `naming.ts`, `names.ts` | Names a workspace from its first prompt; city names for worktree folders |
| `updater.ts` | Auto-update from GitHub releases via electron-updater |
| `addons.ts`, `addonApi.ts`, `addonHost.ts`, `addonClient.ts` | [Add-ons](prd/add-ons.md): finds plugins with a `choo-choo.addon.json`, serves their views on `choo-addon://` in sandboxed frames, answers their permission-checked host API calls, keeps their background pages in a window that is never shown, and passes the orchestrator's calls to their tools |
| `uiComment.ts` | Comment mode: `.feedback/` in dev, a choo-choo workspace or GitHub issue in release builds (see [comment mode](prd/comment-mode.md)) |

## Data on disk

| Path | What |
|---|---|
| `~/Library/Application Support/Choo Choo/data/state.json` | Repos, workspaces, chats metadata, settings |
| `~/Library/Application Support/Choo Choo/data/chats/` | Chat items (the transcript Choo Choo renders), one file per chat |
| `~/choo-choo/workspaces/<repo>/<city>` | Workspace worktrees (configurable in Settings) |
| `~/choo-choo/archive/<repo>/<name>-<id>` | Archived worktrees until retention cleanup (default 30 days) |
| `~/choo-choo/repos/` | Default clone location |
| `~/choo-choo/memory/<repo>.md` | Orchestrator memory per repo |
| `~/choo-choo/memory/groups/<group>.md` | Orchestrator memory per project group |
| `~/.claude/…` | Claude Code's own session files; Choo Choo stores only the `sdkSessionId` to resume |
| `~/Library/Application Support/Choo Choo/data/addons/<add-on>.json` | Each add-on's own storage (1 MB) |
| `refs/choo-choo/shares/<id>` in the repo's `origin` | Shared sessions |

The data model (`Repo`, `Workspace`, `Chat`, `ChatItem`, `Settings`) is defined in `src/shared/types.ts`. New settings get a default in `DEFAULT_SETTINGS` and, for nested objects, a `normalize*` function called from `store.load()`, so older saves keep working.

## How a Claude turn runs

1. Renderer calls `api.sendMessage(chatId, text, images)`.
2. `index.ts` builds the agent env (`CONDUCTOR_*`/`CHOO_*` vars, API key if set) and calls `agent.send`.
3. `agent.send` calls the SDK's `query()` with the chosen binary, model, effort, `cwd` = worktree, `resume` = the chat's `sdkSessionId` (or a fork point after "revert to here"), permission mode (`bypassPermissions` for Full access, `plan` for plan mode, otherwise `default` with `canUseTool` prompting the user), extra subagents and the system prompt.
4. SDK messages are turned into `ChatItem`s, saved to the chat file and pushed to the renderer as `ChatEvent`s.
5. When the turn ends: the chat is marked unread, a notification fires, the share (if any) syncs, and the advisor (if on) reviews the turn.

Before each turn the worktree is snapshotted into a checkpoint so "revert to here" can restore files.

## Build, test, ship

- `npm run dev`, `npm run typecheck`, `npm test` (Vitest, `test/`), `npm run build`, `npm run dist:mac`.
- CI (`.github/workflows/ci.yml`, macOS) runs typecheck, tests, build, and an unsigned package for both CPUs.
- Preview builds on every push to `main`; Release workflow builds, attaches and publishes the drafted release and bumps the Homebrew cask. CodeQL scans JS/TS and Actions.
- node-pty can't rebuild for Electron in the cloud sandbox, so terminal changes are verified on macOS CI. The Agent SDK does run in the sandbox.
