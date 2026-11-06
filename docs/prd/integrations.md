# PRD: Integrations

| | |
|---|---|
| Status | Planned |
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

To be designed. Likely pieces: an OAuth loopback or `choo-choo://` redirect handler in main, Keychain storage via Electron `safeStorage` or the system keychain, and per-chat MCP server config in `agent.ts`. `WorkspaceSource` gains a `linear` kind.

## Open questions

- Which services first? Linear and Notion were named.
- How do plugins and add-ons map onto Claude Code's own plugin system?
- When do pasted tokens become acceptable (enterprise setups without OAuth apps)?
