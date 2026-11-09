/**
 * Runs add-ons inside the app: serves their view files on `choo-addon://<key>/…`, keeps the list
 * of installed add-ons, and answers the views' host API calls. Views are sandboxed frames with no
 * Node and no preload; everything they do comes through `addons:call` and is checked there.
 */
import { app, ipcMain, protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ADDON_SCHEME, missingGrants, viewCsp, type AddonCallResult, type AddonContext, type AddonInfo, type AddonSource, type AvailableAddon } from '@shared/addons'
import * as store from './store'
import * as plugins from './plugins'
import { availableFrom, contentType, describeAddons, listPlugins, listSources, resolveFile, type LoadedAddon } from './addons'
import { call, type AddonHost } from './addonApi'
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
let loaded = false
let loading: Promise<LoadedAddon[]> | null = null

const grants = () => store.get().settings.addons ?? {}
// User-scope plugins are the same from any folder, so add-ons are read from the home folder.
const cwd = () => homedir()

const strip = (list: LoadedAddon[]): AddonInfo[] => list.map(({ dir: _dir, pluginScope: _scope, ...info }) => info)

function refresh(deps: Deps): Promise<LoadedAddon[]> {
  loading ??= listPlugins(cwd(), deps.env())
    .then((list) => {
      cache = describeAddons(list, grants())
      loaded = true
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

export function start(deps: Deps) {
  const host: AddonHost = { ...deps.host, appVersion: () => app.getVersion(), storageDir: () => join(app.getPath('userData'), 'data', 'addons') }

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
  const changed = () => deps.send('addons:changed')

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
