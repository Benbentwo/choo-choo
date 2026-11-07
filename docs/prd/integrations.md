# PRD: Integrations

| | |
|---|---|
| Status | Notion shipped; Linear in progress |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-06 |

## Problem

Work starts and ends in other tools: Linear and GitHub issues, Notion specs, Slack threads. Agents need to read that context and report back, and people want to add plugins and add-ons without editing config files.

## Goals

- Connect Linear, Notion and other services, plus Claude Code plugins and add-ons, from Settings.
- Start a workspace from a Linear issue the way you can from a GitHub issue or PR today.
- Connected services are available to agents as tools (MCP).

## Non-goals

- Pasted API tokens, for now (see [decision 0003](../decisions/0003-oauth-for-integrations.md)).
- A Choo Choo server that brokers integrations.

## User experience

Settings > Integrations lists available services with a Connect button. Connect opens the service's OAuth sign-in in the browser and returns to Choo Choo. Connected services show their account and a Disconnect button. The new-workspace composer can then pick a Linear issue as a source.

## Requirements

1. Sign-in uses OAuth. No pasted-token fields.
2. Tokens are stored in the macOS Keychain, never in `state.json`, shares, transcripts or telemetry.
3. Prefer each service's official remote MCP server where one exists, passed to agents through the SDK's `mcpServers` option.
4. Integrations are off until connected; nothing changes for people who don't use them.

## Design

`src/main/integrations/`:

- `oauth.ts`: PKCE helpers and `startLoopback()`, a one-shot `127.0.0.1` listener for the OAuth redirect. Its redirect URI is known before the browser opens, so dynamic client registration can use it.
- `tokens.ts`: per-service auth encrypted with `safeStorage` in `userData/data/integrations.json`.
- `index.ts`: the `Provider` registry and the `integrations:*` IPC. Settings > Integrations renders one row per provider.
- `mcpOAuth.ts` and `mcpClient.ts`: sign-in to a hosted MCP server (discovery, dynamic client registration, PKCE, refresh) and a small Streamable HTTP tool caller.
- `notion.ts`: signs in to `mcp.notion.com`, so no Notion app or secret is needed. Adds a `notion` workspace source (search or paste a link; the page is the fenced first-prompt brief) and passes the server to agents as `mcpServers.notion` unless `notionAgentTools` is off.

## Open questions

- Which services first? Linear and Notion were named.
- How do plugins and add-ons map onto Claude Code's own plugin system?
- When do pasted tokens become acceptable (enterprise setups without OAuth apps)?
