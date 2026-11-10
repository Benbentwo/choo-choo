/**
 * Add-ons: Claude Code plugins that also carry a `choo-choo.addon.json`. The plugin's skills,
 * agents, hooks and MCP servers load through Claude Code as always; the manifest says what the
 * add-on adds to the Choo Choo app (views) and what it may do through the host API.
 * See docs/prd/add-ons.md and docs/addon-api.md.
 */

/** The host API version this build speaks. A manifest asking for a newer one is not loaded. */
export const ADDON_API_VERSION = 1
export const ADDON_MANIFEST = 'choo-choo.addon.json'
/** A marketplace entry with this keyword (or category) is listed as an add-on before it's installed. */
export const ADDON_KEYWORD = 'choo-choo-addon'
export const ADDON_SCHEME = 'choo-addon'

/** Where a view shows: the sidebar's top list, under each project, or a tab beside a workspace. */
export type AddonSlot = 'app' | 'repo' | 'workspace'
const SLOTS: AddonSlot[] = ['app', 'repo', 'workspace']

export interface AddonView {
  id: string
  slot: AddonSlot
  title: string
  /** HTML file inside the add-on folder, e.g. `ui/index.html`. */
  entry: string
}

/** Icons a button can use. The app draws them, so an add-on's button looks like the app's own. */
export const ACTION_ICONS = ['plus', 'import', 'refresh', 'search', 'play', 'check', 'branch', 'pr', 'file', 'folder', 'chart', 'comment', 'eye', 'tool'] as const
export type AddonActionIcon = (typeof ACTION_ICONS)[number]

/**
 * Where a button shows: the top of a workspace beside its pull request button, a workspace's row
 * or a project's row in the sidebar, the row of one of the add-on's own views, or the ⌘K palette.
 */
export const ACTION_PLACES = ['workspace-header', 'workspace-row', 'project-row', 'view-row', 'palette'] as const
export type AddonActionPlace = (typeof ACTION_PLACES)[number]

/** How many buttons one add-on may put in one place, so no add-on can crowd the app. */
export const maxActions = (place: AddonActionPlace) => (place === 'palette' ? 8 : 2)

/**
 * A button the add-on asks the app to show. The app draws it from these words and its own icons;
 * nothing of the add-on's runs in the app's interface. A press goes to `view` when there is one
 * (the app opens it first), otherwise to the add-on's background page.
 */
export interface AddonAction {
  id: string
  /** The button's tooltip, and its name in the palette. */
  title: string
  icon: AddonActionIcon
  place: AddonActionPlace
  /** The id of one of the add-on's views to open. */
  view?: string
}

/** A tool the add-on gives the orchestrator. Its background page answers the calls. */
export interface AddonTool {
  name: string
  description: string
  /** JSON Schema for the arguments: an object schema. No arguments when missing. */
  input?: Record<string, unknown>
  /** Only reads, so the orchestrator may call it without asking the person. */
  readOnly?: boolean
}

export interface AddonManifest {
  apiVersion: number
  /** Display name; the plugin's name when missing. */
  name?: string
  description?: string
  permissions: string[]
  views: AddonView[]
  /** HTML file that runs, unseen, for as long as the add-on is on. */
  background?: string
  tools: AddonTool[]
  /** Buttons in the app. Left out when there are none. */
  actions?: AddonAction[]
}

/** The view id a background page gets in its context. */
export const BACKGROUND_VIEW = '@background'

/** What the person agreed to for one add-on, kept in Settings. */
export interface AddonGrant {
  enabled: boolean
  /** The permissions shown when it was turned on. New ones pause the add-on until reviewed. */
  granted: string[]
}

export type AddonState =
  /** Running. */
  | 'on'
  /** Installed, not turned on in Choo Choo. */
  | 'off'
  /** Turned on, but it now asks for permissions the person hasn't seen. */
  | 'review'
  /** Its Claude Code plugin is disabled in Settings > Plugins. */
  | 'plugin-off'
  /** The manifest is missing something or needs a newer Choo Choo. */
  | 'invalid'

export interface AddonInfo {
  /** The plugin id, `name@marketplace`. */
  id: string
  /** Host-safe key used in `choo-addon://<key>/` URLs and storage file names. */
  key: string
  name: string
  description: string
  version: string
  marketplace: string
  state: AddonState
  manifest?: AddonManifest
  errors: string[]
  granted: string[]
}

/** An add-on a source offers that isn't installed yet. */
export interface AvailableAddon {
  id: string
  name: string
  description: string
  marketplace: string
  /** Read from the source's checkout when it has one, to preview permissions before installing. */
  manifest?: AddonManifest
}

export interface AddonSource {
  name: string
  source: string
}

/** Where a view is mounted, sent with every call from it. */
export interface AddonContext {
  viewId: string
  repoId?: string
  workspaceId?: string
}

interface PermissionText {
  label: string
  detail: string
}

const PERMISSIONS: Record<string, PermissionText> = {
  'repos:read': { label: 'See your projects', detail: 'Names and default branches of the projects in Choo Choo.' },
  'workspaces:read': { label: 'See workspaces and their status', detail: 'Titles, branches, whether an agent is running or waiting for you, and the last thing it said.' },
  'chat:read': { label: 'Read chat transcripts', detail: 'What you and the agents wrote in a workspace, and which tools ran.' },
  'workspaces:start': { label: 'Start workspaces', detail: 'Create a worktree and branch and give its agent a task, or open a pull request in a workspace of its own. Agents run with your default permissions.' },
  'workspaces:message': { label: 'Message agents', detail: 'Send a follow-up to the agent in an existing workspace.' },
  'workspaces:stop': { label: 'Stop agents', detail: "Stop a workspace's running agent." },
  'prs:read': { label: 'See pull requests and checks', detail: "Each workspace's pull request, and any pull request of your projects it asks for by number: its state and its CI checks." },
  'files:read': { label: "Read your projects' .choo-choo folders", detail: "Text files in the .choo-choo folder of each project's main checkout and of its workspaces, such as plans. Nothing else in the project." },
  'files:write': { label: "Change your projects' .choo-choo folders", detail: "Create, change and delete text files in the .choo-choo folder of each project's main checkout. They show up in git like any other change." },
  storage: { label: 'Keep its own data on this Mac', detail: 'Up to 1 MB, only readable by this add-on.' },
  notify: { label: 'Show notifications', detail: 'System notifications with a title and a line of text.' },
  'orchestrator:tools': { label: 'Give the orchestrator tools', detail: 'The orchestrator can call the tools this add-on lists, and acts on what they answer.' },
  'ui:buttons': { label: 'Add buttons to the app', detail: 'Buttons on workspaces, projects and in the command palette. Each one says in its tooltip that it comes from this add-on, and pressing it tells the add-on which workspace or project you were on.' }
}

/** Needed by an add-on that lists tools. No host API method asks for it. */
export const TOOLS_PERMISSION = 'orchestrator:tools'
/** Needed by an add-on that lists actions. No host API method asks for it. */
export const ACTIONS_PERMISSION = 'ui:buttons'

const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/** The host of a `net:<host>` permission, or null when it isn't one or isn't a plain host name. */
export function netHost(permission: string): string | null {
  if (!permission.startsWith('net:')) return null
  const host = permission.slice(4)
  return HOST.test(host) ? host : null
}

export const isKnownPermission = (p: string) => p in PERMISSIONS || netHost(p) !== null

/** Plain words for the install dialog. */
export function describePermission(p: string): PermissionText {
  const host = netHost(p)
  if (host) return { label: `Talk to ${host}`, detail: `Its views can send and load data from https://${host}.` }
  return PERMISSIONS[p] ?? { label: p, detail: 'Not a permission this version of Choo Choo knows.' }
}

/** Which permission each host API method needs. null means any enabled add-on may call it. */
export const METHOD_PERMISSION: Record<string, string | null> = {
  'app.info': null,
  'ui.openWorkspace': null,
  'ui.notify': 'notify',
  'repos.list': 'repos:read',
  'workspaces.list': 'workspaces:read',
  'workspaces.read': 'chat:read',
  'workspaces.start': 'workspaces:start',
  'workspaces.message': 'workspaces:message',
  'workspaces.stop': 'workspaces:stop',
  'workspaces.forPr': 'workspaces:start',
  'prs.status': 'prs:read',
  'prs.get': 'prs:read',
  'files.list': 'files:read',
  'files.read': 'files:read',
  'files.write': 'files:write',
  'files.delete': 'files:write',
  'store.get': 'storage',
  'store.set': 'storage',
  'store.delete': 'storage',
  'store.keys': 'storage'
}

/** Throws unless `method` exists and the add-on was granted what it needs. */
export function checkCall(method: string, granted: string[]) {
  if (!(method in METHOD_PERMISSION)) throw new Error(`Unknown method ${method}`)
  const need = METHOD_PERMISSION[method]
  if (need && !granted.includes(need)) throw new Error(`This add-on doesn't have the "${need}" permission, which ${method} needs. Add it to permissions in ${ADDON_MANIFEST}.`)
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null)

/** True for a relative path that stays inside its folder and has no odd characters. */
export function safeRelativePath(p: string): boolean {
  if (!p || p.length > 300 || p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

/**
 * Checks a parsed `choo-choo.addon.json`. Returns the manifest when it can be loaded, and every
 * problem found either way, worded for the add-on's author.
 */
export function parseManifest(raw: unknown): { manifest?: AddonManifest; errors: string[] } {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: [`${ADDON_MANIFEST} must be a JSON object`] }
  const m = raw as Record<string, unknown>
  if (!Number.isInteger(m.apiVersion) || (m.apiVersion as number) < 1) errors.push('apiVersion must be a whole number, starting at 1')
  else if ((m.apiVersion as number) > ADDON_API_VERSION) errors.push(`Needs a newer Choo Choo (add-on API ${m.apiVersion}; this version has ${ADDON_API_VERSION})`)

  const permissions: string[] = []
  if (m.permissions !== undefined && !Array.isArray(m.permissions)) errors.push('permissions must be a list')
  for (const p of Array.isArray(m.permissions) ? m.permissions : []) {
    if (typeof p !== 'string' || !isKnownPermission(p)) errors.push(`Unknown permission ${JSON.stringify(p)}`)
    else if (!permissions.includes(p)) permissions.push(p)
  }

  const views: AddonView[] = []
  if (m.views !== undefined && !Array.isArray(m.views)) errors.push('views must be a list')
  const rawViews = Array.isArray(m.views) ? m.views : []
  if (rawViews.length > 8) errors.push('An add-on can have at most 8 views')
  for (const v of rawViews.slice(0, 8)) {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    const id = str(o.id, 40)
    const title = str(o.title, 40)
    const entry = str(o.entry, 300)
    if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) errors.push(`A view's id must be lowercase letters, digits and dashes (got ${JSON.stringify(o.id)})`)
    else if (views.some((x) => x.id === id)) errors.push(`Two views are both called ${id}`)
    else if (!title) errors.push(`View ${id} needs a title of at most 40 characters`)
    else if (!SLOTS.includes(o.slot as AddonSlot)) errors.push(`View ${id}: slot must be one of ${SLOTS.join(', ')}`)
    else if (!entry || !safeRelativePath(entry) || !/\.html?$/.test(entry)) errors.push(`View ${id}: entry must be an .html file inside the add-on, like ui/index.html`)
    else views.push({ id, slot: o.slot as AddonSlot, title, entry })
  }

  let background: string | undefined
  if (m.background !== undefined) {
    const entry = str(m.background, 300)
    if (!entry || !safeRelativePath(entry) || !/\.html?$/.test(entry)) errors.push('background must be an .html file inside the add-on, like ui/background.html')
    else background = entry
  }

  const tools: AddonTool[] = []
  if (m.tools !== undefined && !Array.isArray(m.tools)) errors.push('tools must be a list')
  const rawTools = Array.isArray(m.tools) ? m.tools : []
  if (rawTools.length > MAX_TOOLS) errors.push(`An add-on can have at most ${MAX_TOOLS} tools`)
  for (const t of rawTools.slice(0, MAX_TOOLS)) {
    const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
    const name = str(o.name, 48)
    const description = str(o.description, 1000)
    const input = o.input
    if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) errors.push(`A tool's name must be lowercase letters, digits and underscores, starting with a letter (got ${JSON.stringify(o.name)})`)
    else if (tools.some((x) => x.name === name)) errors.push(`Two tools are both called ${name}`)
    else if (!description) errors.push(`Tool ${name} needs a description of at most 1000 characters`)
    else if (input !== undefined && !isObjectSchema(input)) errors.push(`Tool ${name}: input must be a JSON Schema with "type": "object", at most 8 KB`)
    else tools.push({ name, description, ...(input ? { input: input as Record<string, unknown> } : {}), ...(o.readOnly === true ? { readOnly: true } : {}) })
  }
  if (rawTools.length && !background) errors.push('tools need a background page to answer them: set background to an .html file')
  if (rawTools.length && !permissions.includes(TOOLS_PERMISSION)) errors.push(`tools need the "${TOOLS_PERMISSION}" permission`)

  const actions = parseActions(m.actions, views, !!background, errors)
  if (actions.length && !permissions.includes(ACTIONS_PERMISSION)) errors.push(`actions need the "${ACTIONS_PERMISSION}" permission`)

  if (errors.length) return { errors }
  return {
    manifest: { apiVersion: m.apiVersion as number, name: str(m.name, 60) ?? undefined, description: str(m.description, 300) ?? undefined, permissions, views, ...(background ? { background } : {}), tools, ...(actions.length ? { actions } : {}) },
    errors
  }
}

const MAX_TOOLS = 24

const MAX_ACTIONS = 16

/** The manifest's buttons. Problems go to `errors`, worded for the add-on's author. */
function parseActions(raw: unknown, views: AddonView[], hasBackground: boolean, errors: string[]): AddonAction[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    errors.push('actions must be a list')
    return []
  }
  if (raw.length > MAX_ACTIONS) errors.push(`An add-on can have at most ${MAX_ACTIONS} actions`)
  const actions: AddonAction[] = []
  for (const a of raw.slice(0, MAX_ACTIONS)) {
    const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
    const id = str(o.id, 40)
    const title = str(o.title, 40)
    const place = o.place as AddonActionPlace
    const view = o.view === undefined ? undefined : views.find((v) => v.id === o.view)
    if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) errors.push(`An action's id must be lowercase letters, digits and dashes (got ${JSON.stringify(o.id)})`)
    else if (actions.some((x) => x.id === id)) errors.push(`Two actions are both called ${id}`)
    else if (!title) errors.push(`Action ${id} needs a title of at most 40 characters`)
    else if (!ACTION_ICONS.includes(o.icon as AddonActionIcon)) errors.push(`Action ${id} needs an icon, one of ${ACTION_ICONS.join(', ')}`)
    else if (!ACTION_PLACES.includes(place)) errors.push(`Action ${id}: place must be one of ${ACTION_PLACES.join(', ')}`)
    else if (o.view !== undefined && !view) errors.push(`Action ${id}: view must be the id of one of this add-on's views (got ${JSON.stringify(o.view)})`)
    else if (place === 'view-row' && (!view || view.slot === 'workspace')) errors.push(`Action ${id}: a view-row button sits on a sidebar row, so it needs the view of an app or repo view`)
    else if (place === 'project-row' && view?.slot === 'workspace') errors.push(`Action ${id}: a project's row has no workspace, so it can't open the workspace view ${view.id}`)
    else if (!view && !hasBackground) errors.push(`Action ${id} opens no view, so it needs a background page to hear about the press: set background or view`)
    else if (actions.filter((x) => x.place === place).length >= maxActions(place)) errors.push(`At most ${maxActions(place)} actions can go in ${place}`)
    else actions.push({ id, title, icon: o.icon as AddonActionIcon, place, ...(view ? { view: view.id } : {}) })
  }
  return actions
}

/** Where a button was pressed. */
export interface AddonActionContext {
  repoId?: string
  workspaceId?: string
}

/** What an add-on's page is told when one of its buttons is pressed. */
export interface AddonActionPress extends AddonActionContext {
  id: string
  place: AddonActionPlace
}

/** Where a press goes: the background page, a view in the center, or a tab beside a workspace. */
export type AddonActionTarget = { to: 'background' } | { to: 'page'; viewId: string; repoId?: string } | { to: 'tab'; viewId: string; repoId: string; workspaceId: string }

/**
 * Where pressing `action` from `ctx` leads, or null when it can't be pressed there: its view
 * belongs under a project or beside a workspace and `ctx` has none. A button that leads nowhere
 * isn't shown.
 */
export function actionTarget(manifest: AddonManifest, action: AddonAction, ctx: AddonActionContext): AddonActionTarget | null {
  if (!action.view) return manifest.background ? { to: 'background' } : null
  const view = manifest.views.find((v) => v.id === action.view)
  if (!view) return null
  if (view.slot === 'app') return { to: 'page', viewId: view.id }
  if (!ctx.repoId) return null
  if (view.slot === 'repo') return { to: 'page', viewId: view.id, repoId: ctx.repoId }
  return ctx.workspaceId ? { to: 'tab', viewId: view.id, repoId: ctx.repoId, workspaceId: ctx.workspaceId } : null
}

/** The buttons running add-ons put in `place` that can be pressed from `ctx`. With `viewId`, only that view's own row buttons. */
export function addonActions(addons: AddonInfo[], place: AddonActionPlace, ctx: AddonActionContext, viewOf?: { key: string; viewId: string }): { addon: AddonInfo; action: AddonAction }[] {
  return addons
    .filter((a) => a.state === 'on' && a.manifest?.permissions.includes(ACTIONS_PERMISSION) && (!viewOf || a.key === viewOf.key))
    .flatMap((addon) =>
      (addon.manifest!.actions ?? [])
        .filter((action) => action.place === place && (!viewOf || action.view === viewOf.viewId) && actionTarget(addon.manifest!, action, ctx))
        .map((action) => ({ addon, action }))
    )
}

function isObjectSchema(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v) || (v as { type?: unknown }).type !== 'object') return false
  const props = (v as { properties?: unknown }).properties
  if (props !== undefined && (!props || typeof props !== 'object' || Array.isArray(props))) return false
  return JSON.stringify(v).length <= 8192
}

/** The orchestrator's name for an add-on's tool server: the plugin's name, tidied. */
export function toolServerName(key: string): string {
  return `addon-${key.split('.')[0]}`
}

/** What a project's `choo-choo.json` says about add-ons its team should have. */
export interface AddonPins {
  /** Sources to add: `owner/repo` or a git URL. */
  sources: string[]
  /** Plugin ids, `name@source`. */
  required: string[]
  recommended: string[]
}

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9][a-z0-9._-]{0,63}$/i
const SOURCE = /^(?:[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|https:\/\/[a-z0-9][\w.-]*(?::\d+)?\/[\w./~-]+|(?:ssh:\/\/)?git@[a-z0-9][\w.-]*[:/][\w./~-]+)$/i

/** True for `owner/repo` or a git URL. A folder path is refused: a repo must not point the app at local files. */
export const isPinSource = (v: string) => v.length <= 300 && SOURCE.test(v) && !v.includes('..')

/** Reads the `addons` part of a parsed `choo-choo.json`. Anything malformed is dropped, never guessed at. */
export function parsePins(raw: unknown): AddonPins {
  const a = (raw && typeof raw === 'object' ? (raw as { addons?: unknown }).addons : undefined) as Record<string, unknown> | undefined
  const list = (v: unknown, ok: (s: string) => boolean) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && ok(x)))].slice(0, 20)
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { sources: [], required: [], recommended: [] }
  const required = list(a.required, (x) => PLUGIN_ID.test(x))
  return { sources: list(a.sources, isPinSource), required, recommended: list(a.recommended, (x) => PLUGIN_ID.test(x)).filter((x) => !required.includes(x)) }
}

/** One pinned add-on as it stands on this Mac. */
export interface PinnedAddon {
  id: string
  name: string
  required: boolean
  /** `missing` when it isn't installed. */
  state: AddonState | 'missing'
}

/** A project's pins checked against what is installed. */
export interface PinStatus {
  repoId: string
  /** Sources the file names that aren't added yet. */
  newSources: string[]
  addons: PinnedAddon[]
}

/** Two ways of writing the same source compare equal: `Acme/Addons`, `https://github.com/acme/addons.git`. */
export function sourceKey(source: string): string {
  return source
    .trim()
    .toLowerCase()
    .replace(/^(?:https:\/\/|ssh:\/\/)?(?:git@)?github\.com[:/]/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
}

/** A host-safe key for a plugin id: `Plan-Board@acme` becomes `plan-board.acme`. */
export function addonKey(pluginId: string): string {
  return pluginId
    .toLowerCase()
    .split('@')
    .map((part) => part.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'x')
    .join('.')
}

/** Permissions the manifest asks for that the person hasn't agreed to. */
export function missingGrants(manifest: AddonManifest, granted: string[]): string[] {
  return manifest.permissions.filter((p) => !granted.includes(p))
}

export function addonState(opts: { manifest?: AddonManifest; pluginEnabled: boolean; grant?: AddonGrant }): AddonState {
  if (!opts.manifest) return 'invalid'
  if (!opts.grant?.enabled) return 'off'
  if (!opts.pluginEnabled) return 'plugin-off'
  return missingGrants(opts.manifest, opts.grant.granted).length ? 'review' : 'on'
}

/**
 * Content security policy for an add-on's views: its own files, inline code, and only the hosts it
 * was granted. Everything else, including other add-ons' files, is blocked.
 */
export function viewCsp(key: string, granted: string[]): string {
  const self = `${ADDON_SCHEME}://${key}`
  const hosts = granted.flatMap((p) => {
    const h = netHost(p)
    return h ? [`https://${h}`] : []
  })
  const net = hosts.length ? ` ${hosts.join(' ')}` : ''
  return [
    `default-src 'none'`,
    `script-src ${self} 'unsafe-inline'`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:${net}`,
    `font-src ${self} data:`,
    `media-src ${self} data: blob:`,
    `connect-src ${self}${net}`,
    `form-action 'none'`,
    `base-uri 'none'`
  ].join('; ')
}

/** What the main process answers to one host API call. */
export type AddonCallResult = { ok: true; result: unknown } | { ok: false; error: string }

/** Messages between a view and the app window. `choo` marks them so other postMessage traffic is ignored. */
export type AddonRequest =
  | { choo: 1; type: 'hello' }
  | { choo: 1; type: 'call'; id: number; method: string; args: unknown }
  | { choo: 1; type: 'tool-result'; id: string; ok: boolean; result?: unknown; error?: string }
/** What a tool's handler is told about who is asking. */
export interface AddonToolContext {
  /** The projects the calling orchestrator directs. */
  repoIds: string[]
}
export type AddonReply =
  | { choo: 1; type: 'init'; context: AddonContext; theme: Record<string, string>; dark: boolean; apiVersion: number }
  | { choo: 1; type: 'result'; id: number; ok: true; result: unknown }
  | { choo: 1; type: 'result'; id: number; ok: false; error: string }
  | { choo: 1; type: 'event'; name: 'workspaces' }
  | { choo: 1; type: 'event'; name: 'prs'; workspaceId: string }
  | { choo: 1; type: 'event'; name: 'store'; key: string }
  | ({ choo: 1; type: 'event'; name: 'action' } & AddonActionPress)
  | { choo: 1; type: 'tool'; id: string; name: string; input: unknown; context: AddonToolContext }
  | { choo: 1; type: 'event'; name: 'theme'; theme: Record<string, string>; dark: boolean }

export function isAddonRequest(v: unknown): v is AddonRequest {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o.choo !== 1) return false
  if (o.type === 'hello') return true
  if (o.type === 'tool-result') return typeof o.id === 'string' && typeof o.ok === 'boolean'
  return o.type === 'call' && typeof o.id === 'number' && typeof o.method === 'string'
}

/** What `workspaces.list` returns for each workspace. */
export interface AddonWorkspace {
  id: string
  repoId: string
  title: string
  branch: string
  status: 'running' | 'needs-approval' | 'in-cloud' | 'error' | 'idle'
  unread: boolean
  /** Started by the orchestrator. */
  orchestrated: boolean
  /** The add-on that started it, when one did. */
  startedBy?: string
  createdAt: number
  lastMessage: string
}

/** Something the app tells add-on frames about. `addon` limits it to one add-on's frames. */
export type AddonAppEvent =
  | { name: 'workspaces' }
  | { name: 'prs'; workspaceId: string }
  | { name: 'store'; addon: string; key: string }
  /** A button press for an add-on's background page. */
  | { name: 'action'; addon: string; press: AddonActionPress }

/** A tool call on its way to an add-on's background page. */
export interface AddonToolCall {
  callId: string
  /** The add-on's key. */
  addon: string
  name: string
  input: unknown
  context: AddonToolContext
}
