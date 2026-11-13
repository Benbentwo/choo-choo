# Choo Choo docs

Start here when you join the project, human or agent. These docs hold what the code alone doesn't tell you: what we're building, why, and the calls we've already made.

| Doc | What it covers |
|---|---|
| [Product overview](product.md) | Vision, who it's for, principles, scope and status |
| [Architecture](architecture.md) | Processes, modules, data on disk, how an agent turn runs |
| [Conductor parity plan](PARITY.md) | Feature checklist against Conductor |
| [PRDs](prd/) | One per feature area: problem, requirements, design, open questions |
| [Decision records](decisions/) | Choices we don't want to relitigate, with the reasons |
| [Writing an add-on](addon-api.md) | The add-on manifest, the sandbox and the host API |
| [Developing](development.md) | Building from source, comment mode, and where things live |
| [README GIFs](demo-gifs.md) | Recording the feature GIFs from the real app with scripted agents |
| [Releasing](releasing.md) | Stable releases, betas, signing secrets and the Homebrew cask |
| [Brand](brand/) | Logo, palette and guidelines |

## PRDs

| Feature | Status |
|---|---|
| [Import from Conductor](prd/conductor-import.md) | Shipped |
| [Orchestrator](prd/orchestrator.md) | Shipped |
| [Projects](prd/projects.md) | Experimental: threads own their PRs; thread › repo › PR sidebar in review |
| [Automations](prd/automations.md) | Experimental: shipped (PR #80); new issue and PR triggers in review |
| [Shared sessions](prd/shared-sessions.md) | Shipped |
| [Archive and reflect](prd/archive-and-reflect.md) | Shipped |
| [Extra agents and advisor](prd/extra-agents.md) | Shipped |
| [Appearance](prd/appearance.md) | Shipped |
| [Comment mode](prd/comment-mode.md) | Shipped |
| [Custom system prompts](prd/system-prompts.md) | In review |
| [Telemetry](prd/telemetry.md) | In review |
| [Review plan](prd/plan-review.md) | Shipped |
| [Integrations](prd/integrations.md) | Planned |
| [Add PR comments to chat](prd/pr-comments.md) | In review |
| [Line comments to the agent or a GitHub review](prd/review-comments.md) | In review |
| [Remote sessions (phone, cloud and Claude desktop)](prd/remote-sessions.md) | Phone and cloud shipped; Claude desktop in review |
| [Update checks](prd/update-checks.md) | Shipped |
| [Claude Code session controls](prd/claude-code-controls.md) | Shipped (PR #49) |
| [MCP servers](prd/mcp-servers.md) | Shipped (PR #50) |
| [Plugins and skills](prd/plugins.md) | In review |
| [Managing projects, and PR status](prd/projects-and-pr-status.md) | In review |
| [PRs page](prd/pr-inbox.md) | Shipped |
| [Review updates: notify on meaningful PR changes, Since your review](prd/review-updates.md) | Shipped |
| [Add-ons](prd/add-ons.md) | Shipped: views, background pages, orchestrator tools, project pins; Plan board next |
| [Arranging and renaming workspaces](prd/sidebar-workspaces.md) | In review |
| [Stacked PRs](prd/stacked-prs.md) | In review |
| [Subscription limits in the sidebar](prd/subscription-limits.md) | In review |
| [Split panels](prd/split-panels.md) | In review |
| [Build and Review workspace modes](prd/workspace-modes.md) | Shipped |
| [Resizable sidebar and right panel](prd/resizable-panels.md) | In review |
| [Continue work (resume at usage reset)](prd/continue-work.md) | In review |
| [Usage history and the Usage page](prd/usage-history.md) | In review |
| [Rich copy from chat](prd/rich-copy.md) | Shipped |
| [Settings search](prd/settings-search.md) | In review (PR #118) |

New feature? Copy [prd/TEMPLATE.md](prd/TEMPLATE.md) to `prd/<feature>.md` and add a row above.

## Decision records

| # | Decision |
|---|---|
| [0001](decisions/0001-official-claude-access-only.md) | Agents use the official Agent SDK and an unmodified Claude Code binary; no Choo Choo Claude login |
| [0002](decisions/0002-no-oh-my-pi-backend.md) | No oh-my-pi backend; port its agents as opt-in features instead |
| [0003](decisions/0003-oauth-for-integrations.md) | Integrations sign in with OAuth; pasted tokens maybe later |
| [0004](decisions/0004-no-server-git-for-sharing.md) | No Choo Choo server: sharing and sync go through the repo's own git remote |
| [0005](decisions/0005-stack.md) | Electron, React and JSON files on disk |
| [0006](decisions/0006-add-ons-are-claude-code-plugins.md) | Add-ons are Claude Code plugins plus a Choo Choo manifest, sandboxed behind a permission-checked host API |
| [0007](decisions/0007-add-on-tools-run-in-a-background-page.md) | Add-on tools and background work run in a sandboxed background page, not in an MCP server |
| [0009](decisions/0009-add-ons-declare-buttons-the-app-draws-them.md) | Add-ons change the app's own interface only by declaring buttons in named places; the app draws them |
| [0010](decisions/0010-one-worktree-per-stack.md) | A stack of PRs lives in one workspace and one worktree; the app restacks with plain git |
| [0012](decisions/0012-github-stacks-for-merging.md) | Stacks are linked to GitHub's stacked pull requests and merged through them, all or none |
| [0013](decisions/0013-project-threads.md) | Projects: the orchestrator chat routes each message to a thread; the sidebar shows work by repo and PR, not by thread |
| [0014](decisions/0014-automations-own-page-polled-events.md) | Automations get their own page and target a project or a repo; GitHub events are polled while the app is open, no webhooks |
| [0015](decisions/0015-beta-channel-uses-prereleases.md) | The beta update channel is GitHub prereleases built and signed on every merge to main; stable stays manually published releases |
| [0017](decisions/0017-threads-own-their-prs.md) | A project's threads own their workspaces and PRs; the sidebar shows project › thread › repo › PR (supersedes part of 0013) |
| [0018](decisions/0018-add-on-dev-mode-reads-folders-in-place.md) | Add-ons under development are read from their folder and reload as it changes |
| [0019](decisions/0019-resume-only-after-reset.md) | Stopped chats resume only after the server's reset time and once /usage shows the window open; a few at a time, never by retrying or switching accounts |
| [0020](decisions/0020-usage-history-local-estimates.md) | Usage history stays on the Mac (window readings plus text-free response summaries), and per-workspace shares of a window are labeled estimates |
| [0021](decisions/0021-restart-waits-then-resumes.md) | Restarting for an update waits for running chats, and turns cut off by a restart, quit or crash resume their own session on the next launch |

New decision? Copy [decisions/TEMPLATE.md](decisions/TEMPLATE.md) to the next number.

## Keeping docs current

- A PR that adds or changes a feature updates its PRD (status, behavior, open questions) and `PARITY.md` if relevant.
- A PR that makes a call future work should respect adds a decision record.
- Docs describe how things are. Plans go under "Open questions" or "Future work" in the PRD, clearly marked.
