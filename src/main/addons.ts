/**
 * Finds add-ons: installed Claude Code plugins that carry a `choo-choo.addon.json`, and add-ons
 * the configured sources (plugin marketplaces) offer. Everything goes through `claude plugin …`
 * and the files Claude Code already keeps on disk; Choo Choo has no registry of its own.
 * No Electron imports, so this is testable.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { z } from 'zod'
import { ADDON_KEYWORD, ADDON_MANIFEST, addonKey, addonState, parseManifest, parsePins, sourceKey, type AddonGrant, type AddonInfo, type AddonManifest, type AddonPins, type AddonState, type AvailableAddon, type PinStatus } from '@shared/addons'
import { lastJson, runClaude } from './claudeCli'

/** One row of `claude plugin list --json`, as far as add-ons care. */
export interface PluginEntry {
  id: string
  version: string
  enabled: boolean
  /** user, project, local, or a scope Claude Code manages for you. */
  scope: string
  installPath: string
  /** Read from a folder source in place rather than from Claude Code's cache. */
  fromFolder?: boolean
}

/** An add-on plus where its files are. The folder never leaves the main process. */
export interface LoadedAddon extends AddonInfo {
  dir: string
  pluginScope: string
}

export interface SourceEntry {
  name: string
  source: string
  /** The source's checkout on disk, holding .claude-plugin/marketplace.json. */
  dir: string
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return lastJson(text)
  }
}

export async function listPlugins(cwd: string, env: Record<string, string>): Promise<PluginEntry[]> {
  const list = parseJson(await runClaude(['plugin', 'list', '--json'], cwd, env))
  const rows: any[] = Array.isArray(list) ? list : (list?.installed ?? [])
  return rows
    .filter((p) => typeof p?.id === 'string' && typeof p.installPath === 'string')
    .map((p) => {
      // A plugin from a local folder source is read from that folder, as Claude Code does, so edits show without reinstalling.
      const fromFolder = typeof p.readFromFolder === 'string' && existsSync(p.readFromFolder)
      return {
        id: p.id,
        version: String(p.version ?? ''),
        enabled: !!p.enabled,
        scope: String(p.scope ?? 'user'),
        installPath: fromFolder ? p.readFromFolder : p.installPath,
        ...(fromFolder ? { fromFolder: true } : {})
      }
    })
}

export async function listSources(cwd: string, env: Record<string, string>): Promise<SourceEntry[]> {
  const list = parseJson(await runClaude(['plugin', 'marketplace', 'list', '--json'], cwd, env))
  return (Array.isArray(list) ? list : []).map((m: any) => ({ name: String(m.name), source: String(m.repo ?? m.url ?? m.path ?? m.source ?? ''), dir: String(m.installLocation ?? m.path ?? '') }))
}

/** Reads and checks the manifest in a plugin folder. Undefined when the plugin isn't an add-on. */
export function readManifest(dir: string): { manifest?: AddonManifest; errors: string[] } | undefined {
  const file = join(dir, ADDON_MANIFEST)
  if (!existsSync(file)) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return { errors: [`${ADDON_MANIFEST} isn't valid JSON: ${(e as Error).message}`] }
  }
  const read = parseManifest(raw)
  // A tool whose arguments can't be understood would reach the orchestrator broken: refuse the add-on instead.
  const errors = (read.manifest?.tools ?? []).flatMap((t) => {
    try {
      toolShape(t.input)
      return []
    } catch (e) {
      return [`Tool ${t.name}: input isn't a JSON Schema Choo Choo can read (${(e as Error).message})`]
    }
  })
  return errors.length ? { errors } : read
}

/** A tool's arguments as the Agent SDK wants them: one zod type per argument. Throws on a schema zod can't read. */
export function toolShape(input: Record<string, unknown> | undefined): Record<string, z.ZodType> {
  if (!input) return {}
  const schema = z.fromJSONSchema(input as Parameters<typeof z.fromJSONSchema>[0])
  if (!(schema instanceof z.ZodObject)) throw new Error('not an object schema')
  return schema.shape as Record<string, z.ZodType>
}

const PIN_FILE = 'choo-choo.json'

/** The add-ons a project's `choo-choo.json` asks for. Empty when the file is missing or broken. */
export function readPins(repoPath: string): AddonPins {
  try {
    return parsePins(JSON.parse(readFileSync(join(repoPath, PIN_FILE), 'utf8')))
  } catch {
    return parsePins(null)
  }
}

/** A project's pins checked against what is installed and which sources are added. */
export function pinStatus(repoId: string, pins: AddonPins, addons: Pick<AddonInfo, 'id' | 'name' | 'state'>[], pluginIds: string[], sources: Pick<SourceEntry, 'source'>[]): PinStatus {
  const known = new Set(sources.map((s) => sourceKey(s.source)))
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const one = (id: string, required: boolean) => {
    const addon = addons.find((a) => same(a.id, id))
    // Installed as a plain plugin: there is nothing for Choo Choo to turn on.
    const state: AddonState | 'missing' = addon?.state ?? (pluginIds.some((p) => same(p, id)) ? 'invalid' : 'missing')
    return { id, name: addon?.name ?? id.split('@')[0], required, state }
  }
  return {
    repoId,
    newSources: pins.sources.filter((s) => !known.has(sourceKey(s))),
    addons: [...pins.required.map((id) => one(id, true)), ...pins.recommended.map((id) => one(id, false))]
  }
}

/** The installed plugins that are add-ons, with their state under the person's grants. */
export function describeAddons(plugins: PluginEntry[], grants: Record<string, AddonGrant>): LoadedAddon[] {
  // The same plugin can be installed at more than one scope; the enabled copy wins.
  const byId = new Map<string, PluginEntry>()
  for (const p of plugins) if (!byId.has(p.id) || (p.enabled && !byId.get(p.id)!.enabled)) byId.set(p.id, p)
  const out: LoadedAddon[] = []
  for (const p of byId.values()) {
    const read = readManifest(p.installPath)
    if (!read) continue
    const [name, marketplace = ''] = p.id.split('@')
    const grant = grants[p.id]
    out.push({
      id: p.id,
      key: addonKey(p.id),
      name: read.manifest?.name ?? name,
      description: read.manifest?.description ?? '',
      version: p.version,
      marketplace,
      state: addonState({ manifest: read.manifest, pluginEnabled: p.enabled, grant }),
      manifest: read.manifest,
      errors: read.errors,
      granted: grant?.granted ?? [],
      ...(p.fromFolder ? { dev: true } : {}),
      dir: p.installPath,
      pluginScope: p.scope
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Add-ons the sources offer that aren't installed. A marketplace entry counts when its folder in
 * the source's checkout has a manifest, or when it is tagged `choo-choo-addon`.
 */
export function availableFrom(sources: SourceEntry[], installedIds: Set<string>): AvailableAddon[] {
  const out: AvailableAddon[] = []
  for (const s of sources) {
    let market: any
    try {
      market = JSON.parse(readFileSync(join(s.dir, '.claude-plugin', 'marketplace.json'), 'utf8'))
    } catch {
      continue
    }
    for (const p of Array.isArray(market?.plugins) ? market.plugins : []) {
      if (typeof p?.name !== 'string') continue
      const id = `${p.name}@${s.name}`
      if (installedIds.has(id)) continue
      const local = typeof p.source === 'string' ? join(s.dir, String(market.metadata?.pluginRoot ?? ''), p.source) : null
      const read = local && inside(s.dir, local) ? readManifest(local) : undefined
      const tagged = [...(Array.isArray(p.keywords) ? p.keywords : []), ...(Array.isArray(p.tags) ? p.tags : []), p.category].includes(ADDON_KEYWORD)
      if (!read && !tagged) continue
      out.push({ id, name: read?.manifest?.name ?? p.name, description: read?.manifest?.description ?? String(p.description ?? ''), marketplace: s.name, manifest: read?.manifest })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function inside(root: string, file: string): boolean {
  return file === root || file.startsWith(root.endsWith(sep) ? root : root + sep)
}

/**
 * The file a view URL path points at, or null. Symlinks are resolved first, so a link inside the
 * add-on can't reach files outside it. Dotfiles and dot-folders (.git, .mcp.json, .claude-plugin)
 * are never served.
 */
export function resolveFile(dir: string, urlPath: string): string | null {
  let rel: string
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, '')
  } catch {
    return null
  }
  if (!rel || rel.includes('\0') || rel.split('/').some((seg) => seg === '..' || seg.startsWith('.'))) return null
  try {
    const root = realpathSync(dir)
    const file = realpathSync(join(root, rel))
    return inside(root, file) && statSync(file).isFile() ? file : null
  } catch {
    return null
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
}

export const contentType = (file: string) => TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
