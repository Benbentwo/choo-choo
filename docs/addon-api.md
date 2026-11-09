# Writing an add-on

An add-on is a [Claude Code plugin](https://code.claude.com/docs/en/plugins) with one extra file, `choo-choo.addon.json`. The plugin's skills, agents, hooks and MCP servers work as in any Claude Code plugin. The manifest adds views to the Choo Choo app and says what they may do. A working example is in [examples/addons](../examples/addons); the reasons behind the design are in [decision 0006](decisions/0006-add-ons-are-claude-code-plugins.md).

## Layout

```
my-addon/
  .claude-plugin/plugin.json   Claude Code plugin manifest
  choo-choo.addon.json         Choo Choo manifest
  ui/index.html                a view (any path you like)
```

To ship add-ons, put them in a git repo with a `.claude-plugin/marketplace.json` listing them (a Claude Code plugin marketplace). People add that repo under Settings › Add-ons › Add source. A private repo works: Choo Choo fetches it with the person's own git and GitHub access. Add the keyword `choo-choo-addon` to the marketplace entry so the add-on is listed before it is installed even when its source is another repo.

## The manifest

```json
{
  "apiVersion": 1,
  "name": "Workspace board",
  "description": "Every workspace as a card.",
  "permissions": ["repos:read", "workspaces:read", "workspaces:start", "storage"],
  "views": [
    { "id": "board", "slot": "app", "title": "Board", "entry": "ui/board.html" },
    { "id": "repo-board", "slot": "repo", "title": "Board", "entry": "ui/board.html" },
    { "id": "notes", "slot": "workspace", "title": "Notes", "entry": "ui/notes.html" }
  ]
}
```

| Field | Meaning |
|---|---|
| `apiVersion` | The host API version you wrote against. `1` today. A newer number than the app knows is refused with "Needs a newer Choo Choo". |
| `name`, `description` | Shown in Settings. Default to the plugin's. |
| `permissions` | What your views may do. People see this list, in plain words, before they turn the add-on on. Ask for more in a later version and the add-on pauses until they review it. |
| `views` | Up to 8. `id`: lowercase letters, digits, dashes. `title`: at most 40 characters. `entry`: an `.html` file inside the add-on. |

Slots:

| `slot` | Where it shows | `choo.context` has |
|---|---|---|
| `app` | The sidebar's top list, below Search. Opens in the center. | `viewId` |
| `repo` | Under each project, above its workspaces. Opens in the center. | `viewId`, `repoId` |
| `workspace` | A tab in the right panel beside each workspace. | `viewId`, `repoId`, `workspaceId` |

If the manifest has any problem the add-on isn't loaded, and Settings › Add-ons lists every problem.

## The sandbox

A view is a web page in a sandboxed frame. It has no Node, can't see the app window, has no `localStorage` or cookies (use `choo.store`), can't open windows, and can only load its own files, plus `https://` hosts named in `net:<host>` permissions. Inline scripts and styles are allowed. Dotfiles in your add-on are never served. Links and `location` changes work between your own pages only: the frame can't go to a web page or another add-on's pages.

Load the client first:

```html
<script src="/@choo/host.js"></script>
<script>
  choo.ready.then(async () => {
    const list = await choo.workspaces.list({ repoId: choo.context.repoId })
    choo.on('workspaces', () => { /* something changed: list again */ })
  })
</script>
```

`choo.ready` resolves once the app has sent your context and theme. Every method returns a promise, and rejects with a readable message when the permission is missing, an argument is wrong, or the app refuses.

## Theme

The client sets CSS variables on `<html>` and keeps them current: `--choo-bg`, `--choo-panel`, `--choo-sidebar`, `--choo-raised`, `--choo-hover`, `--choo-line`, `--choo-fg`, `--choo-muted`, `--choo-faint`, `--choo-add`, `--choo-del`, `--choo-code`, `--choo-accent`, `--choo-font-sans`, `--choo-font-mono`. It also sets `color-scheme` and `data-choo-theme="dark|light"`. The same values are in `choo.theme` and `choo.dark`; `choo.on('theme', cb)` fires when they change.

## Host API v1

| Method | Permission | What it does |
|---|---|---|
| `choo.app.info()` | none | `{ apiVersion, appVersion, addon: { id, name, permissions } }` |
| `choo.repos.list()` | `repos:read` | Projects: `{ id, name, defaultBranch }` |
| `choo.workspaces.list({ repoId? })` | `workspaces:read` | Live workspaces: `{ id, repoId, title, branch, status, unread, orchestrated, startedBy?, createdAt, lastMessage }`. `status` is `running`, `needs-approval`, `in-cloud`, `error` or `idle`. `startedBy` is the add-on id that started it. |
| `choo.workspaces.read(workspaceId, { last? })` | `chat:read` | `{ workspace, entries }`: the last `last` (default 40, max 200) transcript entries, each `{ kind, text, ts, ok? }` with kind `user`, `assistant`, `tool`, `note`, `error` or `turn-end`. |
| `choo.workspaces.start({ repoId, task, title?, model?, planFirst? })` | `workspaces:start` | Creates a worktree, branch and agent, and sends it `task`. Returns the workspace right away; the agent works in the background. At most 8 of your workspaces can be running at once. |
| `choo.workspaces.message(workspaceId, message)` | `workspaces:message` | Sends a follow-up. Fails while the agent is running. |
| `choo.workspaces.stop(workspaceId)` | `workspaces:stop` | Stops the workspace's running agents. |
| `choo.prs.status(workspaceId)` | `prs:read` | `{ pr: { number, url, state, isDraft, title, reviewDecision, mergeState } \| null, checks: { total, passed, pending, failed: [{ name, link }] } }` |
| `choo.store.get(key)` / `set(key, value)` / `delete(key)` / `keys()` | `storage` | Your add-on's own JSON storage on this Mac, 1 MB in total. |
| `choo.ui.openWorkspace(workspaceId)` | none | Shows the workspace in the app. |
| `choo.ui.notify(title, body?, workspaceId?)` | `notify` | A system notification, prefixed with your add-on's name. Respects the person's notification setting. |
| `net:<host>` | (a permission, not a method) | Lets views `fetch` and load images from `https://<host>`. `*.example.com` covers subdomains. |

Events: `choo.on('workspaces', cb)` fires (with no data) when a workspace or a chat's status changes; call `list` again. `choo.on('theme', cb)` fires when colors change. Both return a function that stops listening.

Archived workspaces and orchestrator chats are never visible to add-ons.

## Trying yours

1. Settings › Add-ons › Add source: paste the path to your marketplace folder.
2. Install it and turn it on.
3. With a folder as the source, Choo Choo reads the add-on straight from it: edit a file, then reopen the view. After changing the manifest, press Check again in Settings › Add-ons.

With a git repo as the source, push your change and update the plugin (`claude plugin update <name>@<source>`).

## Compatibility

Within `apiVersion: 1`, methods and permissions are only added, never changed or removed. Check `choo.apiVersion` or `choo.app.info()` if you use something newer than 1.0.
