# PRD: MCP servers

| | |
|---|---|
| Status | Shipped (PR #50) |
| Owner | Claude (project thread) |
| Requested by | Ben, 2026-11-06 ("Quick wins, then managers" from the Claude Code docs survey) |
| Last updated | 2026-11-06 |

## Problem

Agents already load every MCP server Claude Code knows about: user and project config, claude.ai connectors, and plugins. But nothing in the app shows them, so a server that fails, needs sign-in, or is missing is invisible until an agent can't do something.

## Goals

- See every MCP server an agent in a repo will load, with its status, tools and errors.
- Add, remove, turn off and retry servers without opening Terminal.
- Keep Claude Code as the single source of truth, so the terminal and Choo Choo always agree.

## Non-goals

- Choo Choo's own MCP config or credential storage. Everything is saved by Claude Code.
- Signing in to servers inside the app. OAuth for MCP servers runs in Claude Code's own `/mcp` screen ([decision 0001](../decisions/0001-official-claude-access-only.md), [decision 0003](../decisions/0003-oauth-for-integrations.md)).
- Per-chat on and off. Each turn starts a fresh Claude Code process, so per-chat toggles would need their own config layer.

## User experience

Settings > MCP has a repo picker (it defaults to the current workspace's repo), then the servers grouped by scope. **User scope** holds your own config, plugins and claude.ai connectors. **Project scope** holds this repo's `.mcp.json` and your local overrides. **Enterprise scope** holds servers your organization manages. Each group shows "None." when empty, and any server from an unknown source appears under **Other**. Each server has one row:

- A status dot and label: Connected, Failed, Needs sign-in, Connecting or Off.
- Where the server comes from: you (every repo), this repo's `.mcp.json`, you (this repo only), a claude.ai connector, a plugin, or your organization.
- The transport, the URL or command, and the tool count. Click the name to list the tools with their descriptions.
- A switch that turns the server off or on for that repo. Claude Code remembers this in `~/.claude.json`, so the terminal follows it too.
- **Retry** on failed servers, **Sign in…** on servers that need it (this opens Terminal on `claude /mcp`), and **Remove** for servers in user, project or local config (click twice to confirm).

**Add server** asks for a name, the transport (HTTP, SSE or a stdio command), the scope (every repo, or this repo's `.mcp.json`), the URL or command line, and optional headers or environment lines. It runs `claude mcp add`, then refreshes the list.

## Requirements

1. Status comes from the Agent SDK's `mcpServerStatus()` in an idle session that loads the same setting sources as agents. No message is sent, so it uses no tokens.
2. Add and remove go through `claude mcp add` and `claude mcp remove` from the same Claude Code binary the agents use.
3. Turning a server off or on goes through `toggleMcpServer`. Retry goes through `reconnectMcpServer`.
4. Input is checked before Claude Code runs: the name, the URL scheme, and the `KEY=value` and `Name: value` line formats.

## Design

- `src/main/mcp.ts`: `status`, `add`, `remove`, `toggle`, `reconnect`, `openSignIn`, plus the pure helpers `mcpAddArgs`, `mcpRemoveArgs`, `toView` and `signInScript`.
- IPC: `mcpStatus`, `mcpAdd`, `mcpRemove`, `mcpToggle`, `mcpReconnect` and `mcpSignIn`, each keyed by repo id. They run in the repo's main checkout.
- UI: `src/renderer/src/components/McpSettings.tsx`.

## Compliance, privacy and security

Choo Choo never reads or stores MCP credentials. Headers and env values go straight to Claude Code's config. The add form warns that `.mcp.json` is committed, so secrets belong in user scope.

## Open questions

- Project servers live in the main checkout's `.mcp.json`, so workspaces only see them after the file is committed and pulled into each workspace's branch.

## Testing

`test/mcp.test.ts`. Status, add, remove and the persistence of the on/off switch were also checked by hand against Claude Code 2.1.318 with a stdio test server.
