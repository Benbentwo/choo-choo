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
| Packaging | electron-builder (dmg, arm64 + x64) | Signed and notarized (Developer ID) |

Worktrees live at `~/choo-choo/workspaces/<repo>/<city-name>`, like Conductor's `~/conductor/workspaces/<repo>/<city>`.

## Feature checklist

✅ built · 🟡 partial · ⬜ not yet

### Window and navigation
- ✅ Three-pane layout: sidebar, chat, right panel; collapsible sidebar (⌘B), right panel, bottom panel (⌘J)
- ✅ Breadcrumb header: repo › branch, workspace menu (Reveal in Finder, copy path/branch, copy the active chat's `claude --resume` command, archive)
- ✅ Back/forward between workspaces
- ✅ Home view with recent workspaces
- ✅ Command palette (⌘K) with All / Workspaces / Projects / Actions / Settings tabs; recent workspaces include archived ones (dimmed, accent bar, opening restores)
- ✅ File picker (⌘P) and search in files (⌘⇧F)
- ✅ Sidebar hover: archive button and preview card (branch, diff size, status, title, latest message, Create PR, last active)
- ✅ Archived worktrees kept in ~/choo-choo/archive with uncommitted files; deleted after a retention period (Settings, default 30 days)
- ✅ Settings (⌘,): default model/effort, branch prefix, API key, notifications. Sections are listed down the left side (General, Appearance, Projects, Agents, Prompts, MCP, Plugins, Add-ons, Integrations, Updates, Telemetry), like the add-ons mockup, since there are too many for tabs along the top
- ⬜ Onboarding, help menu, update notices

### Workspaces sidebar
- ✅ "My workspaces" repo list; add a local repo or clone from URL
- ✅ "+" per repo creates a workspace: a git worktree at `~/choo-choo/workspaces/<repo>/<city>` on `<prefix>/<city>`
- ✅ Base branch per repo: the new-workspace screen has a "Starts a new branch from" dropdown (detected from `origin/HEAD` at first; the choice is remembered and PRs target it)
- ✅ Diff stats (+N -M), running spinner, unread dot
- ✅ Hide repositories, "Show hidden repositories"
- ✅ Archive workspace (runs archive script, removes worktree, keeps branch)
- ✅ First prompt names the workspace and renames its unpushed branch
- ✅ Restore archived workspaces (sidebar "Archived" list per repo)
- ✅ After a PR merges: Continue / Archive / Archive and reflect. Reflect has an agent review the chats for friction and suggest CLAUDE.md, rules, skills and hook changes, shown as an editable diff; accepted ones go out as a PR from a new workspace (choo-choo addition)
- ✅ Drag to reorder repos
- ✅ Drag to reorder workspaces (Sort by > Manual)
- ✅ Right-click a workspace: Rename…, Regenerate name from the chat, Reveal in Finder, Copy branch name, Archive
- ✅ Right-click the Orchestrator row or an add-on row (such as Plans) > Hide from sidebar; bring rows back from the project's ⋯ menu or View options > Hidden rows (choo-choo addition)
- ✅ Click a project's icon to collapse it to one row (shows a workspace count and a dot when something inside is unread or needs you); click again to expand (choo-choo addition)

### Chat
- ✅ Chat tabs per workspace, ⌘T / ⌘W
- ✅ Model picker (Opus / Fable / Sonnet / Haiku) and effort (Low / Medium / High / Extra high / Max)
- ✅ Streaming replies with markdown, collapsible tool calls, cost and duration
- ✅ Stop (button or Esc)
- ✅ Send while Claude works: Steer (default, folded in at the next step) or Queue (sent after), set in Settings > General
- ✅ `/clear` folds the messages before it behind a "Context cleared" divider, with Show earlier messages
- ✅ @mention file autocomplete, /command autocomplete (built-ins, project and user commands, skills)
- ✅ Attach images (paste, drop or pick); add folders for the agent
- ✅ Plan mode (⇧Tab) with "Approve and build"
- ✅ Next unread (button and ⌘⇧U)
- ✅ Revert to here: restores files and forks the conversation
- ✅ Codex agent (via the `codex` CLI)
- ✅ Per-tool permission prompts (Full access, Auto, Ask for commands, Ask for edits and commands)
- ✅ Clickable question cards when Claude asks the user something (`AskUserQuestion`), in every permission mode

### Right panel
- ✅ Changes: committed, uncommitted and untracked vs merge base, with diff view
- ✅ Code comments: click, drag or shift-click line numbers in the diff to comment; comments wait as chips in the composer (which stays below an open diff or file) and go to the agent together, each with its file, lines and code
- ✅ All files tree with file preview, filter
- ✅ Artifacts: files the agent wrote
- ✅ Checks: PR check runs, re-run failed jobs
- ✅ PR and check status stay fresh through ETag polling (free 304s), every 15s while focused; no webhook server needed
- ✅ A workspace adopts the existing PR of whatever branch is checked out in it, including one the agent switched to itself (orchestrator-started workspaces) and fork PRs
- ✅ Review: agent code review in a new tab
- ✅ Create PR (agent commits, pushes, opens PR), draft option; PR status, open, squash merge
- ✅ Review findings inline in the diff, with Fix buttons
- ✅ Add all PR comments to chat: unresolved review threads, change requests and comments, with file/line context; new-comment count in the header

### Bottom panel
- ✅ Terminal tabs (xterm + pty), persist across workspace switches
- ✅ Setup script on workspace creation, Run ⌘R start/stop, archive script
- ✅ `choo-choo.json` / `conductor.json` scripts; `CONDUCTOR_*` and `CHOO_*` env vars

### Platform
- ✅ macOS menus and shortcuts, desktop notifications
- ✅ dmg/zip builds for Apple silicon and Intel, release workflow (signs and notarizes when secrets are set)
- ✅ Auto-update from GitHub releases (signed builds install in place; unsigned ones offer brew upgrade or the download page)
- ✅ Update channels: Stable (published releases) or Beta (a signed prerelease from every merge to main), in Settings > Updates. See [decision 0015](decisions/0015-beta-channel-uses-prereleases.md).
- ✅ Claude Code version and update check (Settings > Updates; runs `claude update` for an installed copy)

### Beyond Conductor
- ✅ Shared sessions: share a workspace (branch, uncommitted files, chats) with coworkers through the repo's own remote; they continue with their own Claude login
- ✅ Orchestrator: one chat per repo that starts workspaces, briefs their agents, waits on them, follows up and keeps a memory file. It wakes itself with an automatic update when a workspace it started finishes, can run workspaces in a Claude Code cloud session, and watches each workspace's PR and CI checks. See [PRD](prd/orchestrator.md).
- ✅ Project groups: several repos share one orchestrator and one memory; it starts each workspace in the repo the work belongs to.
- 🧪 Projects (Settings › Experimental, choo-choo addition): a project's orchestrator chat forwards each message to the right thread or starts one; threads are listed in a panel like Claude desktop projects; the sidebar shows project › repos › PRs, all foldable. See [PRD](prd/projects.md).
- 🧪 Automations (Settings › Experimental, choo-choo addition): checks that run on a schedule, a GitHub event (review requested, CI failed, PR reviewed) or Run now, and open one workspace per finding in a project thread or a repo, capped per run and never twice for the same finding. See [PRD](prd/automations.md).

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
- ✅ **Review plan** (always available, no setting): the plan card in plan mode has a Review plan button. Three fresh Opus reviewers (design, readiness, codebase fit) read only the plan and the repo, never the chat, and post findings as a card with Revise the plan and Dismiss. Adapted from Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) (Apache 2.0).
- ✅ **Claude Code session controls** ([PRD](prd/claude-code-controls.md)): auto mode, a Goal button for `/goal`, fast mode, a spend cap per message, Compact, output styles, Claude Code's own `/code-review` in the Review tab, and a list of running background tasks with Stop.
- ✅ **MCP servers** ([PRD](prd/mcp-servers.md)): Settings › MCP lists every server Claude Code loads for a repo, with status, tools and errors. You can add (HTTP, SSE or stdio; every repo or the repo's .mcp.json), remove, turn off per repo, retry, and sign in through Claude Code's /mcp.
- ✅ **Plugins and skills** ([PRD](prd/plugins.md)): Settings › Plugins lets you browse marketplaces (Anthropic's is one click away), install for every repo or one repo, turn plugins on or off, uninstall, and see what each one adds and costs. It also lists your own skills, commands and agents.
- ✅ **Add-ons** ([PRD](prd/add-ons.md), [author guide](addon-api.md)): Claude Code plugins that also add views to Choo Choo: in the sidebar, under a project, or as a tab beside a workspace. Settings › Add-ons adds sources (git repos, private ones included), installs, and turns add-ons on after showing their permissions in plain words. Views run in a sandbox and reach the app only through a permission-checked API (list, start, message and stop workspaces, the status of any pull request, opening a pull request in a workspace, own storage, notifications). An add-on can also keep working in the background, give the orchestrator tools, keep text files in a project's `.choo-choo` folder (and read the ones an agent left in its worktree), and put buttons in the app (at the top of a workspace, on sidebar rows, in the ⌘K palette), and a project's `choo-choo.json` can name the add-ons its team should have. An example lives in `examples/addons`.
- ✅ **PRs page** ([PRD](prd/pr-inbox.md)): a PRs item under Search lists open PRs waiting on your review and the ones you opened, across all repos, grouped by repo, like Arc's GitHub live folder. Open → starts (or goes to) a workspace on the PR's branch with the Review tab open, cloning the repo first if needed.
- ✅ **Stacked PRs** ([PRD](prd/stacked-prs.md)): one workspace holds a stack of PRs for one feature, listed under it in the sidebar, with a switcher in the header and a Stack tab. Changes to a lower PR are rebased up the stack and pushed after each agent turn; conflicts go to the agent. Address feedback on one, some or all PRs, fixed bottom first with a restack after each. Link the stack on GitHub (GitHub's stacked pull requests), then "Merge through #N" merges a PR and every PR below it in one step, all or none, and takes them off the stack.
- ✅ **Comment mode** ([PRD](prd/comment-mode.md)): ⌘⇧K, click an element, type a note. In `npm run dev` it goes to the running checkout; in a release build Fix it opens a workspace on choo-choo itself (clone, or fork without push access) with the note and a screenshot, or opens a prefilled GitHub issue.
- ✅ Subagent calls show as one collapsible card per agent, with the steps it took inside.
- ✅ Settings › Claude Code: run the bundled binary or your installed `claude`. When Claude Code isn't signed in, the chat says to run `claude` and `/login`.
- ✅ Settings › Telemetry: OpenTelemetry export (metrics, log events, beta traces) from Claude agents to any OTLP collector, tagged with `choo.repo`, `choo.workspace` and `choo.branch`. Prompt and tool content are separate opt-ins.
- ✅ **Continue on phone**: hand a chat to Claude Code's Remote Control and steer it from the Claude app or claude.ai/code (QR code and link), then bring it back with the phone turns copied in. See [PRD](prd/remote-sessions.md).
- ✅ **Run in the cloud**: push a workspace to a Claude Code cloud session (`claude --cloud`) that keeps going with the Mac closed, send it follow-ups, and bring it back into the worktree with `claude --teleport`.
- ✅ Session usage graphs: per chat, tokens per Claude response (input, cache write, cache read, output) and context-window fill, by response or by time, with compactions marked and a table view. Read from Claude Code's own transcript, so no collector is needed and past sessions work too. Open from the chart button on the chat tabs, the Usage link after a turn, or ⌘K.
- ✅ Settings › Integrations: browser sign-in, tokens in the keychain. Notion signs in to Notion's hosted MCP with no setup; start a workspace from a Notion page or task, and agents get Notion's tools.
- Everything runs on the official Agent SDK and an unmodified Claude Code binary, with each user's own sign-in through Claude Code's /login. Choo Choo never shows its own Claude login or handles tokens, which keeps it within Anthropic's terms. oh-my-pi's own Claude subscription login is not used: it impersonates Claude Code.
