# Writing an add-on

An add-on is a [Claude Code plugin](https://code.claude.com/docs/en/plugins) with one extra file, `choo-choo.addon.json`. The plugin's skills, agents, hooks and MCP servers work as in any Claude Code plugin. The manifest adds views to the Choo Choo app, can give the orchestrator tools, and says what the add-on may do. A working example is in [examples/addons](../examples/addons); the reasons behind the design are in [decision 0006](decisions/0006-add-ons-are-claude-code-plugins.md).

## Layout

```
my-addon/
  .claude-plugin/plugin.json   Claude Code plugin manifest
  choo-choo.addon.json         Choo Choo manifest
  ui/index.html                a view (any path you like)
  ui/background.html           optional: runs unseen while the add-on is on
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
| `background` | Optional. An `.html` file that runs, unseen, for as long as the add-on is on. See [The background page](#the-background-page). |
| `tools` | Optional, up to 24. Tools for the orchestrator. See [Tools for the orchestrator](#tools-for-the-orchestrator). |
| `actions` | Optional, up to 16. Buttons in the app. See [Buttons in the app](#buttons-in-the-app). |

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

## The background page

Views only run while they're on screen. For work that should carry on regardless (move a plan forward when a pull request merges, notify when something finishes), name a page in `background`:

```json
{ "apiVersion": 1, "permissions": ["workspaces:read", "notify"], "background": "ui/background.html" }
```

It is a page like any view: same sandbox, same `window.choo`, same permissions. Nobody sees it. It starts with the app (or when the add-on is turned on) and stops when the add-on is turned off. Its `choo.context` is `{ viewId: "@background" }`. A new version of the add-on restarts it, so keep anything that must survive in `choo.store`.

The background page and the views don't talk to each other directly. They share `choo.store`: one writes, the others hear `choo.on('store', (e) => …)` with the key that changed, and read it.

## Tools for the orchestrator

An add-on can give the [orchestrator](prd/orchestrator.md) tools. List them in the manifest and answer them in the background page:

```json
{
  "apiVersion": 1,
  "permissions": ["workspaces:read", "storage", "orchestrator:tools"],
  "background": "ui/background.html",
  "tools": [
    { "name": "board_summary", "description": "List this project's workspaces with the note kept on each.", "readOnly": true },
    {
      "name": "set_note",
      "description": "Write the note on a workspace.",
      "input": { "type": "object", "properties": { "workspace_id": { "type": "string" }, "note": { "type": "string" } }, "required": ["workspace_id", "note"] }
    }
  ]
}
```

```html
<script src="/@choo/host.js"></script>
<script>
  choo.tools.handle('set_note', async ({ workspace_id, note }, ctx) => {
    // ctx.repoIds: the projects of the orchestrator that is asking.
    await choo.store.set(`notes:${workspace_id}`, note)
    return 'Saved.'
  })
</script>
```

| Field | Meaning |
|---|---|
| `name` | Lowercase letters, digits and underscores, starting with a letter. The orchestrator sees it as `mcp__addon-<plugin name>__<name>`. |
| `description` | What the orchestrator reads to decide when to call it. At most 1000 characters. |
| `input` | A JSON Schema with `"type": "object"`, at most 8 KB. Arguments are checked against it before your handler runs. Leave it out for a tool with no arguments. |
| `readOnly` | `true` if the tool changes nothing. Read-only tools run without asking the person; others follow the orchestrator chat's permission setting. |

Tools need a `background` page and the `orchestrator:tools` permission. People see the tool names and descriptions before they turn the add-on on.

A handler gets the arguments and `{ repoIds }`, and can use everything `window.choo` gives the add-on. What it returns is the tool's answer: a string as it is, anything else as JSON, cut at 100,000 characters. What it throws is shown to the orchestrator as the tool's error. It has five minutes to answer.

## Buttons in the app

An add-on can put buttons in the app's own interface: at the top of a workspace beside its pull request button, on rows in the sidebar, and in the ⌘K palette. You list them in the manifest; the app draws them. Your code never runs in the app's interface, so a button is a title, one of the app's icons, and a place:

```json
{
  "apiVersion": 1,
  "permissions": ["workspaces:read", "storage", "ui:buttons"],
  "views": [
    { "id": "plans", "slot": "repo", "title": "Plans", "entry": "ui/board.html" },
    { "id": "notes", "slot": "workspace", "title": "Notes", "entry": "ui/notes.html" }
  ],
  "background": "ui/background.html",
  "actions": [
    { "id": "import", "title": "Import a plan", "icon": "import", "place": "view-row", "view": "plans" },
    { "id": "note", "title": "Write a note", "icon": "comment", "place": "workspace-row", "view": "notes" },
    { "id": "looked", "title": "Note that you looked at this", "icon": "check", "place": "workspace-header" }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Lowercase letters, digits, dashes. Unique in the add-on. |
| `title` | The tooltip, and the button's name in the palette. At most 40 characters. The app adds "(your add-on's name add-on)". |
| `icon` | One of `plus`, `import`, `refresh`, `search`, `play`, `check`, `branch`, `pr`, `file`, `folder`, `chart`, `comment`, `eye`, `tool`. |
| `place` | Where it shows. See below. |
| `view` | Optional. The id of one of your views. A press opens that view, then tells it. Without `view`, the press goes to your background page. |

| `place` | Where it shows | A press comes with |
|---|---|---|
| `workspace-header` | At the top of a workspace's right panel, beside Review and the pull request button. | `repoId`, `workspaceId` |
| `workspace-row` | On each workspace's row in the sidebar, when the pointer is over it. | `repoId`, `workspaceId` |
| `project-row` | On each project's row in the sidebar, when the pointer is over it. | `repoId` |
| `view-row` | On the sidebar row of the view named in `view`, always visible. The view must be in the `app` or `repo` slot. | `repoId` for a `repo` view |
| `palette` | In the ⌘K palette, under Add-ons. | `repoId` and `workspaceId` of the open workspace, when there is one |

Answer a press with `choo.actions.handle`, in the view the button opens or in the background page:

```html
<script src="/@choo/host.js"></script>
<script>
  // In ui/board.html. A press that opened the view is passed on too, even if it came before this line ran.
  choo.actions.handle('import', ({ place, repoId }) => showImportForm())
</script>
```

```html
<script>
  // In ui/background.html: a button with no view. Nothing is shown unless you show it.
  choo.actions.handle('looked', async ({ workspaceId }) => {
    await choo.store.set(`looked:${workspaceId}`, Date.now())
  })
</script>
```

Rules the app keeps:

- Buttons need the `ui:buttons` permission. People see each button's title and place before they turn the add-on on.
- At most 2 buttons per place, 8 in the palette. Other add-ons share the same places.
- A button that opens a `repo` view only shows where there is a project, and one that opens a `workspace` view only where there is a workspace. A `project-row` button can't open a `workspace` view.
- A button without `view` needs a `background` page.
- Buttons never show on orchestrator chats or archived workspaces.
- A button can't be hidden, disabled or renamed while the app runs, and it can't carry a count. If a press makes no sense where it happened, say so with `choo.ui.notify` or in the view you open.

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
| `choo.files.list(repoId, dir?)` | `files:read` | Text files in the project's `.choo-choo/` folder (main checkout), up to 500: `{ path, size, modified }`, with `path` relative to `.choo-choo/`. |
| `choo.files.read(repoId, path)` | `files:read` | `{ content, modified }`, or `null` when there is no such file. |
| `choo.files.write(repoId, path, content)` / `delete(repoId, path)` | `files:write` | Creates, replaces or deletes a file under `.choo-choo/`. Only `.md`, `.json`, `.txt`, `.yaml` and `.yml`, at most 1 MB, no dotfiles, and never through a symlink. The change is an ordinary uncommitted edit in the project. |
| `choo.store.get(key)` / `set(key, value)` / `delete(key)` / `keys()` | `storage` | Your add-on's own JSON storage on this Mac, 1 MB in total. |
| `choo.actions.handle(id, fn)` | none | Answers presses of the button `id` from the manifest's `actions`: `fn({ place, repoId?, workspaceId? })`. See [Buttons in the app](#buttons-in-the-app). |
| `choo.ui.openWorkspace(workspaceId)` | none | Shows the workspace in the app. |
| `choo.ui.notify(title, body?, workspaceId?)` | `notify` | A system notification, prefixed with your add-on's name. Respects the person's notification setting. |
| `net:<host>` | (a permission, not a method) | Lets views `fetch` and load images from `https://<host>`. `*.example.com` covers subdomains. |

| `orchestrator:tools` | (a permission, not a method) | Lets the add-on list `tools` for the orchestrator. |
| `ui:buttons` | (a permission, not a method) | Lets the add-on list `actions`: buttons in the app. |

Events, each returning a function that stops listening:

| Event | Fires when | Data |
|---|---|---|
| `choo.on('workspaces', cb)` | A workspace or a chat's status changes. Call `list` again. | none |
| `choo.on('prs', cb)` | A workspace's pull request or its checks changed. Needs `prs:read`. | `{ workspaceId }` |
| `choo.on('store', cb)` | Your add-on's storage changed, from any of its pages or tools. | `{ key }` |
| `choo.on('theme', cb)` | Colors or fonts changed. | `{ theme, dark }` |

Archived workspaces and orchestrator chats are never visible to add-ons.

## Asking a team to use your add-on

A project can name the add-ons its team should have in the `choo-choo.json` at its root, next to its scripts:

```json
{
  "addons": {
    "sources": ["acme/choo-addons"],
    "required": ["plan-board@acme-addons"],
    "recommended": ["release-notes@acme-addons"]
  }
}
```

`sources` are `owner/repo` or git URLs (not folders). `required` and `recommended` are plugin ids, `name@source`, where the source's name is the `name` in its `marketplace.json`. Someone who has the project in Choo Choo sees "Set up Plan board" under it, and Settings › Add-ons lists what the project asks for with Install and Turn on buttons. Nothing is added or installed without a click, and turning an add-on on still shows its permissions. A recommended add-on can be turned down with "Not now"; a required one keeps its reminder.

## Trying yours

1. Settings › Add-ons › Add source: paste the path to your marketplace folder.
2. Install it and turn it on.
3. With a folder as the source, Choo Choo reads the add-on straight from it: edit a file, then reopen the view. After changing the manifest, press Check again in Settings › Add-ons.

With a git repo as the source, push your change and update the plugin (`claude plugin update <name>@<source>`).

## Compatibility

Within `apiVersion: 1`, methods and permissions are only added, never changed or removed. Check `choo.apiVersion` or `choo.app.info()` if you use something newer than 1.0.
