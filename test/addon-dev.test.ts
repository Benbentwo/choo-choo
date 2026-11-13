import { describe, it, expect } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEV_MARKETPLACE, ignoredChange, inspectFolder, linkDevAddon, manifestChanged, safeName, sameFolder, unlinkDevAddon, watchFolder } from '../src/main/addonDev'
import { describeAddons } from '../src/main/addons'

const temp = () => mkdtempSync(join(tmpdir(), 'addon-dev-'))
const manifest = { apiVersion: 1, permissions: [], views: [{ id: 'main', slot: 'app', title: 'Hello', entry: 'ui/index.html' }] }

function addon(dir: string, name?: string) {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  if (name) writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '0.1.0' }))
  writeFileSync(join(dir, 'choo-choo.addon.json'), JSON.stringify(manifest))
  return dir
}

describe('develop add-on: what a folder holds', () => {
  it('finds a marketplace by its marketplace.json', () => {
    const dir = temp()
    mkdirSync(join(dir, '.claude-plugin'))
    writeFileSync(join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'my-addons', plugins: [] }))
    expect(inspectFolder(dir)).toEqual({ kind: 'marketplace', name: 'my-addons', dir })
  })

  it('finds a single add-on and names it from plugin.json, or else the folder', () => {
    const named = addon(join(temp(), 'whatever'), 'hello-board')
    expect(inspectFolder(named)).toMatchObject({ kind: 'addon', name: 'hello-board' })
    const bare = join(temp(), 'My Board!')
    mkdirSync(bare)
    writeFileSync(join(bare, 'choo-choo.addon.json'), '{}')
    expect(inspectFolder(bare)).toMatchObject({ kind: 'addon', name: 'My-Board' })
  })

  it('says what is missing for any other folder', () => {
    expect(() => inspectFolder(temp())).toThrow(/choo-choo.addon.json or .claude-plugin\/marketplace.json/)
    expect(() => inspectFolder(join(temp(), 'nope'))).toThrow(/no folder/)
  })

  it('makes names Claude Code accepts', () => {
    expect(safeName(' a b/c ')).toBe('a-b-c')
    expect(safeName('...')).toBe('addon')
  })
})

describe('develop add-on: the dev marketplace for single add-ons', () => {
  it('links a folder in and lists it, and refuses a second folder with the same name', () => {
    const wrapper = temp()
    const one = addon(join(temp(), 'one'), 'hello')
    linkDevAddon(wrapper, one, 'hello')
    const link = join(wrapper, 'plugins', 'hello')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(realpathSync(link)).toBe(realpathSync(one))
    const market = JSON.parse(readFileSync(join(wrapper, '.claude-plugin', 'marketplace.json'), 'utf8'))
    expect(market.name).toBe(DEV_MARKETPLACE)
    expect(market.plugins).toEqual([{ name: 'hello', source: './plugins/hello', keywords: ['choo-choo-addon'] }])

    // Loading the same folder again is fine.
    linkDevAddon(wrapper, one, 'hello')
    const two = addon(join(temp(), 'two'), 'hello')
    expect(() => linkDevAddon(wrapper, two, 'hello')).toThrow(/already loaded from/)
  })

  it('lets a name whose folder is gone be taken over', () => {
    const wrapper = temp()
    const gone = addon(join(temp(), 'gone'), 'hello')
    linkDevAddon(wrapper, gone, 'hello')
    rmSync(gone, { recursive: true })
    const next = addon(join(temp(), 'next'), 'hello')
    linkDevAddon(wrapper, next, 'hello')
    expect(realpathSync(join(wrapper, 'plugins', 'hello'))).toBe(realpathSync(next))
  })

  it('unlinks without touching the folder', () => {
    const wrapper = temp()
    const one = addon(join(temp(), 'one'), 'hello')
    linkDevAddon(wrapper, one, 'hello')
    unlinkDevAddon(wrapper, 'hello')
    expect(existsSync(join(wrapper, 'plugins', 'hello'))).toBe(false)
    expect(existsSync(join(one, 'choo-choo.addon.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(wrapper, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins).toEqual([])
  })

  it('tells the same folder through a link', () => {
    const wrapper = temp()
    const one = addon(join(temp(), 'one'), 'hello')
    linkDevAddon(wrapper, one, 'hello')
    expect(sameFolder(join(wrapper, 'plugins', 'hello'), one)).toBe(true)
    expect(sameFolder(wrapper, one)).toBe(false)
  })
})

describe('develop add-on: reloading', () => {
  it('ignores dependency folders, git and editor files', () => {
    expect(ignoredChange('node_modules/x/index.js')).toBe(true)
    expect(ignoredChange('.git/index')).toBe(true)
    expect(ignoredChange('ui/.board.js.swp')).toBe(true)
    expect(ignoredChange('ui/board.js~')).toBe(true)
    expect(ignoredChange('.DS_Store')).toBe(true)
    expect(ignoredChange('ui/board.js')).toBe(false)
    expect(ignoredChange('choo-choo.addon.json')).toBe(false)
  })

  it('reads the manifest again only when it changed, or when the platform did not say what changed', () => {
    expect(manifestChanged(['ui/board.js'])).toBe(false)
    expect(manifestChanged(['ui/board.js', 'choo-choo.addon.json'])).toBe(true)
    expect(manifestChanged([''])).toBe(true)
  })

  it('marks add-ons read from a folder as dev add-ons', () => {
    const dir = addon(join(temp(), 'one'), 'hello')
    const [fromFolder] = describeAddons([{ id: 'hello@choo-choo-dev', version: '0.1.0', enabled: true, scope: 'user', installPath: dir, fromFolder: true }], {})
    const [fromGit] = describeAddons([{ id: 'hello@acme', version: '0.1.0', enabled: true, scope: 'user', installPath: dir }], {})
    expect(fromFolder.dev).toBe(true)
    expect(fromGit.dev).toBeUndefined()
  })

  it('reports a burst of saves as one change, with the files that changed', async () => {
    const dir = addon(join(temp(), 'one'), 'hello')
    mkdirSync(join(dir, 'ui'))
    const seen: string[][] = []
    const stop = watchFolder(dir, (files) => seen.push(files.sort()), 100)
    // macOS FSEvents can report files written just before the watch started; let those pass first.
    await new Promise((r) => setTimeout(r, 600))
    seen.length = 0
    writeFileSync(join(dir, 'ui', 'index.html'), '<p>1</p>')
    writeFileSync(join(dir, 'ui', 'index.html'), '<p>2</p>')
    writeFileSync(join(dir, 'choo-choo.addon.json'), JSON.stringify(manifest))
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'x.js'), '')
    await new Promise((r) => setTimeout(r, 400))
    stop()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('ui/index.html')
    expect(seen[0]).toContain('choo-choo.addon.json')
    expect(seen[0].some((f) => f.includes('node_modules'))).toBe(false)
  })
})
