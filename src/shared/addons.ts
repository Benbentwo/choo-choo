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

export interface AddonManifest {
  apiVersion: number
  /** Display name; the plugin's name when missing. */
  name?: string
  description?: string
  permissions: string[]
  views: AddonView[]
}

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
  'workspaces:start': { label: 'Start workspaces', detail: 'Create a worktree and branch and give its agent a task. Agents run with your default permissions.' },
  'workspaces:message': { label: 'Message agents', detail: 'Send a follow-up to the agent in an existing workspace.' },
  'workspaces:stop': { label: 'Stop agents', detail: "Stop a workspace's running agent." },
  'prs:read': { label: 'See pull requests and checks', detail: "Each workspace's pull request, its state and its CI checks." },
  storage: { label: 'Keep its own data on this Mac', detail: 'Up to 1 MB, only readable by this add-on.' },
  notify: { label: 'Show notifications', detail: 'System notifications with a title and a line of text.' }
}

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
  'prs.status': 'prs:read',
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

  if (errors.length) return { errors }
  return { manifest: { apiVersion: m.apiVersion as number, name: str(m.name, 60) ?? undefined, description: str(m.description, 300) ?? undefined, permissions, views }, errors }
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
export type AddonRequest = { choo: 1; type: 'hello' } | { choo: 1; type: 'call'; id: number; method: string; args: unknown }
export type AddonReply =
  | { choo: 1; type: 'init'; context: AddonContext; theme: Record<string, string>; dark: boolean; apiVersion: number }
  | { choo: 1; type: 'result'; id: number; ok: true; result: unknown }
  | { choo: 1; type: 'result'; id: number; ok: false; error: string }
  | { choo: 1; type: 'event'; name: 'workspaces' }
  | { choo: 1; type: 'event'; name: 'theme'; theme: Record<string, string>; dark: boolean }

export function isAddonRequest(v: unknown): v is AddonRequest {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o.choo !== 1) return false
  if (o.type === 'hello') return true
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
