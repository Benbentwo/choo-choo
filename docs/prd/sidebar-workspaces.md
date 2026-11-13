# PRD: Arranging and renaming workspaces in the sidebar

| | |
|---|---|
| Status | In review |
| Owner | Claude |
| Requested by | Ben, 2026-11-09 |
| Last updated | 2026-11-10 |

## Problem

> Session or work trees, little sessions on the side underneath a workspace, should be able to be dragged and reordered along with you should be able to right-click them and either regenerate the name based on current context or rename it manually yourself.

Workspaces under a project could only be sorted by date or name. Their title came from the first prompt, so once the work moved on the title went stale, and there was no way to change it.

## Goals

- Drag workspaces into the order you want, and have it stick.
- Right-click a workspace to rename it, or have Claude rename it from what the chat is about now.

## Non-goals

- Renaming the branch. The title is a label; the branch may already be pushed or have a PR.
- Dragging workspaces between projects.
- Renaming chat tabs (a separate request if wanted).

## User experience

- **Drag to reorder.** Drag a workspace row up or down; an accent line shows where it lands. With "Group by project" you reorder within a project; with "Group by none" across the whole list. The orchestrator stays pinned at the top and can't be dragged. The first drag switches View options > Sort by to **Manual (drag to sort)**; picking Newest, Oldest or Name sorts that way again without losing the manual order, which comes back when you pick Manual. New workspaces appear at the top of a manual list.
- **Right-click menu** on a workspace row: Rename…, Regenerate name, Reveal in Finder, Copy branch name, Archive workspace. On the orchestrator it only offers Hide from sidebar. When the workspace's branch has a PR, the menu starts with **Copy link to #n** and **Open #n on GitHub**, in the repo list and under a project alike.
- **PR state on the row icon** (Ben, 2026-11-10: "this icon should change to be a merged icon (purple) when merged. and this branch icon should be green when approved"). A workspace whose PR is merged shows a purple merged icon; one whose open PR has an approving review shows the branch icon in green. Other rows keep the plain branch icon, and a stack keeps its stack icon. `usePrState` (`src/renderer/src/prState.ts`) reads each row's PR through `pr:state`, a few at a time, and again when the PR watcher reports a change.
- **Hiding rows** (Ben, 2026-11-10: "right-click an orchestrator or plans … and hide it, because right now they're just filling up my vertical space"). Right-click a project's Orchestrator row, an add-on row under a project (such as Plans), or an add-on row at the top of the sidebar, and pick **Hide from sidebar**. Hiding is per project: hiding Plans in one project leaves it in the others. The project row's orchestrator button still opens a hidden orchestrator, and a hidden row shows while it's the open page (and the orchestrator also while it waits on you), so the page you're on never disappears. To bring rows back: the project's ⋯ menu lists **Show Orchestrator**, **Show Plans** and so on, and View options > **Hidden rows (N)** lists every hidden row with **Show all**.
- **Collapsing a project** (Ben, 2026-11-10: "if you click on the icon of the workspace, it'll hide all of its children to conserve vertical space"). Click a project's icon (it turns into a chevron on hover) to collapse the project to its one row: its workspaces, Orchestrator, add-on rows, pin row and archived list are hidden. A collapsed project shows how many workspaces it holds, and an accent dot when one of them is unread or waiting on you. Click again to expand. The project row's buttons (orchestrator, new workspace, ⋯) still work while collapsed.
- **Folding the whole list** (Ben, 2026-11-12: "This repo's header should also be foldable like projects"). Click the **Repos** header (My workspaces when Projects is off) to fold every repo under it; a chevron shows the state and an accent dot appears when a workspace is unread or waiting on you. The header's View options and Add project buttons stay. The state is kept in `Settings.sidebarCollapsed` as `section:repos`.
- **Rename…** (or double-click the title) turns the title into a text field. Enter or clicking away saves; Escape cancels. Empty names are ignored.
- **Regenerate name** shows a spinner on the row while Haiku reads the conversation, then replaces the title. If the workspace has no messages yet, or the model doesn't answer, an error says so and the title is unchanged.

## Requirements

1. Manual order is stored per workspace (`Workspace.order`) and survives restarts.
2. A renamed or regenerated title is never overwritten by first-prompt naming (`named` is set).
3. Regenerating uses only the person's messages and the agent's replies (no tool calls or advisor messages), most recent 6,000 characters, with secrets redacted.
4. Hidden rows are stored in `Settings.sidebarHidden` and collapsed projects in `Settings.sidebarCollapsed`; both survive restarts. Hiding never stops an orchestrator or turns off an add-on; it only removes the row.

## Design

- `src/shared/sidebarOrder.ts`: `sortWorkspaces` (adds the `manual` sort) and `moveId`.
- `src/main/naming.ts`: `namingContext` builds the transcript; `suggestTitleFromChats` asks Haiku through the Agent SDK, the same way first-prompt naming does.
- IPC (`Api`): `regenerateWorkspaceName(id)`, `reorderWorkspaces(ids)`; `renameWorkspace` now trims, caps at 80 characters and sets `named`.
- `src/renderer/src/components/Sidebar.tsx`: drag handling and the context menu on `WsRow`. `Menu` takes an `at` point for right-click menus.
- `src/shared/sidebarHidden.ts`: keys for hidden rows (`orchestrator:<repoId>`, `view:<repoId>:<addon>/<view>`, `view::<addon>/<view>` for top-level add-on rows). `setSidebarRowHidden` in the store saves them.

## Compliance, privacy and security

- Regenerate name runs Haiku through the official Agent SDK and the person's own Claude Code sign-in ([0001](../decisions/0001-official-claude-access-only.md)). It runs only when the person picks it.
- The transcript excerpt goes through `redactSecrets` before it's sent.

## Testing

`test/sidebar-order.test.ts` covers the sort, the move and the naming context; `test/sidebar-hidden.test.ts` covers hidden-row keys. Manual: `npm run dev`, drag rows in both groupings, rename, regenerate on a workspace with and without messages.

## Rollout

On for everyone. Existing workspaces have no `order` and keep sorting by newest until someone drags one.
