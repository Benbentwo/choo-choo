/**
 * Developing an add-on: loading one from a folder on disk and reloading it as its files change.
 *
 * A folder holding a marketplace (`.claude-plugin/marketplace.json`) is added as a source as it is.
 * A folder holding a single add-on goes into a small marketplace Choo Choo keeps for you
 * (`choo-choo-dev`) as a symlink, because Claude Code only installs plugins from a marketplace.
 * Either way Claude Code reads the plugin from the folder itself, so nothing is copied and edits
 * show without reinstalling.
 *
 * No Electron imports, so this is testable.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { ADDON_MANIFEST } from '@shared/addons'

/** The marketplace that holds single add-ons loaded from a folder. */
export const DEV_MARKETPLACE = 'choo-choo-dev'

export type DevFolder = { kind: 'marketplace'; name: string; dir: string } | { kind: 'addon'; name: string; dir: string }

const NAME = /^[A-Za-z0-9_.-]+$/

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** A plugin or marketplace name Claude Code accepts, made from any folder or package name. */
export function safeName(raw: string): string {
  const s = raw
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return s || 'addon'
}

/** What a folder holds: a marketplace of add-ons, or one add-on. Throws when it is neither. */
export function inspectFolder(folder: string): DevFolder {
  const dir = resolve(folder)
  if (!existsSync(dir)) throw new Error(`There's no folder at ${dir}`)
  const market = join(dir, '.claude-plugin', 'marketplace.json')
  if (existsSync(market)) {
    const m = readJson(market)
    if (typeof m?.name !== 'string' || !NAME.test(m.name)) throw new Error(`${market} has no usable "name"`)
    return { kind: 'marketplace', name: m.name, dir }
  }
  if (existsSync(join(dir, ADDON_MANIFEST))) {
    const plugin = readJson(join(dir, '.claude-plugin', 'plugin.json'))
    const name = typeof plugin?.name === 'string' && NAME.test(plugin.name) ? plugin.name : safeName(basename(dir))
    return { kind: 'addon', name, dir }
  }
  throw new Error(`${dir} has no ${ADDON_MANIFEST} or .claude-plugin/marketplace.json. Pick the folder of one add-on, or the root of a marketplace repo.`)
}

/** True when two paths are the same folder on disk. */
export function sameFolder(a: string, b: string): boolean {
  if (!a || !b) return false
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return resolve(a) === resolve(b)
  }
}

function writeMarketplace(wrapper: string) {
  const dir = join(wrapper, 'plugins')
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => NAME.test(n) && existsSync(join(dir, n))) : []
  mkdirSync(join(wrapper, '.claude-plugin'), { recursive: true })
  const market = {
    name: DEV_MARKETPLACE,
    owner: { name: 'Choo Choo' },
    metadata: { description: 'Add-ons you are developing, loaded from folders on this Mac.' },
    plugins: names.sort().map((name) => ({ name, source: `./plugins/${name}`, keywords: ['choo-choo-addon'] }))
  }
  writeFileSync(join(wrapper, '.claude-plugin', 'marketplace.json'), JSON.stringify(market, null, 2) + '\n')
}

/**
 * Puts a single add-on folder in the dev marketplace at `wrapper`. Refuses when another folder
 * already goes by that name, so one add-on never silently replaces another.
 */
export function linkDevAddon(wrapper: string, folder: string, name: string) {
  if (!NAME.test(name)) throw new Error(`Not a plugin name: ${name}`)
  const dir = join(wrapper, 'plugins')
  mkdirSync(dir, { recursive: true })
  const link = join(dir, name)
  let current: string | undefined
  try {
    current = lstatSync(link).isSymbolicLink() ? readlinkSync(link) : link
  } catch {
    current = undefined
  }
  if (current !== undefined && !sameFolder(current, folder)) {
    // A link whose folder is gone can be taken over.
    if (existsSync(link)) throw new Error(`An add-on named ${name} is already loaded from ${current}. Remove it first, or rename this one in .claude-plugin/plugin.json.`)
    unlinkSync(link)
    current = undefined
  }
  if (current === undefined) symlinkSync(resolve(folder), link, 'dir')
  writeMarketplace(wrapper)
}

/** Takes a single add-on back out of the dev marketplace. The folder itself is never touched. */
export function unlinkDevAddon(wrapper: string, name: string) {
  if (!NAME.test(name)) return
  const link = join(wrapper, 'plugins', name)
  try {
    if (lstatSync(link).isSymbolicLink()) unlinkSync(link)
  } catch {
    /* already gone */
  }
  if (existsSync(join(wrapper, '.claude-plugin'))) writeMarketplace(wrapper)
}

/** Folders whose changes never matter to a running add-on. */
const SKIP = new Set(['node_modules', '.git'])

/** True for a changed path (relative to the add-on) that shouldn't reload anything. */
export function ignoredChange(rel: string): boolean {
  const parts = rel.split(/[\\/]/).filter(Boolean)
  if (!parts.length) return true
  if (parts.some((p) => SKIP.has(p))) return true
  const last = parts[parts.length - 1]
  // Editor droppings: swap files, backups, macOS folder files.
  return last === '.DS_Store' || last.endsWith('~') || last.endsWith('.swp') || last.endsWith('.swx') || /^\.#/.test(last) || /^#.*#$/.test(last)
}

/** True when one of the changed paths is the add-on's manifest, or a change whose file wasn't named. */
export const manifestChanged = (files: string[]) => files.some((f) => f === '' || f.split(/[\\/]/).join('/') === ADDON_MANIFEST)

/**
 * Watches an add-on folder and calls `onChange` with the files that changed, once things settle.
 * Editors often write a file in several steps; a short wait folds those into one reload.
 * Returns a function that stops watching.
 */
export function watchFolder(dir: string, onChange: (files: string[]) => void, waitMs = 150): () => void {
  let root: string
  try {
    root = realpathSync(dir)
  } catch {
    return () => {}
  }
  const pending = new Set<string>()
  let timer: NodeJS.Timeout | undefined
  let watcher: FSWatcher | undefined
  const fire = () => {
    timer = undefined
    const files = [...pending]
    pending.clear()
    if (files.length) onChange(files)
  }
  try {
    watcher = watch(root, { recursive: true }, (_event, file) => {
      const rel = file ? String(file) : ''
      // Some platforms leave out the name; count that as "something changed".
      if (rel && ignoredChange(rel)) return
      pending.add(rel ? relative(root, join(root, rel)).split(sep).join('/') : '')
      clearTimeout(timer)
      timer = setTimeout(fire, waitMs)
    })
    watcher.on('error', () => {})
  } catch {
    return () => {}
  }
  return () => {
    clearTimeout(timer)
    watcher?.close()
  }
}
