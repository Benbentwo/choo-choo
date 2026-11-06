# PRD: Plugins and skills

| | |
|---|---|
| Status | In review |
| Owner | Claude (project thread) |
| Requested by | Ben, 2026-11-06 ("Quick wins, then managers" from the Claude Code docs survey) |
| Last updated | 2026-11-06 |

## Problem

Claude Code plugins bundle skills, agents, hooks, MCP servers and code intelligence, and Anthropic's marketplace alone lists thousands of them. Agents in Choo Choo already load whatever plugins are installed, but finding, installing and turning them on or off meant leaving the app for the terminal. Skills, commands and agents in `~/.claude` and the repo were also invisible.

## Goals

- Browse marketplaces, install, turn on or off, and uninstall plugins from Settings.
- See what a plugin adds and what it costs in context before you rely on it.
- See your own skills, commands and agents in one place.

## Non-goals

- Choo Choo's own plugin system or registry. Everything goes through `claude plugin …`.
- Editing skills in the app. "Show in Finder" opens them in your editor of choice.
- Plugin eval runs, plugin authoring, and mods.

## User experience

Settings > Plugins has a repo picker (project-scope plugins and skills come from that repo) and three views:

- **Installed.** Each plugin shows its version, marketplace and scope, with an on/off switch and Uninstall (only for user, project or local installs). Click a name to see Claude Code's own summary from `claude plugin details`: its skills, agents, hooks, MCP and LSP servers, and projected token cost.
- **Browse.** Shows the marketplaces you've added, each with a remove button. With none added, there's a one-click "Add Anthropic's marketplace" button, and any owner/repo or git URL can be added too. A search box filters every plugin those marketplaces offer, sorted by install count. Each plugin installs for every repo or for this repo. If a plugin installs by running a command its marketplace declares, the app shows that command and installs only after you click "Run it and install".
- **Your skills.** Skills, commands and agents from `~/.claude` and the repo's `.claude` folder, with their descriptions and "Show in Finder".

Changes apply from the next message in each chat, because every turn starts Claude Code fresh.

## Requirements

1. Every action runs the same Claude Code binary agents use: `claude plugin list|install|uninstall|enable|disable|details` and `claude plugin marketplace list|add|remove`.
2. Plugin ids, scopes and the command hash are checked before Claude Code runs.
3. A marketplace-declared install command is never accepted without the person seeing it. The app passes `--accept-command <sha256>` only for the command it showed, and never `-y`.
4. "Show in Finder" only opens paths inside `~/.claude` or a known repo.

## Design

- `src/main/claudeCli.ts`: runs the Claude Code binary and reads `--json` output. `mcp.ts` uses it too.
- `src/main/plugins.ts`: `installed`, `available` (cached for 5 minutes), `marketplaces`, `addMarketplace`, `removeMarketplace`, `install`, `uninstall`, `setEnabled`, `details`, `localSkills`.
- IPC: the `plugin*` methods, `localSkills` and `revealPath`.
- UI: `src/renderer/src/components/PluginSettings.tsx`.

## Compliance, privacy and security

Plugins run with the person's own permissions, as they do in the terminal. Claude Code's own trust checks still apply, and the app adds the visible confirmation for command-based installs.

## Testing

`test/plugins.test.ts`. Listing, browsing (3,918 plugins from Anthropic's marketplace), enabling, disabling, details, uninstall, install and a failed install were also checked by hand against Claude Code 2.1.318.
