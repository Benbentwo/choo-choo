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
- ✅ Command palette (⌘K) with All / Workspaces / Projects / Actions / Settings tabs; recent workspaces include archived ones (dimmed, accent bar, opening restores)
- ✅ File picker (⌘P) and search in files (⌘⇧F)
- ✅ Sidebar hover: archive button and preview card (branch, diff size, status, title, latest message, Create PR, last active)
- ✅ Archived worktrees kept in ~/choo-choo/archive with uncommitted files; deleted after a retention period (Settings, default 30 days)
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
- ✅ After a PR merges: Continue / Archive / Archive and reflect. Reflect has an agent review the chats for friction and suggest CLAUDE.md, rules, skills and hook changes, shown as an editable diff; accepted ones go out as a PR from a new workspace (choo-choo addition)
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

### Beyond Conductor
- ✅ Shared sessions: share a workspace (branch, uncommitted files, chats) with coworkers through the repo's own remote; they continue with their own Claude login

## Build sequence
1. **Foundation**: app scaffold, layout, repos, worktree sessions, agent chat, Changes + diff, terminal.
2. **Workflow**: Create PR, Setup/Run scripts, @mentions, /commands, folders, archive, unread, auto-naming.
3. **Review & polish**: Checks, Review, Artifacts, All files, ⌘K, Settings, checkpoints, clone, notifications.
4. **Ship**: images, plan mode, packaging, release workflow.
5. **Parity gaps closed**: inline review comments, per-tool permission prompts, Intel build.

## Beyond Conductor

Features Conductor doesn't have. Each one is off until you turn it on in Settings › Extra agents. Agent prompts are adapted from [oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT, see THIRD_PARTY_NOTICES.md).

- ✅ **Scout** (Haiku, read-only search): used for research in plan mode; `@scout` in the composer asks for it.
- ✅ **Reviewer** (Opus): the Review tab uses its stricter rules; "Review before opening a PR" has Create PR run it first and stop on P0/P1 findings; `@reviewer` asks for it.
- ✅ **Security reviewer**: adds a Security review button to the Review tab; its findings show in the same list and inline in diffs, tagged "security".
- ✅ **Quick worker** (Haiku): `/quick <task>` hands mechanical work to it.
- ✅ **Advisor**: after each finished turn, a second model reviews the turn with read-only tools and posts notes as a card with Send to agent and Dismiss. Per-chat Advisor toggle in the composer. A red dot in the sidebar marks a workspace with an unhandled blocker. Optional automatic sending of blockers, at most once per message.
- ✅ **Claude Code advisor**: Settings › Agents picks Claude Code's own advisor tool for Claude chats (my Claude Code setting, off, Fable, Opus or Sonnet). Claude consults it mid-task; each consultation shows as an "Advisor" line in the chat. Sits beside the post-turn advisor above.
- ✅ Subagent calls show as one collapsible card per agent, with the steps it took inside.
- ✅ Settings › Claude Code: run the bundled binary or your installed `claude`. When Claude Code isn't signed in, the chat says to run `claude` and `/login`.
- ✅ Settings › Telemetry: OpenTelemetry export (metrics, log events, beta traces) from Claude agents to any OTLP collector, tagged with `choo.repo`, `choo.workspace` and `choo.branch`. Prompt and tool content are separate opt-ins.
- ✅ **Continue on phone**: hand a chat to Claude Code's Remote Control and steer it from the Claude app or claude.ai/code (QR code and link), then bring it back with the phone turns copied in. See [PRD](prd/remote-sessions.md).
- ✅ **Run in the cloud**: push a workspace to a Claude Code cloud session (`claude --cloud`) that keeps going with the Mac closed, send it follow-ups, and bring it back into the worktree with `claude --teleport`.
- ✅ Session usage graphs: per chat, tokens per Claude response (input, cache write, cache read, output) and context-window fill, by response or by time, with compactions marked and a table view. Read from Claude Code's own transcript, so no collector is needed and past sessions work too. Open from the chart button on the chat tabs, the Usage link after a turn, or ⌘K.
- ✅ Settings › Integrations: browser sign-in, tokens in the keychain. Notion signs in to Notion's hosted MCP with no setup; start a workspace from a Notion page or task, and agents get Notion's tools.
- Everything runs on the official Agent SDK and an unmodified Claude Code binary, with each user's own sign-in through Claude Code's /login. Choo Choo never shows its own Claude login or handles tokens, which keeps it within Anthropic's terms. oh-my-pi's own Claude subscription login is not used: it impersonates Claude Code.
