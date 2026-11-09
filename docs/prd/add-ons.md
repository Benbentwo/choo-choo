# PRD: Add-ons

| | |
|---|---|
| Status | In review. Views, permissions and the host API are built; orchestrator tools, repo pins and the Plan board follow |
| Owner | Claude (project thread) |
| Requested by | Ben, 2026-11-09 ("How do we support add-ons that expand functionality? Organizations can have a private add-on … so that the main project can stay open-sourced.") |
| Last updated | 2026-11-09 |

## Problem

People want Choo Choo to do things that don't belong in the core app for everyone: Ben's workplace plans large pieces of work visually and wants that to drive many workspaces at once. Organizations also need their own extensions (deploy gates, ticket systems, house styles) that only their team gets, while the app stays open source. Today the only ways to extend the app are a fork or a PR.

## Goals

- Anyone can add views and behavior to Choo Choo without changing the app.
- An organization ships add-ons to its team from a private repo. Nothing about them is public.
- Turning on an add-on is an informed choice: you see what it can do first, and it can't do more.
- Our own extensions are built the same way, starting with the Plan board (a visual plan that runs many worktree workspaces).

## Non-goals

- A Choo Choo add-on registry, store, server or account.
- Add-on code in the main process or the app window. See [decision 0006](../decisions/0006-add-ons-are-claude-code-plugins.md).
- Changing how Claude Code plugins work. Skills, hooks and MCP servers stay Claude Code's.

## User experience

**Getting an add-on.** Settings › Add-ons lists add-on sources (git repos; the same list as plugin marketplaces), the add-ons they offer, and what's installed. "Add source" takes `owner/repo`, a git URL or a folder path; private repos work through your own git and GitHub access. Install puts the add-on on your Mac but doesn't turn it on.

**Turning it on.** The switch opens a panel that says what the add-on adds ("Board in the sidebar, Notes as a tab beside each workspace") and lists each permission in plain words with a one-line explanation. "Turn on" starts it. "Permissions" shows the same list any time. Turning it off removes its views at once.

![The permissions panel in Settings › Add-ons](../media/add-ons-permissions.png)

**Using it.** An add-on's views appear in up to three places: the sidebar's top list (below Search), under each project (above its workspaces), and as a tab in the right panel beside a workspace. Views follow the app's theme. Each view is labelled with the add-on it comes from.

![The example add-on's board in the sidebar and under a project](../media/add-ons-board.png)

**When something's off.** A row shows why an add-on isn't running: "Can't be loaded" with the manifest's problems, "Its plugin is off in Settings › Plugins", or "Paused: it asks for new permissions" with a Review button after an update that asks for more.

## Requirements

1. An add-on is an installed Claude Code plugin whose folder has a `choo-choo.addon.json`. Plugins without one are untouched.
2. A manifest with a problem is not loaded, and every problem is listed. A manifest for a newer API version says "Needs a newer Choo Choo".
3. Installed is not on. Nothing from an add-on is served or callable until the person turns it on after seeing its permissions.
4. Turning on fails if the add-on's permissions differ from what was shown. A version that asks for more pauses until reviewed.
5. Views run in frames with `sandbox="allow-scripts allow-forms"` (opaque origin, no Node, no preload, no storage, no popups, no top navigation) under a content security policy that allows only the add-on's own files and the hosts in its `net:` permissions.
6. Only files inside the add-on's folder are served, after resolving symlinks; dotfiles and dot-folders never are.
7. Every host API call is checked in the main process: the method must exist, the add-on must hold its permission, and arguments are validated. The view's identity comes from which frame sent the message, never from what it says.
8. Add-ons see live, non-orchestrator workspaces only. Reading chat transcripts is its own permission.
9. Workspaces an add-on starts are ordinary workspaces, record which add-on started them (`Workspace.addonId`), and run with the person's default model and permissions. An add-on can have at most 8 agents running at once.
10. Each add-on gets 1 MB of its own storage, readable by no other add-on.
11. With no add-on turned on, startup does no extra work and the app looks as before.

## Design

- [src/shared/addons.ts](../../src/shared/addons.ts): manifest type and `parseManifest`, the permission catalog, which permission each method needs (`METHOD_PERMISSION`), add-on states, the view CSP, and the message types between a view and the app.
- [src/main/addons.ts](../../src/main/addons.ts): finds add-ons from `claude plugin list --json` (each row's `installPath`) and available ones from each source's `marketplace.json`; safe file resolution for views.
- [src/main/addonApi.ts](../../src/main/addonApi.ts): the host API. `call()` checks the permission, validates with zod, and acts through a small `AddonHost` interface, so it has no Electron imports and is unit-tested.
- [src/main/addonHost.ts](../../src/main/addonHost.ts): registers the `choo-addon://` scheme and serves view files and `/@choo/host.js` with the CSP header; the `addons:*` IPC; grants live in `Settings.addons` (`{ enabled, granted }` per plugin id).
- [src/main/addonClient.ts](../../src/main/addonClient.ts): the script that gives a view `window.choo` over `postMessage`.
- Renderer: `AddonFrame` (the frame and its message bridge) and `AddonPage` in [Addons.tsx](../../src/renderer/src/components/Addons.tsx), [AddonSettings.tsx](../../src/renderer/src/components/AddonSettings.tsx), and slots in Sidebar and RightPanel.
- Authors: [docs/addon-api.md](../addon-api.md) and the example in [examples/addons](../../examples/addons).

Add-ons are read from the home folder, so they are user-scope plugins. Sources are added, and add-ons installed, with the same `claude plugin` commands as Settings › Plugins.

## Compliance, privacy and security

- Claude access: add-ons can't run Claude or see tokens. They ask the host to start or message workspaces, which use the Agent SDK and the person's own sign-in ([0001](../decisions/0001-official-claude-access-only.md)).
- Third-party sign-in: none in this version. A host method for OAuth comes with the first add-on that needs one ([0003](../decisions/0003-oauth-for-integrations.md)).
- What leaves the machine: nothing, unless an add-on holds a `net:<host>` permission, which the person sees before turning it on. Then its views can send what their other permissions let them read to that host.
- What add-ons can't reach: files, shell, other add-ons' files and storage, the app window, Claude tokens, integration tokens, settings. A view's frame can only move between its own add-on's pages.
- An add-on's hooks and MCP servers are Claude Code plugin parts and run with the person's permissions, as in the terminal. The permissions panel says so.

## Testing

`test/addons.test.ts` covers manifest validation, permissions and states, the CSP, finding installed and available add-ons, file serving (traversal, symlinks, dotfiles), the client script, and every host API method against a fake host. The example add-on was run in the real app under Playwright: install from a local source, turn on, all three slots, and probes from inside a view confirming it has no `require`, no `window.api`, no access to the parent window, no outside network, no other add-on's files, no calls beyond its permissions, and no way to send its frame to a web page or another add-on's pages.

## Rollout

Off until an add-on is installed and turned on. `Settings.addons` and `Workspace.addonId` are optional, so old saves need no migration.

## Open questions

- Per-repo add-ons: should an add-on be on for chosen projects only? Today it is on for all.
- Should turning an add-on off also disable its Claude Code plugin parts? Today Settings › Plugins controls those separately.

## Future work

1. Orchestrator tools from an add-on's MCP server, and `choo-choo.json` pins so a repo can name the add-ons its team should install.
2. Plan board: a visual plan of tasks that runs one worktree workspace per task. It lives in a private repo, which also tests private sources end to end. Needs host methods for files under `.choo-choo/` in a repo.
3. Workspace sources ("New plan from…"), an OAuth host method, a template repo for private add-ons, managed settings for fleets.
