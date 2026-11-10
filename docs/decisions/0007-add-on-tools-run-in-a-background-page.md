# 0007: Add-on tools and background work run in a sandboxed background page

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-09 |
| Decided by | Claude (project thread), building on [0006](0006-add-ons-are-claude-code-plugins.md). Ben asked for decisions to be made for him. |

## Context

Two things the first add-on host couldn't do, and the Plan board needs both. An add-on's views only run while they are on screen, so nothing could move a plan forward once the person looked elsewhere. And the orchestrator had no way to use an add-on: the proposal said "tools from the add-on's MCP server", but an MCP server is a separate process that Claude Code starts with the person's full permissions. It can't call `window.choo`, so to start a workspace or read the add-on's own data it would need a second way into the app (a local port and a token), and nothing it did there could be held to the permissions the person agreed to.

## Decision

1. An add-on can name a `background` page. It is one more sandboxed frame, with the same `window.choo` and the same permissions as the add-on's views, kept in a window that is never shown for as long as the add-on is on.
2. An add-on lists the tools it gives the orchestrator in its manifest (`tools`: name, description, JSON Schema for the arguments, `readOnly`). The background page answers the calls with `choo.tools.handle(name, fn)`. Listing tools needs the `orchestrator:tools` permission, and the tools are shown, by name, before the add-on is turned on.
3. The app, not the add-on, puts those tools in front of the orchestrator as in-process SDK tools, next to its built-in ones. Tools marked `readOnly` run without asking; the rest follow the orchestrator chat's permission setting.
4. An add-on's own MCP servers still load in every session, the orchestrator's included, as Claude Code plugin parts. They are not the way an add-on reaches Choo Choo.

## Consequences

- Everything an add-on does to Choo Choo, from a view, in the background or for the orchestrator, goes through one API with one permission check. There is no local server and no token.
- Add-on authors write a tool as a few lines of JavaScript beside their views. No Node process, no MCP SDK, nothing to bundle.
- The tool list is fixed by the manifest, so the app knows it without running add-on code, and a tool can't appear that the person wasn't shown.
- What a tool returns goes into the orchestrator's context. An add-on with `orchestrator:tools` can therefore steer the orchestrator; the permission says so, and the orchestrator is told that tool answers come from the add-on, not the person.
- The unseen window costs one more renderer process while an add-on with a background page is on. It is closed when none is.
- A tool that needs Node (reading files outside the host API, running a binary) can't be an add-on tool. It belongs in the plugin's MCP server, with the plugin's usual trust.

## Alternatives considered

- **Tools from the plugin's MCP server, with a local bridge into the app**: what the proposal sketched. Needs a listening port or socket, a token that every plugin's MCP server in the session could read, and permission checks that the calling process could sidestep by doing the work itself.
- **Background pages inside the app window**: no extra window, but closing the window on macOS (the app keeps running, and so do agents) would stop every add-on.
- **Tools declared at run time** (`choo.tools.register` with a schema): the app would have to run the add-on before it could show what it adds, and the orchestrator's tools could change mid-conversation.
