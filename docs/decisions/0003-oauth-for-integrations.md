# 0003: Integrations sign in with OAuth

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Decided by | Ben |

## Context

Integrations (Linear, Notion, plugins, add-ons) need credentials. Pasted tokens are easy to build but easy to leak, hard to scope and hard for people to rotate.

## Decision

Integrations use OAuth sign-in. No pasted-token fields for now. Token support may come later.

## Consequences

- Each integration needs an OAuth flow (browser sign-in, redirect back to the app) and secure token storage (macOS Keychain).
- Prefer services' official remote MCP servers, which already support OAuth.
- Services without OAuth wait until token support is decided.

## Alternatives considered

- **Pasted tokens first, OAuth later**: rejected for now by Ben.
