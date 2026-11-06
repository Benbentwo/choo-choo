# Choo Choo: Conductor parity plan

Goal: a Mac desktop app that replaces Conductor 1:1. Run many Claude Code agents in parallel, each in its own git worktree, and review and ship their work from one window. Deviations come after parity.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron + electron-vite | Mature on macOS, Node in the main process for git, ptys and the agent SDK |
| UI | React 19, TypeScript, Tailwind v4, Zustand | Fast to build a dense, keyboard-driven UI |
| Agent | `@anthropic-ai/claude-agent-sdk` | Same engine as Claude Code: tools, permissions, resume, slash commands |
| Terminal | xterm.js + node-pty | Real shells for Setup/Run/Terminal tabs |
| Git | `git` CLI (worktrees) + `gh` CLI | Matches what users already have authed |
| Storage | JSON in `~/Library/Application Support/Choo Choo` | No native DB dependency |
| Packaging | electron-builder (dmg, arm64 + x64) | Signed/notarized later |

Worktrees live at `~/choo-choo/workspaces/<repo>/<city-name>`, like Conductor's `~/conductor/workspaces/<repo>/<city>`.

## Feature checklist

✅ built · 🟡 partial · ⬜ not yet

### Window and navigation
- ✅ Three-pane layout: sidebar, chat, right panel; collapsible sidebar (⌘B), right panel, bottom panel (⌘J)
- ✅ Breadcrumb header: repo › branch, workspace menu (Reveal in Finder, copy path/branch, archive)
- ✅ Back/forward between workspaces
- ✅ Home view with recent workspaces
- ✅ Search palette (⌘K): workspaces and actions
- ✅ Settings (⌘,): default model/effort, branch prefix, API key, notifications
- ⬜ Onboarding, help menu, update notices

### Workspaces sidebar
- ✅ "My workspaces" repo list; add a local repo or clone from URL
- ✅ "+" per repo creates a workspace: a git worktree at `~/choo-choo/workspaces/<repo>/<city>` on `<prefix>/<city>`
- ✅ Diff stats (+N -M), running spinner, unread dot
- ✅ Hide repositories, "Show hidden repositories"
- ✅ Archive workspace (runs archive script, removes worktree, keeps branch)
- ✅ First prompt names the workspace and renames its unpushed branch
- ✅ Restore archived workspaces (sidebar "Archived" list per repo)
- ⬜ Drag to reorder repos

### Chat
- ✅ Chat tabs per workspace, ⌘T / ⌘W
- ✅ Model picker (Opus / Sonnet / Haiku) and effort (Low / Medium / High)
- ✅ Streaming replies with markdown, collapsible tool calls, cost and duration
- ✅ Stop (button or Esc)
- ✅ @mention file autocomplete, /command autocomplete (built-ins, project and user commands, skills)
- ✅ Attach images (paste, drop or pick); add folders for the agent
- ✅ Plan mode (⇧Tab) with "Approve and build"
- ✅ Next unread (button and ⌘⇧U)
- ✅ Revert to here: restores files and forks the conversation
- ✅ Codex agent (via the `codex` CLI)
- ✅ Per-tool permission prompts (Full access, Ask for commands, Ask for edits and commands)

### Right panel
- ✅ Changes: committed, uncommitted and untracked vs merge base, with diff view
- ✅ All files tree with file preview, filter
- ✅ Artifacts: files the agent wrote
- ✅ Checks: PR check runs, re-run failed jobs
- ✅ Review: agent code review in a new tab
- ✅ Create PR (agent commits, pushes, opens PR), draft option; PR status, open, squash merge
- ✅ Review findings inline in the diff, with Fix buttons

### Bottom panel
- ✅ Terminal tabs (xterm + pty), persist across workspace switches
- ✅ Setup script on workspace creation, Run ⌘R start/stop, archive script
- ✅ `choo-choo.json` / `conductor.json` scripts; `CONDUCTOR_*` and `CHOO_*` env vars

### Platform
- ✅ macOS menus and shortcuts, desktop notifications
- ✅ dmg/zip builds for Apple silicon and Intel, release workflow (signs and notarizes when secrets are set)
- ✅ Auto-update from GitHub releases (needs a signed build on macOS)

## Build sequence
1. **Foundation**: app scaffold, layout, repos, worktree sessions, agent chat, Changes + diff, terminal.
2. **Workflow**: Create PR, Setup/Run scripts, @mentions, /commands, folders, archive, unread, auto-naming.
3. **Review & polish**: Checks, Review, Artifacts, All files, ⌘K, Settings, checkpoints, clone, notifications.
4. **Ship**: images, plan mode, packaging, release workflow.
5. **Parity gaps closed**: inline review comments, per-tool permission prompts, Intel build.

## Beyond Conductor

Features Conductor doesn't have. Each one is off until you turn it on in Settings.

- ✅ Extra subagents adapted from [oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT): Scout (Haiku, read-only search), Reviewer (Opus, diff review), Security reviewer (read-only), Quick worker (Haiku, mechanical edits). Claude chats hand work to them through the SDK's `agents` option.
- ✅ Advisor: after each finished turn, a second model (Opus, Sonnet or Haiku) reads the turn with read-only tools and either stays silent or posts notes. With steering on, blocker notes go back to the agent automatically, at most once per message you send. Works for Claude and Codex chats.
- Everything runs on the official Agent SDK and the bundled Claude Code binary, so it uses the same sign-in as the main agent. oh-my-pi's own Claude subscription login is not used: it impersonates Claude Code, which Anthropic's terms don't allow.
