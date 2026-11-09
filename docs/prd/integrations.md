# PRD: Integrations

| | |
|---|---|
| Status | Notion shipped; Linear in progress |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-09 |

## Problem

Work starts and ends in other tools: Linear and GitHub issues, Notion specs, Slack threads. Agents need to read that context and report back, and people want to add plugins and add-ons without editing config files.

## Goals

- Connect Linear, Notion and other services, plus Claude Code plugins and add-ons, from Settings.
- Start a workspace from a Linear issue the way you can from a GitHub issue or PR today.
- Connected services are available to agents as tools (MCP).

## Non-goals

- Pasted API tokens, for now (see [decision 0003](../decisions/0003-oauth-for-integrations.md)).
- A Choo Choo server that brokers integrations.
- A Choo Choo sign-in for a service Claude Code already connects to (see [decision 0008](../decisions/0008-notion-through-claude-code.md)).

## User experience

Settings > Integrations lists available services. Notion has no sign-in in Choo Choo: its row shows whether Claude Code's own Notion connection is working, with a button that opens Claude Code's sign-in when it is not. In the new-workspace composer, the Notion tab takes a pasted page or task link; the workspace starts on a new branch and the agent fetches the page as its brief.

Services Choo Choo signs in to itself get a Connect button. Connect opens the service's OAuth sign-in in the browser and returns to Choo Choo. Connected services show their account and a Disconnect button. The new-workspace composer can then pick a Linear issue as a source.

## Requirements

1. When Claude Code already connects to a service (Notion), agents use that connection and Choo Choo stores nothing. Otherwise sign-in uses OAuth. No pasted-token fields.
2. Tokens are stored in the macOS Keychain, never in `state.json`, shares, transcripts or telemetry.
3. For services Choo Choo signs in to itself, prefer the service's official remote MCP server where one exists, passed to agents through the SDK's `mcpServers` option.
4. Integrations are off until connected; nothing changes for people who don't use them.

## Design

`src/main/integrations/`:

- `oauth.ts`: PKCE helpers and `startLoopback()`, a one-shot `127.0.0.1` listener for the OAuth redirect. Its redirect URI is known before the browser opens, so dynamic client registration can use it.
- `tokens.ts`: per-service auth encrypted with `safeStorage` in `userData/data/integrations.json`.
- `index.ts`: the `Provider` registry and the `integrations:*` IPC. Settings > Integrations renders one row per provider. The registry is empty until Linear lands.
- `mcpOAuth.ts` and `mcpClient.ts`: sign-in to a hosted MCP server (discovery, dynamic client registration, PKCE, refresh) and a small Streamable HTTP tool caller. Not used by Notion any more; kept for providers that need them.
- `notion.ts`: no sign-in and no token. Adds a `notion` workspace source from a pasted page link or id, and a first prompt that tells the agent to fetch the page with its Notion tools and treat the content as data. Agents get those tools from Claude Code's own Notion server (a claude.ai connector or `claude mcp add`), loaded through `settingSources`. `Integrations.tsx` finds that server in `mcpStatus` to show its status.

## Open questions

- Which services first? Linear and Notion were named.
- ~~How do plugins and add-ons map onto Claude Code's own plugin system?~~ Answered: an add-on is a Claude Code plugin plus a Choo Choo manifest; see [Add-ons](add-ons.md).
- When do pasted tokens become acceptable (enterprise setups without OAuth apps)?
