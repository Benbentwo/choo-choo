# 0008: Notion goes through Claude Code's own connection

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-09 |
| Decided by | Ben |

## Context

Choo Choo signed in to Notion's hosted MCP server as its own OAuth app, registered on the fly as "Choo Choo" ([0003](0003-oauth-for-integrations.md)). Workspaces that only allow approved apps refuse that: members see "you can't install Choo Choo, ask a workspace admin to add this to the allow list". Every such workspace would need an admin to approve Choo Choo.

Claude Code already connects to Notion, as a claude.ai connector or a server added with `claude mcp add`, and those workspaces have usually approved Claude. Agents load Claude Code's user, project and local settings, so they get that server without Choo Choo doing anything.

## Decision

Choo Choo does not sign in to Notion and holds no Notion token. Agents use the Notion server Claude Code already has. Starting a workspace from Notion takes a pasted page or task link, and the agent fetches the page with its own Notion tools. Settings > Integrations reports the status of Claude Code's Notion server.

When Claude Code already connects to a service, prefer that connection over a Choo Choo sign-in. [0003](0003-oauth-for-integrations.md) still applies to services Choo Choo has to sign in to itself.

## Consequences

- Works wherever Claude's Notion connector is allowed. No admin approval for Choo Choo, and one less token to store.
- No type-to-search for Notion pages in the new-workspace picker: the main process has no token to search with. Search would have to run through an agent turn.
- The page is fetched by the agent on its first turn, not before the workspace starts, so a missing or signed-out Notion connection shows up in the chat.
- Notion's tools are turned on or off per repo under Settings > MCP, the same as any other server.

## Alternatives considered

- **Keep Choo Choo's own sign-in and ask admins to allow-list it**: keeps search, but every locked-down workspace hits the same wall.
- **Search Notion through a short agent turn**: possible later; costs tokens and a few seconds per search.
