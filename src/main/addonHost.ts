/**
 * Runs add-ons inside the app: serves their view files on `choo-addon://<key>/…`, keeps the list
 * of installed add-ons, and answers the views' host API calls. Views are sandboxed frames with no
 * Node and no preload; everything they do comes through `addons:call` and is checked there.
 *
 * Add-ons with a background page get one more frame each, in a window that is never shown, so they
 * keep working while their views are closed and can answer the orchestrator's tool calls.
 */
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  ADDON_SCHEME,
  TOOLS_PERMISSION,
  missingGrants,
  sourceKey,
  toolServerName,
  viewCsp,
  type AddonActionContext,
  type AddonAppEvent,
  type AddonCallResult,
  type AddonContext,
  type AddonInfo,
  type AddonSource,
  type AddonTool,
  type AddonToolCall,
  type AddonToolContext,
  type AvailableAddon,
  type PinStatus
} from '@shared/addons'
import * as store from './store'
import * as plugins from './plugins'
import { availableFrom, contentType, describeAddons, listPlugins, listSources, pinStatus, readPins, resolveFile, type LoadedAddon } from './addons'
import { backgroundPress, call, type AddonHost } from './addonApi'
import { HOST_SCRIPT, HOST_SCRIPT_PATH } from './addonClient'

/** Must run before the app is ready: makes choo-addon:// a normal, secure origin with fetch support. */
export function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: ADDON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
}

export interface Deps {
  host: Omit<AddonHost, 'appVersion' | 'storageDir'>
  /** Environment for `claude plugin …`, such as the API key when one is set. */
  env(): Record<string, string>
  send(channel: string, ...args: unknown[]): void
}

let cache: LoadedAddon[] = []
/** Every installed plugin's id, add-on or not. */
let pluginIds: string[] = []
let loaded = false
let loading: Promise<LoadedAddon[]> | null = null

/** The renderer shows this instead of the app when its URL ends in this hash. */
export const BACKGROUND_HASH = 'addon-background'
/** How long a tool may take to answer the orchestrator. */
export const TOOL_TIMEOUT_MS = 5 * 60_000

let background: BrowserWindow | null = null
let quitting = false
let backgroundLoaded: Promise<void> | null = null
const toolCalls = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }>()

const grants = () => store.get().settings.addons ?? {}
// User-scope plugins are the same from any folder, so add-ons are read from the home folder.
const cwd = () => homedir()

const strip = (list: LoadedAddon[]): AddonInfo[] => list.map(({ dir: _dir, pluginScope: _scope, ...info }) => info)

function refresh(deps: Deps): Promise<LoadedAddon[]> {
  loading ??= listPlugins(cwd(), deps.env())
    .then((list) => {
      cache = describeAddons(list, grants())
      pluginIds = list.map((p) => p.id)
      loaded = true
      syncBackground()
      return cache
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** What a running add-on may do: what its manifest asks for now, all of which the person agreed to. */
const allowed = (a: LoadedAddon) => a.manifest?.permissions ?? []

const notFound = () => new Response('Not found', { status: 404 })

const hasBackground = (a: LoadedAddon) => a.state === 'on' && !!a.manifest?.background

/** Opens the unseen window when an add-on that is on has a background page, and closes it when none does. */
function syncBackground() {
  if (quitting) return
  const open = background && !background.isDestroyed()
  if (!cache.some(hasBackground)) {
    if (open) background!.destroy()
    background = null
    backgroundLoaded = null
    return
  }
  if (open) return
  const w = new BrowserWindow({
    show: false,
    // Timers in a window nobody sees are slowed to a crawl by default.
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, backgroundThrottling: false }
  })
  background = w
  backgroundLoaded = new Promise((resolve) => w.webContents.once('did-finish-load', () => resolve()))
  w.webContents.on('render-process-gone', () => {
    if (!w.isDestroyed()) w.destroy()
  })
  w.on('closed', () => {
    if (background !== w) return
    background = null
    backgroundLoaded = null
    // It crashed or was closed from outside: bring it back if it is still needed.
    setTimeout(syncBackground, 1000)
  })
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${BACKGROUND_HASH}`)
  else void w.loadFile(join(__dirname, '../renderer/index.html'), { hash: BACKGROUND_HASH })
}

/** True for the window that only hosts background pages, so the app doesn't count it as open. */
export const isBackgroundWindow = (w: BrowserWindow) => w === background

function toBackground(channel: string, ...args: unknown[]) {
  if (background && !background.isDestroyed()) background.webContents.send(channel, ...args)
}

let workspacesTimer: NodeJS.Timeout | undefined
let toMain: (channel: string, ...args: unknown[]) => void = () => {}

/**
 * Called for everything the app tells its window. What add-ons care about is passed on to their
 * frames as a bare ping: a frame then asks for whatever it is allowed to see.
 */
export function appEvent(channel: string, payload?: unknown) {
  if (channel === 'pr:changed' && typeof payload === 'string') return emit({ name: 'prs', workspaceId: payload })
  const p = payload as { chat?: unknown; permission?: unknown; permissionDone?: unknown } | undefined
  if (channel !== 'state:changed' && !(channel === 'chat:event' && (p?.chat || p?.permission || p?.permissionDone))) return
  if (!background) return
  clearTimeout(workspacesTimer)
  // Views in the app window hear about workspaces from the window's own state; only the background needs this.
  workspacesTimer = setTimeout(() => toBackground('addons:event', { name: 'workspaces' } satisfies AddonAppEvent), 300)
}

function emit(event: AddonAppEvent) {
  toMain('addons:event', event)
  toBackground('addons:event', event)
}

/** Asks an add-on's background page to run one of its tools. */
async function callTool(key: string, name: string, input: unknown, context: AddonToolContext): Promise<unknown> {
  const addon = cache.find((a) => a.key === key && hasBackground(a))
  if (!addon || !allowed(addon).includes(TOOLS_PERMISSION)) throw new Error('The add-on this tool comes from is turned off')
  syncBackground()
  await backgroundLoaded
  const w = background
  if (!w || w.isDestroyed()) throw new Error("The add-on's background page isn't running")
  const callId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      toolCalls.delete(callId)
      reject(new Error(`${addon.name} took too long to answer`))
    }, TOOL_TIMEOUT_MS)
    toolCalls.set(callId, { resolve, reject, timer })
    w.webContents.send('addons:tool', { callId, addon: key, name, input, context } satisfies AddonToolCall)
  })
}

/** One add-on's tools, ready for the orchestrator. */
export interface Toolset {
  /** MCP server name: tools show up as `mcp__<server>__<tool>`. */
  server: string
  addon: string
  description: string
  tools: (AddonTool & { call(input: unknown, context: AddonToolContext): Promise<unknown> })[]
}

/** The tools of every add-on that is on, has a background page and was granted `orchestrator:tools`. */
export function toolsets(): Toolset[] {
  const used = new Set<string>()
  return cache
    .filter((a) => hasBackground(a) && a.manifest!.tools.length && allowed(a).includes(TOOLS_PERMISSION))
    .map((a) => {
      // Two sources can each have a plugin of the same name.
      let server = toolServerName(a.key)
      if (used.has(server)) server = `addon-${a.key.replace(/\./g, '-')}`
      used.add(server)
      return { server, addon: a.name, description: a.description, tools: a.manifest!.tools.map((t) => ({ ...t, call: (input: unknown, context: AddonToolContext) => callTool(a.key, t.name, input, context) })) }
    })
}

export function start(deps: Deps) {
  toMain = deps.send
  app.on('before-quit', () => {
    quitting = true
    if (background && !background.isDestroyed()) background.destroy()
  })
  const host: AddonHost = {
    ...deps.host,
    appVersion: () => app.getVersion(),
    storageDir: () => join(app.getPath('userData'), 'data', 'addons'),
    storeChanged: (addon, key) => emit({ name: 'store', addon, key })
  }
  // Background pages start with the app, not when Settings is first opened.
  if (Object.values(grants()).some((g) => g.enabled)) void refresh(deps).catch(() => {})

  protocol.handle(ADDON_SCHEME, async (req) => {
    const url = new URL(req.url)
    const addon = cache.find((a) => a.key === url.hostname && a.state === 'on')
    if (!addon || req.method !== 'GET') return notFound()
    const headers = {
      'Content-Security-Policy': viewCsp(addon.key, allowed(addon)),
      // Views run with an opaque origin, so even their own scripts and fonts are cross-origin loads.
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
    if (url.pathname === HOST_SCRIPT_PATH) return new Response(HOST_SCRIPT, { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } })
    const file = resolveFile(addon.dir, url.pathname)
    if (!file) return notFound()
    return new Response(await readFile(file), { headers: { ...headers, 'Content-Type': contentType(file) } })
  })

  // A view stays on its own add-on's pages. Without this it could send its frame to another add-on's
  // view, carrying data in the URL. Web pages are already refused by the window's frame-src.
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-frame-navigate', (details) => {
      if (details.isMainFrame) return
      const own = `${ADDON_SCHEME}://`
      const from = [details.frame?.url, details.initiator?.url].find((u) => u?.startsWith(own))
      if (!from) return
      let same = false
      try {
        const a = new URL(from)
        const b = new URL(details.url)
        same = a.protocol === b.protocol && a.host === b.host
      } catch {
        /* not a URL: refuse */
      }
      if (!same) details.preventDefault()
    })
  })

  const h = (ch: string, fn: (...a: any[]) => unknown) => ipcMain.handle(ch, (_e, ...a) => fn(...a))
  const changed = () => {
    deps.send('addons:changed')
    toBackground('addons:changed')
  }

  // Only the background window may answer a tool call.
  ipcMain.handle('addons:toolResult', (e, callId: string, r: { ok: boolean; result?: unknown; error?: string }) => {
    if (!background || e.sender !== background.webContents) return
    const pending = toolCalls.get(String(callId))
    if (!pending) return
    toolCalls.delete(String(callId))
    clearTimeout(pending.timer)
    if (r?.ok) pending.resolve(r.result)
    else pending.reject(new Error(String(r?.error || 'The tool failed')))
  })

  h('addons:pins', async (): Promise<PinStatus[]> => {
    const pinned = deps.host
      .repos()
      .map((r) => ({ id: r.id, pins: readPins(r.path) }))
      .filter((r) => r.pins.required.length || r.pins.recommended.length)
    // No project pins anything: skip the Claude Code calls.
    if (!pinned.length) return []
    const [sources, addons] = await Promise.all([listSources(cwd(), deps.env()), loaded ? cache : refresh(deps)])
    return pinned.map((r) => pinStatus(r.id, r.pins, addons, pluginIds, sources))
  })

  // Installs an add-on a project pins. Only what that project's file names is added or installed.
  h('addons:installPinned', async (repoId: string, id: string, acceptSha?: string) => {
    const repo = deps.host.repos().find((r) => r.id === repoId)
    if (!repo) throw new Error('That project is gone')
    const pins = readPins(repo.path)
    const pinned = [...pins.required, ...pins.recommended].find((p) => p.toLowerCase() === String(id).toLowerCase())
    if (!pinned) throw new Error("That add-on isn't in this project's choo-choo.json")
    const known = new Set((await listSources(cwd(), deps.env())).map((s) => sourceKey(s.source)))
    for (const source of pins.sources) if (!known.has(sourceKey(source))) await plugins.addMarketplace(cwd(), deps.env(), source)
    const r = await plugins.install(cwd(), deps.env(), pinned, 'user', acceptSha)
    if (r.ok) {
      await refresh(deps)
      changed()
    }
    return r
  })

  h('addons:list', async (fresh?: boolean) => {
    // Nothing turned on: skip the Claude Code call at startup. Settings asks with `fresh`.
    if (!fresh && !loaded && !Object.values(grants()).some((g) => g.enabled)) return []
    return strip(fresh || !loaded ? await refresh(deps) : cache)
  })

  h('addons:available', async (): Promise<AvailableAddon[]> => {
    const [sources, installed] = await Promise.all([listSources(cwd(), deps.env()), listPlugins(cwd(), deps.env())])
    return availableFrom(sources, new Set(installed.map((p) => p.id)))
  })

  h('addons:sources', async (): Promise<AddonSource[]> => (await listSources(cwd(), deps.env())).map(({ name, source }) => ({ name, source })))
  h('addons:addSource', (source: string) => plugins.addMarketplace(cwd(), deps.env(), String(source)))
  h('addons:removeSource', (name: string) => plugins.removeMarketplace(cwd(), deps.env(), String(name)))

  h('addons:install', async (id: string, acceptSha?: string) => {
    const r = await plugins.install(cwd(), deps.env(), String(id), 'user', acceptSha)
    if (r.ok) {
      await refresh(deps)
      changed()
    }
    return r
  })

  h('addons:uninstall', async (id: string) => {
    const addon = (await refresh(deps)).find((a) => a.id === id)
    if (!addon) throw new Error('That add-on is not installed')
    await plugins.uninstall(cwd(), deps.env(), addon.id, addon.pluginScope)
    const s = store.get().settings
    if (s.addons?.[id]) {
      const { [id]: _gone, ...rest } = s.addons
      s.addons = rest
      store.save()
    }
    await refresh(deps)
    changed()
  })

  h('addons:setEnabled', async (id: string, enabled: boolean, permissions: string[] = []) => {
    const addon = (await refresh(deps)).find((a) => a.id === id)
    if (!addon) throw new Error('That add-on is not installed')
    const s = store.get().settings
    if (enabled) {
      if (!addon.manifest) throw new Error(addon.errors[0] ?? 'This add-on has no valid manifest')
      // The person agreed to the list they were shown. If the add-on asks for more now, show it again.
      const shown = Array.isArray(permissions) ? permissions.map(String) : []
      if (missingGrants(addon.manifest, shown).length) throw new Error('This add-on asks for different permissions now. Review them and turn it on again.')
      if (addon.state === 'plugin-off') await plugins.setEnabled(cwd(), deps.env(), addon.id, true, addon.pluginScope)
      s.addons = { ...s.addons, [id]: { enabled: true, granted: [...addon.manifest.permissions] } }
    } else {
      s.addons = { ...s.addons, [id]: { enabled: false, granted: s.addons?.[id]?.granted ?? [] } }
    }
    store.save()
    await refresh(deps)
    changed()
    deps.send('state:changed')
    return strip(cache)
  })

  // A press of a button whose add-on answers it in the background. Presses that open a view never leave the window.
  h('addons:action', async (key: string, actionId: string, context: AddonActionContext) => {
    if (!loaded) await refresh(deps)
    const addon = cache.find((a) => a.key === key && a.state === 'on')
    const press = addon && backgroundPress(addon, String(actionId), context ?? {}, host)
    if (!press) throw new Error("This button's add-on is turned off or no longer has it")
    syncBackground()
    await backgroundLoaded
    toBackground('addons:event', { name: 'action', addon: addon.key, press } satisfies AddonAppEvent)
  })

  // Answers with a result or an error instead of throwing: a view being told "no" is routine, not a fault to log.
  h('addons:call', async (key: string, method: string, args: unknown, context: AddonContext): Promise<AddonCallResult> => {
    try {
      if (!loaded) await refresh(deps)
      const addon = cache.find((a) => a.key === key && a.state === 'on')
      if (!addon) throw new Error('This add-on is turned off')
      return { ok: true, result: await call(host, { id: addon.id, key: addon.key, name: addon.name, granted: allowed(addon) }, String(method), args, context) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
