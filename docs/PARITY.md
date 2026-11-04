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

Legend: P1 = first PR, P2.. = later PRs.

### Window and navigation
- [P1] Three-pane layout: sidebar, chat, right panel; collapsible sidebar and right panel
- [P1] Breadcrumb header: repo › branch, workspace menu (…)
- [P1] Back/forward navigation between workspaces
- [P3] Home view (recent workspaces, quick start)
- [P3] Search / command palette (⌘K): workspaces, files, commands
- [P3] Settings (⌘,): Anthropic key/Claude login, branch prefix, default model, theme
- [P4] Help menu, onboarding, update notices

### Workspaces (repos) sidebar
- [P1] "My workspaces" list of repositories; add local repo
- [P3] ✅ Clone repo from URL / GitHub
- [P1] "+" per repo creates a session (new worktree + branch, city name)
- [P1] Sessions listed under repo with diff stats (+N -M)
- [P2] Unread / running / needs-attention indicators per session
- [P2] Hide repositories, "Show hidden repositories"
- [P2] Archive / restore workspace (removes worktree, keeps branch)
- [P3] Rename session, agent auto-titles branch from first prompt
- [P3] Drag to reorder repos

### Chat (center)
- [P1] Session tabs per workspace with "+" for new chat tab
- [P1] Composer: "Ask to make changes, @mention files, run /commands"
- [P1] Model picker (Opus / Sonnet / Haiku) and effort (Low / Medium / High)
- [P1] Streams agent messages: text, tool calls (collapsible), results, cost
- [P1] Stop / interrupt running agent
- [P2] @mention file autocomplete from worktree
- [P2] /commands autocomplete (built-ins + `.claude/commands`)
- [P2] Attach images / files; add folder (extra dirs for the agent)
- [P2] Plan mode toggle and permission prompts (approve tool use)
- [P2] "Next unread" jump
- [P3] Checkpoints: revert workspace to an earlier turn
- [P3] Markdown rendering with code highlighting, copy buttons
- [P4] Codex agent option

### Right panel
- [P1] Changes tab: files changed vs base branch, +/- per file, U/M/D status
- [P1] Diff viewer for a selected file
- [P2] All files tab: worktree file tree, open file preview
- [P2] Create PR button (gh), with dropdown: draft PR, push only
- [P2] After PR: PR status, merge button, open on GitHub
- [P3] Checks tab: GitHub check runs for the branch, re-run, logs
- [P3] Review tab: agent code review of the diff with inline comments
- [P3] Artifacts tab: files/screenshots the agent produced
- [P3] Search in diff, tree/flat toggle

### Bottom panel
- [P1] Terminal tab: shell in the worktree (xterm + pty), "+" for more terminals
- [P2] Setup tab: runs repo setup script on workspace creation (`choo-choo.json` / `conductor.json` compatible)
- [P2] Run tab + Run ⌘R: runs the repo's run script, stop/restart
- [P2] Env vars for scripts: `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_PORT` (and `CHOO_*` aliases)
- [P2] Collapse/expand bottom panel

### Platform
- [P1] macOS menu bar, keyboard shortcuts
- [P4] dmg build, code signing, notarization, auto-update
- [P4] Notifications when an agent finishes or needs input

## PR sequence
1. **P1 Foundation**: app scaffold, layout, repos, worktree sessions, agent chat, Changes + diff, terminal.
2. **P2 Workflow**: Create PR, Setup/Run scripts, @mentions, /commands, attachments, permissions, archive, unread.
3. **P3 Review & polish**: Checks, Review, Artifacts, All files, Home, ⌘K, Settings, checkpoints, markdown.
4. **P4 Ship**: packaging, signing, notifications, auto-update.
