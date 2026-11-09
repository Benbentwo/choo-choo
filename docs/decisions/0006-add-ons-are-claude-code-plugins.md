# 0006: Add-ons are Claude Code plugins plus a Choo Choo manifest

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-09 |
| Decided by | Ben, from the add-ons proposal |

## Context

Teams want to extend Choo Choo, for example with visual plans that orchestrate many workspaces, and an organization needs to ship its own add-ons to its team without publishing them, while the app itself stays open source. Add-ons can start agents that edit code, so what one may do has to be clear before it is turned on. Claude Code already has plugins (skills, agents, hooks, MCP servers) with install, versions and updates from any git repo, and Choo Choo already manages them in Settings › Plugins.

## Decision

1. An add-on is a Claude Code plugin with one extra file, `choo-choo.addon.json`. The plugin parts load through Claude Code unchanged. The manifest says what the add-on adds to the app (views today; orchestrator tools and workspace sources next) and which permissions it needs.
2. Add-ons come from sources, which are Claude Code plugin marketplaces: git repos fetched with the person's own git and GitHub access. A private add-on is a private repo. Choo Choo has no registry, server or account for add-ons.
3. No add-on code runs in the main process or the app window. Views are web pages in sandboxed frames with no Node, no preload and an opaque origin, served on `choo-addon://`. Their only way out is `window.choo`, a versioned host API whose every call is checked in the main process against the permissions the person agreed to.
4. Installing an add-on does not turn it on. Turning it on shows its permissions in plain words. If a later version asks for more, it pauses until the person reviews them.
5. Add-ons never run Claude themselves or see Claude tokens. They ask the host to start or message a workspace, which runs like any other ([0001](0001-official-claude-access-only.md)).
6. Our own add-ons, starting with the Plan board, are built as add-ons in a separate repo, not into the app, so the API is proven by real use.

## Consequences

- One install, one version and one switch cover both what agents get and what the app shows. An add-on's skills and hooks also work in the terminal.
- The app can be refactored freely: add-ons depend on host API v1, not on internals. New capabilities mean new methods and permissions, added without breaking `apiVersion: 1`; a breaking change needs a new version.
- Views can't use Node, read files or reach the network unless the host API or a declared `net:<host>` permission allows it. Things a view can't do yet need a host API method first.
- An add-on's MCP servers and hooks still run with the person's own permissions, as every Claude Code plugin's do. The install panel says so.
- Access control for private add-ons is the source repo's access control ([0004](0004-no-server-git-for-sharing.md)).
- Third-party sign-ins inside add-ons must use OAuth ([0003](0003-oauth-for-integrations.md)); a host API method for that comes with the first add-on that needs it.

## Alternatives considered

- **Load add-on modules into the main process** (npm packages or a `main.js`): fastest to build and most powerful, but one bad add-on could read every repo and chat, and every refactor would break add-ons.
- **Our own package format and registry**: duplicates Claude Code plugins, leaves skills and hooks out, and needs hosting.
- **Only Claude Code plugins, no app surface**: plugins can't add views, and a plan canvas needs one.
- **Fork the app per organization**: what private add-ons exist to avoid.
