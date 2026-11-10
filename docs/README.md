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
| [Brand](brand/) | Logo, palette and guidelines |

## PRDs

| Feature | Status |
|---|---|
| [Import from Conductor](prd/conductor-import.md) | Shipped |
| [Orchestrator](prd/orchestrator.md) | Shipped |
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
| [Remote sessions (phone and cloud)](prd/remote-sessions.md) | Phone shipped; cloud in review |
| [Update checks](prd/update-checks.md) | Shipped |
| [Claude Code session controls](prd/claude-code-controls.md) | Shipped (PR #49) |
| [MCP servers](prd/mcp-servers.md) | Shipped (PR #50) |
| [Plugins and skills](prd/plugins.md) | In review |
| [Managing projects, and PR status](prd/projects-and-pr-status.md) | In review |
| [PRs page](prd/pr-inbox.md) | Shipped |
| [Add-ons](prd/add-ons.md) | Shipped: views, background pages, orchestrator tools, project pins; Plan board next |
| [Arranging and renaming workspaces](prd/sidebar-workspaces.md) | In review |
| [Stacked PRs](prd/stacked-prs.md) | In review |

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

New decision? Copy [decisions/TEMPLATE.md](decisions/TEMPLATE.md) to the next number.

## Keeping docs current

- A PR that adds or changes a feature updates its PRD (status, behavior, open questions) and `PARITY.md` if relevant.
- A PR that makes a call future work should respect adds a decision record.
- Docs describe how things are. Plans go under "Open questions" or "Future work" in the PRD, clearly marked.
