import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('../src/main/claudeBinary', () => ({ claudeExecutable: () => '/nonexistent/claude' }))
import { ADDON_API_VERSION, actionTarget, addonActions, addonKey, addonState, checkCall, describePermission, isAddonRequest, isPinSource, missingGrants, netHost, parseManifest, parsePins, safeRelativePath, sourceKey, toolServerName, viewCsp, METHOD_PERMISSION, type AddonInfo } from '../src/shared/addons'
import { availableFrom, contentType, describeAddons, pinStatus, readManifest, readPins, resolveFile, toolShape } from '../src/main/addons'
import { backgroundPress, call, MAX_RUNNING_PER_ADDON, transcriptEntries, type AddonHost, type Caller } from '../src/main/addonApi'
import { HOST_SCRIPT } from '../src/main/addonClient'
import type { Chat, ChatItem, Repo, Workspace } from '../src/shared/types'

const good = {
  apiVersion: 1,
  name: 'Plan board',
  permissions: ['workspaces:read', 'workspaces:start', 'net:api.example.com'],
  views: [{ id: 'board', slot: 'repo', title: 'Plans', entry: 'ui/index.html' }]
}

describe('add-on manifest', () => {
  it('accepts a complete manifest', () => {
    const { manifest, errors } = parseManifest(good)
    expect(errors).toEqual([])
    expect(manifest).toEqual({ apiVersion: 1, name: 'Plan board', description: undefined, permissions: good.permissions, views: good.views, tools: [] })
  })
  it('needs nothing but apiVersion', () => {
    expect(parseManifest({ apiVersion: 1 }).manifest).toEqual({ apiVersion: 1, name: undefined, description: undefined, permissions: [], views: [], tools: [] })
  })
  it('refuses a manifest for a newer app, and says so', () => {
    const r = parseManifest({ apiVersion: ADDON_API_VERSION + 1 })
    expect(r.manifest).toBeUndefined()
    expect(r.errors[0]).toMatch(/newer Choo Choo/)
  })
  it('names every problem and loads nothing when one is found', () => {
    const r = parseManifest({
      apiVersion: 1,
      permissions: ['workspaces:read', 'everything', 'net:evil.com/path'],
      views: [
        { id: 'Bad Id', slot: 'repo', title: 'x', entry: 'a.html' },
        { id: 'up', slot: 'repo', title: 'x', entry: '../../secrets.html' },
        { id: 'slot', slot: 'menubar', title: 'x', entry: 'a.html' },
        { id: 'js', slot: 'app', title: 'x', entry: 'ui/app.js' }
      ]
    })
    expect(r.manifest).toBeUndefined()
    expect(r.errors).toHaveLength(6)
    expect(r.errors.join('\n')).toMatch(/Unknown permission "everything"/)
  })
  it('rejects things that are not manifests', () => {
    expect(parseManifest(null).errors).toHaveLength(1)
    expect(parseManifest([]).errors).toHaveLength(1)
    expect(parseManifest({}).errors[0]).toMatch(/apiVersion/)
  })
  it('keeps view entries inside the add-on', () => {
    expect(safeRelativePath('ui/index.html')).toBe(true)
    for (const p of ['/etc/passwd', '../x.html', 'a/../../x.html', 'a//b.html', './a.html', 'a\\b.html', '']) expect(safeRelativePath(p)).toBe(false)
  })
})

describe('background pages and orchestrator tools', () => {
  const withTools = {
    apiVersion: 1,
    permissions: ['storage', 'orchestrator:tools'],
    background: 'ui/background.html',
    tools: [
      { name: 'plan_read', description: 'Read the plan.', readOnly: true },
      { name: 'plan_update_task', description: 'Change a task.', input: { type: 'object', properties: { task_id: { type: 'string' }, done: { type: 'boolean' } }, required: ['task_id'] } }
    ]
  }
  it('accepts a background page and tools', () => {
    const { manifest, errors } = parseManifest(withTools)
    expect(errors).toEqual([])
    expect(manifest!.background).toBe('ui/background.html')
    expect(manifest!.tools.map((t) => [t.name, !!t.readOnly, !!t.input])).toEqual([['plan_read', true, false], ['plan_update_task', false, true]])
  })
  it('a background page needs no tools', () => {
    expect(parseManifest({ apiVersion: 1, background: 'bg.html' }).manifest!.background).toBe('bg.html')
    expect(parseManifest({ apiVersion: 1, background: '../bg.html' }).errors[0]).toMatch(/background must be/)
    expect(parseManifest({ apiVersion: 1, background: 'bg.js' }).errors[0]).toMatch(/background must be/)
  })
  it('tools need a background page to answer them and a permission the person sees', () => {
    expect(parseManifest({ ...withTools, background: undefined }).errors.join()).toMatch(/need a background page/)
    expect(parseManifest({ ...withTools, permissions: ['storage'] }).errors.join()).toMatch(/"orchestrator:tools" permission/)
    expect(describePermission('orchestrator:tools').label).toBe('Give the orchestrator tools')
  })
  it('refuses badly named, duplicate or undescribed tools, and too many of them', () => {
    const bad = (tools: unknown[]) => parseManifest({ ...withTools, tools }).errors.join('\n')
    expect(bad([{ name: 'Plan-Read', description: 'x' }])).toMatch(/lowercase letters, digits and underscores/)
    expect(bad([{ name: 'a', description: 'x' }, { name: 'a', description: 'y' }])).toMatch(/both called a/)
    expect(bad([{ name: 'a' }])).toMatch(/needs a description/)
    expect(bad([{ name: 'a', description: 'x', input: { type: 'string' } }])).toMatch(/"type": "object"/)
    expect(bad([{ name: 'a', description: 'x', input: { type: 'object', properties: { p: { description: 'x'.repeat(9000) } } } }])).toMatch(/8 KB/)
    expect(bad(Array.from({ length: 25 }, (_, i) => ({ name: `t${i}`, description: 'x' })))).toMatch(/at most 24 tools/)
  })
  it("turns a tool's JSON Schema into the arguments the Agent SDK checks", () => {
    const shape = toolShape(withTools.tools[1].input)
    expect(Object.keys(shape)).toEqual(['task_id', 'done'])
    expect(shape.task_id.safeParse('t1').success).toBe(true)
    expect(shape.task_id.safeParse(undefined).success).toBe(false)
    expect(shape.done.safeParse(undefined).success).toBe(true)
    expect(toolShape(undefined)).toEqual({})
  })
  it("doesn't load an add-on whose tool schema can't be read", () => {
    const dir = addonFolder({ ...withTools, tools: [{ name: 'a', description: 'x', input: { type: 'object', properties: { p: { type: 'wat' } } } }] })
    const read = readManifest(dir)
    expect(read!.manifest).toBeUndefined()
    expect(read!.errors[0]).toMatch(/Tool a: input isn't a JSON Schema/)
  })
  it('names the tool server after the plugin', () => {
    expect(toolServerName('plan-board.acme-corp')).toBe('addon-plan-board')
  })
})

describe('buttons an add-on puts in the app', () => {
  const base = {
    apiVersion: 1,
    permissions: ['ui:buttons'],
    views: [
      { id: 'home', slot: 'app', title: 'Home', entry: 'ui/home.html' },
      { id: 'plans', slot: 'repo', title: 'Plans', entry: 'ui/board.html' },
      { id: 'task', slot: 'workspace', title: 'Plan', entry: 'ui/task.html' }
    ],
    background: 'ui/background.html'
  }
  const act = (o: object) => ({ id: 'a', title: 'A', icon: 'plus', place: 'workspace-header', ...o })
  const errorsOf = (actions: unknown, more: object = {}) => parseManifest({ ...base, ...more, actions }).errors

  it('accepts a button in every place', () => {
    const actions = [
      { id: 'import', title: 'Import a plan', icon: 'import', place: 'view-row', view: 'plans' },
      { id: 'add', title: 'Add to a plan', icon: 'plus', place: 'workspace-header' },
      { id: 'show', title: 'Show in its plan', icon: 'eye', place: 'workspace-row', view: 'task' },
      { id: 'new', title: 'New plan', icon: 'plus', place: 'project-row', view: 'plans' },
      { id: 'check', title: 'Check pull requests now', icon: 'refresh', place: 'palette' }
    ]
    const r = parseManifest({ ...base, actions })
    expect(r.errors).toEqual([])
    expect(r.manifest!.actions).toEqual(actions)
    // No actions key at all when there are none, so older manifests read back as they were.
    expect('actions' in parseManifest({ ...base, actions: [] }).manifest!).toBe(false)
    expect(describePermission('ui:buttons').label).toBe('Add buttons to the app')
  })
  it('tells the author what is wrong with a button', () => {
    expect(errorsOf('import')[0]).toMatch(/actions must be a list/)
    expect(errorsOf([act({ id: 'Bad Id' })])[0]).toMatch(/lowercase letters/)
    expect(errorsOf([act({}), act({})])[0]).toMatch(/both called a/)
    expect(errorsOf([act({ title: '' })])[0]).toMatch(/needs a title/)
    expect(errorsOf([act({ place: 'title-bar' })])[0]).toMatch(/place must be one of workspace-header/)
    expect(errorsOf([act({ view: 'nope' })])[0]).toMatch(/one of this add-on's views/)
    // A row button belongs to a view that has a row; a project's row has no workspace to show a tab beside.
    expect(errorsOf([act({ place: 'view-row' })])[0]).toMatch(/needs the view of an app or repo view/)
    expect(errorsOf([act({ place: 'view-row', view: 'task' })])[0]).toMatch(/needs the view of an app or repo view/)
    expect(errorsOf([act({ place: 'project-row', view: 'task' })])[0]).toMatch(/has no workspace/)
    // Someone has to hear about the press, and the person has to have been told about the buttons.
    expect(errorsOf([act({})], { background: undefined })[0]).toMatch(/needs a background page/)
    expect(errorsOf([act({ view: 'home' })], { background: undefined })).toEqual([])
    expect(errorsOf([act({})], { permissions: [] })[0]).toMatch(/"ui:buttons" permission/)
  })
  it("never draws an add-on's own picture or markup, and keeps one add-on from crowding a place", () => {
    expect(errorsOf([act({ icon: '<svg onload=alert(1)>' })])[0]).toMatch(/needs an icon, one of plus, import/)
    expect(errorsOf([act({ icon: undefined })])[0]).toMatch(/needs an icon/)
    const many = (n: number, place: string) => Array.from({ length: n }, (_, i) => act({ id: `a${i}`, place }))
    expect(errorsOf(many(2, 'workspace-header'))).toEqual([])
    expect(errorsOf(many(3, 'workspace-header'))[0]).toMatch(/At most 2 actions can go in workspace-header/)
    expect(errorsOf(many(8, 'palette'))).toEqual([])
    expect(errorsOf(many(9, 'palette'))[0]).toMatch(/At most 8 actions can go in palette/)
    expect(errorsOf([...many(8, 'palette'), ...many(9, 'workspace-row').map((a, i) => ({ ...a, id: `b${i}` }))])[0]).toMatch(/at most 16 actions/)
  })

  const manifest = parseManifest({
    ...base,
    actions: [
      act({ id: 'bg' }),
      act({ id: 'app', view: 'home' }),
      act({ id: 'repo', view: 'plans', place: 'project-row' }),
      act({ id: 'tab', view: 'task', place: 'workspace-row' }),
      act({ id: 'pal', view: 'task', place: 'palette' }),
      act({ id: 'row', view: 'plans', place: 'view-row' })
    ]
  }).manifest!
  const action = (id: string) => manifest.actions!.find((a) => a.id === id)!

  it('sends a press to the view the button names, or to the background page', () => {
    const at = { repoId: 'r1', workspaceId: 'w1' }
    expect(actionTarget(manifest, action('bg'), at)).toEqual({ to: 'background' })
    expect(actionTarget(manifest, action('app'), at)).toEqual({ to: 'page', viewId: 'home' })
    expect(actionTarget(manifest, action('repo'), at)).toEqual({ to: 'page', viewId: 'plans', repoId: 'r1' })
    expect(actionTarget(manifest, action('tab'), at)).toEqual({ to: 'tab', viewId: 'task', repoId: 'r1', workspaceId: 'w1' })
    // Nowhere to open the view from here, so the button isn't offered.
    expect(actionTarget(manifest, action('repo'), {})).toBeNull()
    expect(actionTarget(manifest, action('tab'), { repoId: 'r1' })).toBeNull()
    expect(actionTarget({ ...manifest, background: undefined }, action('bg'), at)).toBeNull()
  })
  it('lists the buttons for a place, only from add-ons that are on and were allowed buttons', () => {
    const info = (key: string, more: Partial<AddonInfo> = {}): AddonInfo => ({ id: `${key}@acme`, key, name: key, description: '', version: '1', marketplace: 'acme', state: 'on', manifest, errors: [], granted: manifest.permissions, ...more })
    const addons = [info('one'), info('off', { state: 'off' }), info('review', { state: 'review' }), info('plain', { manifest: { ...manifest, permissions: [] } }), info('none', { manifest: { ...manifest, actions: undefined } })]
    const ids = (place: any, ctx: object, view?: { key: string; viewId: string }) => addonActions(addons, place, ctx, view).map((x) => `${x.addon.key}/${x.action.id}`)
    expect(ids('workspace-header', { repoId: 'r1', workspaceId: 'w1' })).toEqual(['one/bg', 'one/app'])
    expect(ids('project-row', { repoId: 'r1' })).toEqual(['one/repo'])
    expect(ids('workspace-row', { repoId: 'r1', workspaceId: 'w1' })).toEqual(['one/tab'])
    // The palette, with no workspace open: the button that needs one is left out.
    expect(ids('palette', { repoId: 'r1', workspaceId: 'w1' })).toEqual(['one/pal'])
    expect(ids('palette', {})).toEqual([])
    // A view's row shows only its own buttons.
    expect(ids('view-row', { repoId: 'r1' }, { key: 'one', viewId: 'plans' })).toEqual(['one/row'])
    expect(ids('view-row', { repoId: 'r1' }, { key: 'one', viewId: 'home' })).toEqual([])
    expect(ids('view-row', { repoId: 'r1' }, { key: 'other', viewId: 'plans' })).toEqual([])
  })
  it('tells the background page only about real presses of its own buttons, in places that exist', () => {
    const { host } = fakeHost()
    const addon = { manifest }
    expect(backgroundPress(addon, 'bg', { repoId: 'r1', workspaceId: 'a' }, host)).toEqual({ id: 'bg', place: 'workspace-header', repoId: 'r1', workspaceId: 'a' })
    // The project is filled in from the workspace.
    expect(backgroundPress(addon, 'bg', { workspaceId: 'a' }, host)).toEqual({ id: 'bg', place: 'workspace-header', repoId: 'r1', workspaceId: 'a' })
    for (const ctx of [{}, { repoId: 'r1' }, { workspaceId: 'nope' }, { workspaceId: 'old' }, { workspaceId: 'orch' }, { repoId: 'r2', workspaceId: 'a' }, { repoId: 'nope', workspaceId: 'a' }]) expect(backgroundPress(addon, 'bg', ctx, host)).toBeNull()
    // Not a button of this add-on, one that opens a view, or an add-on that was never allowed buttons.
    expect(backgroundPress(addon, 'nope', { workspaceId: 'a' }, host)).toBeNull()
    expect(backgroundPress(addon, 'repo', { repoId: 'r1', workspaceId: 'a' }, host)).toBeNull()
    expect(backgroundPress({ manifest: { ...manifest, permissions: [] } }, 'bg', { workspaceId: 'a' }, host)).toBeNull()
    expect(backgroundPress({ manifest: undefined }, 'bg', { workspaceId: 'a' }, host)).toBeNull()
  })
})

describe('add-ons a project pins', () => {
  it("reads the addons part of a project's choo-choo.json", () => {
    const pins = parsePins({ scripts: { run: 'npm start' }, addons: { sources: ['acme/addons', 'https://git.acme.dev/tools/addons.git'], required: ['plan-board@acme'], recommended: ['notes@acme', 'plan-board@acme'] } })
    expect(pins).toEqual({ sources: ['acme/addons', 'https://git.acme.dev/tools/addons.git'], required: ['plan-board@acme'], recommended: ['notes@acme'] })
    expect(parsePins({})).toEqual({ sources: [], required: [], recommended: [] })
    expect(parsePins({ addons: 'all of them' })).toEqual({ sources: [], required: [], recommended: [] })
  })
  it('drops anything that is not a plugin id or a git source', () => {
    const pins = parsePins({ addons: { sources: ['./evil', '/Users/me/x', '../up', 'file:///x', 'http://plain.example/x', 'acme/addons', 7], required: ['no-source', 'a@b', { id: 'x@y' }], recommended: ['x y@z'] } })
    expect(pins).toEqual({ sources: ['acme/addons'], required: ['a@b'], recommended: [] })
    for (const ok of ['acme/addons', 'https://github.com/acme/addons', 'git@github.com:acme/addons.git', 'ssh://git@git.acme.dev/tools/addons.git']) expect(isPinSource(ok)).toBe(true)
    for (const no of ['addons', '~/addons', 'acme/../../etc', 'https://x', 'javascript:alert(1)', '-o/--upload-pack']) expect(isPinSource(no), no).toBe(false)
  })
  it('knows two spellings of the same source', () => {
    expect(sourceKey('https://github.com/Acme/Addons.git')).toBe('acme/addons')
    expect(sourceKey('git@github.com:acme/addons')).toBe('acme/addons')
    expect(sourceKey('acme/addons/')).toBe('acme/addons')
    expect(sourceKey('https://git.acme.dev/tools/addons')).not.toBe('tools/addons')
  })
  it('checks pins against what is installed', () => {
    const pins = parsePins({ addons: { sources: ['acme/addons', 'other/more'], required: ['plan-board@acme', 'lint@acme'], recommended: ['notes@acme', 'gone@acme'] } })
    const status = pinStatus(
      'r1',
      pins,
      [{ id: 'Plan-Board@acme', name: 'Plan board', state: 'on' }, { id: 'notes@acme', name: 'Notes', state: 'off' }],
      ['Plan-Board@acme', 'notes@acme', 'lint@acme'],
      [{ source: 'https://github.com/acme/addons.git' }]
    )
    expect(status).toEqual({
      repoId: 'r1',
      newSources: ['other/more'],
      addons: [
        { id: 'plan-board@acme', name: 'Plan board', required: true, state: 'on' },
        // A plain plugin of that name is installed: nothing for Choo Choo to turn on.
        { id: 'lint@acme', name: 'lint', required: true, state: 'invalid' },
        { id: 'notes@acme', name: 'Notes', required: false, state: 'off' },
        { id: 'gone@acme', name: 'gone', required: false, state: 'missing' }
      ]
    })
  })
  it('a project without the file, or with a broken one, pins nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'choo-pins-'))
    expect(readPins(dir).required).toEqual([])
    writeFileSync(join(dir, 'choo-choo.json'), '{ not json')
    expect(readPins(dir).required).toEqual([])
    writeFileSync(join(dir, 'choo-choo.json'), JSON.stringify({ addons: { required: ['a@b'] } }))
    expect(readPins(dir).required).toEqual(['a@b'])
  })
})

describe('add-on permissions', () => {
  it('describes each permission in plain words', () => {
    expect(describePermission('workspaces:start').label).toBe('Start workspaces')
    expect(describePermission('net:api.example.com').label).toBe('Talk to api.example.com')
    expect(netHost('net:*.example.com')).toBe('*.example.com')
    for (const bad of ['net:', 'net:localhost', 'net:exa mple.com', 'net:https://x.com', 'net:x.com:8080', "net:x.com' 'unsafe-eval"]) expect(netHost(bad)).toBeNull()
  })
  it('every method names a permission the app knows', () => {
    for (const p of Object.values(METHOD_PERMISSION)) if (p) expect(describePermission(p).detail).not.toMatch(/Not a permission/)
  })
  it('refuses calls the add-on was not granted', () => {
    expect(() => checkCall('workspaces.start', ['workspaces:read'])).toThrow(/workspaces:start/)
    expect(() => checkCall('workspaces.start', ['workspaces:start'])).not.toThrow()
    expect(() => checkCall('app.info', [])).not.toThrow()
    expect(() => checkCall('fs.readFile', ['workspaces:start'])).toThrow(/Unknown method/)
  })
  it('pauses an add-on that asks for more than was agreed', () => {
    const { manifest } = parseManifest(good)
    expect(missingGrants(manifest!, ['workspaces:read'])).toEqual(['workspaces:start', 'net:api.example.com'])
    expect(addonState({ manifest, pluginEnabled: true })).toBe('off')
    expect(addonState({ manifest, pluginEnabled: true, grant: { enabled: true, granted: ['workspaces:read'] } })).toBe('review')
    expect(addonState({ manifest, pluginEnabled: true, grant: { enabled: true, granted: good.permissions } })).toBe('on')
    expect(addonState({ manifest, pluginEnabled: false, grant: { enabled: true, granted: good.permissions } })).toBe('plugin-off')
    expect(addonState({ pluginEnabled: true, grant: { enabled: true, granted: [] } })).toBe('invalid')
  })
  it("limits a view to its own files and the hosts it was granted", () => {
    const csp = viewCsp('plan-board.acme', ['workspaces:read', 'net:api.example.com'])
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('connect-src choo-addon://plan-board.acme https://api.example.com')
    expect(viewCsp('a.b', [])).toContain('connect-src choo-addon://a.b;')
    expect(csp).not.toContain('*')
  })
  it('makes host-safe keys from plugin ids', () => {
    expect(addonKey('Plan_Board@Acme.Corp')).toBe('plan-board.acme-corp')
    expect(addonKey('hello')).toBe('hello')
  })
  it('only takes well-formed messages from a view', () => {
    expect(isAddonRequest({ choo: 1, type: 'hello' })).toBe(true)
    expect(isAddonRequest({ choo: 1, type: 'call', id: 1, method: 'app.info' })).toBe(true)
    expect(isAddonRequest({ choo: 1, type: 'call', method: 'app.info' })).toBe(false)
    expect(isAddonRequest({ choo: 1, type: 'tool-result', id: 'c1', ok: true, result: 1 })).toBe(true)
    expect(isAddonRequest({ choo: 1, type: 'tool-result', id: 1, ok: true })).toBe(false)
    expect(isAddonRequest({ type: 'hello' })).toBe(false)
    expect(isAddonRequest('hello')).toBe(false)
  })
})

function addonFolder(manifest: unknown = good) {
  const dir = mkdtempSync(join(tmpdir(), 'choo-addon-'))
  mkdirSync(join(dir, 'ui'))
  mkdirSync(join(dir, '.claude-plugin'))
  writeFileSync(join(dir, 'ui', 'index.html'), '<h1>hi</h1>')
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{}')
  if (manifest !== undefined) writeFileSync(join(dir, 'choo-choo.addon.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  return dir
}

describe('finding add-ons', () => {
  it('lists installed plugins that have a manifest, with their state', () => {
    const board = addonFolder()
    const plain = mkdtempSync(join(tmpdir(), 'choo-plugin-'))
    const broken = addonFolder('{ not json')
    const plugins = [
      { id: 'plan-board@acme', version: '1.2.0', enabled: true, scope: 'user', installPath: board },
      { id: 'commit-commands@official', version: '1.0.0', enabled: true, scope: 'user', installPath: plain },
      { id: 'broken@acme', version: '', enabled: true, scope: 'user', installPath: broken }
    ]
    const list = describeAddons(plugins, { 'plan-board@acme': { enabled: true, granted: good.permissions } })
    expect(list.map((a) => [a.id, a.state])).toEqual([
      ['broken@acme', 'invalid'],
      ['plan-board@acme', 'on']
    ])
    expect(list[1]).toMatchObject({ key: 'plan-board.acme', name: 'Plan board', version: '1.2.0', marketplace: 'acme', dir: board })
    expect(list[0].errors[0]).toMatch(/isn't valid JSON/)
    expect(describeAddons(plugins, {})[1].state).toBe('off')
  })
  it('prefers the enabled copy when a plugin is installed at two scopes', () => {
    const dir = addonFolder()
    const list = describeAddons(
      [
        { id: 'a@m', version: '1', enabled: false, scope: 'project', installPath: dir },
        { id: 'a@m', version: '1', enabled: true, scope: 'user', installPath: dir }
      ],
      { 'a@m': { enabled: true, granted: good.permissions } }
    )
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ state: 'on', pluginScope: 'user' })
  })
  it('is not an add-on without a manifest', () => {
    expect(readManifest(mkdtempSync(join(tmpdir(), 'choo-plugin-')))).toBeUndefined()
  })
  it("offers a source's add-ons that aren't installed yet", () => {
    const src = mkdtempSync(join(tmpdir(), 'choo-source-'))
    mkdirSync(join(src, '.claude-plugin'))
    mkdirSync(join(src, 'board'))
    writeFileSync(join(src, 'board', 'choo-choo.addon.json'), JSON.stringify(good))
    writeFileSync(
      join(src, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'acme',
        plugins: [
          { name: 'board', source: './board', description: 'from the entry' },
          { name: 'remote', source: { source: 'github', repo: 'acme/remote' }, description: 'Tagged', keywords: ['choo-choo-addon'] },
          { name: 'just-a-plugin', source: { source: 'github', repo: 'acme/plain' } },
          { name: 'installed', source: './board' },
          { name: 'escape', source: '../../etc' }
        ]
      })
    )
    const list = availableFrom([{ name: 'acme', source: 'acme/addons', dir: src }, { name: 'gone', source: 'x', dir: '/nonexistent' }], new Set(['installed@acme']))
    expect(list.map((a) => a.id)).toEqual(['board@acme', 'remote@acme'])
    expect(list[0]).toMatchObject({ name: 'Plan board', marketplace: 'acme' })
    expect(list[0].manifest?.permissions).toEqual(good.permissions)
    expect(list[1]).toMatchObject({ name: 'remote', description: 'Tagged', manifest: undefined })
  })
  it('the example add-on in this repo is valid', () => {
    const read = readManifest(join(__dirname, '..', 'examples', 'addons', 'workspace-board'))
    expect(read?.errors).toEqual([])
    const dir = join(__dirname, '..', 'examples', 'addons', 'workspace-board')
    for (const v of read!.manifest!.views) expect(resolveFile(dir, `/${v.entry}`)).toBeTruthy()
    // Every tool it lists has a handler in its background page.
    const background = readFileSync(resolveFile(dir, `/${read!.manifest!.background}`)!, 'utf8')
    expect(read!.manifest!.tools.length).toBeGreaterThan(0)
    for (const t of read!.manifest!.tools) expect(background).toContain(`choo.tools.handle('${t.name}'`)
  })
})

describe('serving view files', () => {
  it('serves files inside the add-on and nothing else', () => {
    const dir = addonFolder()
    const outside = mkdtempSync(join(tmpdir(), 'choo-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'ui', 'link.txt'))
    expect(readFileSync(resolveFile(dir, '/ui/index.html')!, 'utf8')).toBe('<h1>hi</h1>')
    expect(resolveFile(dir, '/ui/index%2Ehtml')).toBeTruthy()
    for (const p of ['/', '/ui', '/ui/missing.html', '/../secret.txt', '/ui/%2e%2e/%2e%2e/secret.txt', '/ui/link.txt', '/.claude-plugin/plugin.json', '/ui/%00', '/%E0%A4%A']) expect(resolveFile(dir, p)).toBeNull()
  })
  it('sends the right content types', () => {
    expect(contentType('a/b/index.HTML')).toBe('text/html; charset=utf-8')
    expect(contentType('x.js')).toBe('text/javascript; charset=utf-8')
    expect(contentType('x.bin')).toBe('application/octet-stream')
  })
  it('the client script is valid JavaScript that defines window.choo', () => {
    const posted: any[] = []
    const listeners: ((e: any) => void)[] = []
    const parent = { postMessage: (m: any) => posted.push(m) }
    const style = new Map<string, string>()
    const win: any = { parent, addEventListener: (_: string, cb: (e: any) => void) => listeners.push(cb) }
    const doc = { documentElement: { style: { setProperty: (k: string, v: string) => style.set(k, v), colorScheme: '' }, dataset: {} as Record<string, string> } }
    new Function('window', 'document', HOST_SCRIPT)(win, doc)
    expect(posted).toEqual([{ choo: 1, type: 'hello' }])
    const p = win.choo.workspaces.list({ repoId: 'r1' })
    expect(posted[1]).toEqual({ choo: 1, type: 'call', id: 1, method: 'workspaces.list', args: { repoId: 'r1' } })
    // Messages from anything but the app window are ignored.
    listeners[0]({ source: {}, data: { choo: 1, type: 'result', id: 1, ok: true, result: 'spoofed' } })
    listeners[0]({ source: parent, data: { choo: 1, type: 'init', context: { viewId: 'board' }, theme: { bg: '#000' }, dark: true, apiVersion: 1 } })
    listeners[0]({ source: parent, data: { choo: 1, type: 'result', id: 1, ok: true, result: ['ws'] } })
    expect(style.get('--choo-bg')).toBe('#000')
    expect(win.choo.context).toEqual({ viewId: 'board' })
    return expect(p).resolves.toEqual(['ws'])
  })
  it("the client script runs the add-on's tool handlers and passes on events", async () => {
    vi.useFakeTimers()
    const posted: any[] = []
    const listeners: ((e: any) => void)[] = []
    const parent = { postMessage: (m: any) => posted.push(m) }
    const win: any = { parent, addEventListener: (_: string, cb: (e: any) => void) => listeners.push(cb) }
    const doc = { documentElement: { style: { setProperty: () => {}, colorScheme: '' }, dataset: {} } }
    new Function('window', 'document', HOST_SCRIPT)(win, doc)
    const say = (data: object) => listeners[0]({ source: parent, data: { choo: 1, ...data } })
    const results = () => posted.filter((m) => m.type === 'tool-result')

    // A call that arrives before the page registered its handler waits for it.
    say({ type: 'tool', id: 'c1', name: 'plan_read', input: { plan: 'q3' }, context: { repoIds: ['r1'] } })
    win.choo.tools.handle('plan_read', async (input: any, ctx: any) => ({ plan: input.plan, repos: ctx.repoIds }))
    win.choo.tools.handle('boom', () => {
      throw new Error('no such plan')
    })
    say({ type: 'tool', id: 'c2', name: 'boom', input: {}, context: { repoIds: [] } })
    await vi.advanceTimersByTimeAsync(0)
    expect(results()).toHaveLength(2)
    expect(results()).toContainEqual({ choo: 1, type: 'tool-result', id: 'c1', ok: true, result: { plan: 'q3', repos: ['r1'] } })
    expect(results()).toContainEqual({ choo: 1, type: 'tool-result', id: 'c2', ok: false, error: 'no such plan' })
    // Nothing ever handles this one: the orchestrator is told, not left waiting.
    say({ type: 'tool', id: 'c3', name: 'missing', input: {}, context: { repoIds: [] } })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(results()[2]).toEqual({ choo: 1, type: 'tool-result', id: 'c3', ok: false, error: 'The add-on has no handler for missing' })

    const heard: any[] = []
    win.choo.on('store', (e: any) => heard.push(e.key))
    win.choo.on('prs', (e: any) => heard.push(e.workspaceId))
    say({ type: 'event', name: 'store', key: 'plan' })
    say({ type: 'event', name: 'prs', workspaceId: 'w1' })
    expect(heard).toEqual(['plan', 'w1'])
    vi.useRealTimers()
  })
  it('the client script keeps a button press until the page says who answers it', async () => {
    const listeners: ((e: any) => void)[] = []
    const parent = { postMessage: () => {} }
    const win: any = { parent, addEventListener: (_: string, cb: (e: any) => void) => listeners.push(cb) }
    const doc = { documentElement: { style: { setProperty: () => {}, colorScheme: '' }, dataset: {} } }
    new Function('window', 'document', HOST_SCRIPT)(win, doc)
    const say = (data: object) => listeners[0]({ source: parent, data: { choo: 1, ...data } })
    const tick = () => new Promise((r) => setTimeout(r))

    // The press that opened the view arrives before the page's own script has run.
    say({ type: 'event', name: 'action', id: 'import', place: 'view-row', repoId: 'r1' })
    const heard: unknown[] = []
    win.choo.actions.handle('import', (ctx: unknown) => heard.push(['import', ctx]))
    win.choo.actions.handle('add', (ctx: unknown) => heard.push(['add', ctx]))
    await tick()
    expect(heard).toEqual([['import', { place: 'view-row', repoId: 'r1', workspaceId: undefined }]])
    say({ type: 'event', name: 'action', id: 'add', place: 'workspace-header', repoId: 'r1', workspaceId: 'w1' })
    // Not from anything but the app window.
    listeners[0]({ source: {}, data: { choo: 1, type: 'event', name: 'action', id: 'add', place: 'palette' } })
    await tick()
    expect(heard).toHaveLength(2)
    expect(heard[1]).toEqual(['add', { place: 'workspace-header', repoId: 'r1', workspaceId: 'w1' }])
    // A handler that throws doesn't take the page down, and the next press still arrives.
    win.choo.actions.handle('boom', () => {
      throw new Error('no')
    })
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    say({ type: 'event', name: 'action', id: 'boom', place: 'palette' })
    say({ type: 'event', name: 'action', id: 'add', place: 'palette' })
    await tick()
    expect(quiet).toHaveBeenCalledTimes(1)
    quiet.mockRestore()
    expect(heard).toHaveLength(3)
  })
})

function fakeHost() {
  const repos: Repo[] = [{ id: 'r1', name: 'web', path: '/web', defaultBranch: 'main' }, { id: 'r2', name: 'hidden', path: '/h', defaultBranch: 'main', hidden: true }]
  const ws = (id: string, extra: Partial<Workspace> = {}): Workspace => ({ id, repoId: 'r1', name: id, branch: `ben/${id}`, baseRef: 'main', path: `/ws/${id}`, title: id, createdAt: 1, ...extra })
  const chat = (id: string, workspaceId: string, extra: Partial<Chat> = {}): Chat => ({ id, workspaceId, title: 'chat', model: 'opus', effort: 'high', status: 'idle', createdAt: 1, ...extra })
  const state = {
    workspaces: [ws('a'), ws('b'), ws('old', { archived: true }), ws('orch', { orchestrator: true })],
    chats: [chat('ca', 'a', { status: 'running' }), chat('cb', 'b'), chat('co', 'orch')],
    items: { ca: [{ id: '1', kind: 'user', text: 'fix it', ts: 1 }, { id: '2', kind: 'tool', name: 'Edit', input: { file: 'a.ts' }, ts: 2 }, { id: '3', kind: 'assistant', text: 'On it', ts: 3 }] } as Record<string, ChatItem[]>,
    sent: [] as [string, string][],
    stopped: [] as string[],
    notified: [] as string[],
    opened: [] as string[],
    saves: 0
  }
  const host: AddonHost = {
    repos: () => repos,
    workspaces: () => state.workspaces,
    chats: () => state.chats,
    chatItems: (id) => state.items[id] ?? [],
    pendingChatIds: () => new Set(['cb']),
    createWorkspace: async (repoId, source) => {
      const w = ws(`new${state.workspaces.length}`, { repoId, ...(source ? { branch: `ben/pr-${source.number}`, title: `#${source.number}` } : {}) })
      const c = chat(`c-${w.id}`, w.id)
      state.workspaces.push(w)
      state.chats.push(c)
      return { workspace: w, chat: c }
    },
    sendToChat: (c, text) => {
      state.sent.push([c.id, text])
      c.status = 'running'
    },
    stopChat: async (id) => void state.stopped.push(id),
    prStatus: async () => ({
      pr: { number: 7, url: 'https://github.com/x/y/pull/7', state: 'OPEN', isDraft: true, title: 'Fix' },
      checks: [
        { name: 'test', state: 'FAILURE', bucket: 'fail', link: 'l', workflow: 'CI', description: '' },
        { name: 'lint', state: 'SUCCESS', bucket: 'pass', link: '', workflow: '', description: '' }
      ]
    }),
    prByNumber: async (_repo, number) => ({
      pr: number === 404 ? null : { number, url: `https://github.com/x/y/pull/${number}`, state: 'OPEN', isDraft: false, title: 'Theirs', reviewDecision: 'APPROVED', headRefName: number === 12 ? 'ben/b' : `ben/pr-${number}` },
      checks: number === 404 ? [] : [{ name: 'test', state: 'SUCCESS', bucket: 'pass', link: '', workflow: 'CI', description: '' }]
    }),
    notify: (title) => void state.notified.push(title),
    openWorkspace: (id) => void state.opened.push(id),
    saved: () => void state.saves++,
    appVersion: () => '9.9.9',
    storageDir: () => storage
  }
  const storage = mkdtempSync(join(tmpdir(), 'choo-addon-store-'))
  return { host, state }
}

const all = Object.values(METHOD_PERMISSION).filter((p): p is string => !!p)
const caller = (granted: string[] = all): Caller => ({ id: 'board@acme', key: 'board.acme', name: 'Board', granted })

describe('host API', () => {
  it('checks permissions before anything else', async () => {
    const { host, state } = fakeHost()
    await expect(call(host, caller([]), 'workspaces.start', { repoId: 'r1', task: 'go' })).rejects.toThrow(/workspaces:start/)
    await expect(call(host, caller(['workspaces:read']), 'workspaces.read', { workspaceId: 'a' })).rejects.toThrow(/chat:read/)
    await expect(call(host, caller(), 'nope.nothing', {})).rejects.toThrow(/Unknown method/)
    expect(state.sent).toEqual([])
  })
  it('validates arguments', async () => {
    const { host } = fakeHost()
    await expect(call(host, caller(), 'workspaces.start', { repoId: 'r1' })).rejects.toThrow(/workspaces.start: task/)
    await expect(call(host, caller(), 'workspaces.start', { repoId: 'r1', task: 'x', model: 'gpt' })).rejects.toThrow(/model/)
    await expect(call(host, caller(), 'store.get', {})).rejects.toThrow(/key/)
  })
  it('says who it is talking to', async () => {
    const { host } = fakeHost()
    expect(await call(host, caller(['storage']), 'app.info', undefined)).toEqual({ apiVersion: 1, appVersion: '9.9.9', addon: { id: 'board@acme', name: 'Board', permissions: ['storage'] } })
  })
  it('lists projects and live workspaces, never orchestrators or archived ones', async () => {
    const { host } = fakeHost()
    expect(await call(host, caller(), 'repos.list', undefined)).toEqual([{ id: 'r1', name: 'web', defaultBranch: 'main' }])
    const list = (await call(host, caller(), 'workspaces.list', {})) as any[]
    expect(list.map((w) => [w.id, w.status])).toEqual([
      ['a', 'running'],
      ['b', 'needs-approval']
    ])
    expect(list[0].lastMessage).toBe('On it')
    expect(await call(host, caller(), 'workspaces.list', { repoId: 'other' })).toEqual([])
    await expect(call(host, caller(), 'workspaces.read', { workspaceId: 'orch' })).rejects.toThrow(/No workspace/)
    await expect(call(host, caller(), 'workspaces.stop', { workspaceId: 'old' })).rejects.toThrow(/No workspace/)
  })
  it('reads a transcript as entries', async () => {
    const { host } = fakeHost()
    const r = (await call(host, caller(), 'workspaces.read', { workspaceId: 'a', last: 2 })) as any
    expect(r.entries).toEqual([
      { kind: 'tool', text: 'Edit: {"file":"a.ts"}', ts: 2, ok: true },
      { kind: 'assistant', text: 'On it', ts: 3 }
    ])
    expect(transcriptEntries([{ id: '1', kind: 'result', ok: false, ts: 5 }], 5)).toEqual([{ kind: 'turn-end', text: 'failed', ts: 5, ok: false }])
  })
  it('starts a workspace, marks whose it is, and gives the agent the task', async () => {
    const { host, state } = fakeHost()
    const w = (await call(host, caller(), 'workspaces.start', { repoId: 'r1', task: 'Build the webhook', title: 'Webhook handler', model: 'sonnet', planFirst: true })) as any
    const made = state.workspaces.find((x) => x.id === w.id)!
    expect(made).toMatchObject({ addonId: 'board@acme', title: 'Webhook handler', named: true })
    // Not marked as the orchestrator's, so finishing doesn't wake an orchestrator that never asked for it.
    expect(made.orchestrated).toBeUndefined()
    expect(state.chats.find((c) => c.workspaceId === w.id)).toMatchObject({ model: 'sonnet', planMode: true })
    expect(state.sent).toEqual([[`c-${w.id}`, 'Build the webhook']])
    expect(state.saves).toBe(1)
    expect(w).toMatchObject({ status: 'running', startedBy: 'board@acme' })
    await expect(call(host, caller(), 'workspaces.start', { repoId: 'nope', task: 'x' })).rejects.toThrow(/No project/)
  })
  it('stops a runaway add-on from starting agents without end', async () => {
    const { host } = fakeHost()
    for (let i = 0; i < MAX_RUNNING_PER_ADDON; i++) await call(host, caller(), 'workspaces.start', { repoId: 'r1', task: 'go' })
    await expect(call(host, caller(), 'workspaces.start', { repoId: 'r1', task: 'go' })).rejects.toThrow(/already has 8 agents running/)
  })
  it('messages an idle agent and refuses a busy one', async () => {
    const { host, state } = fakeHost()
    await expect(call(host, caller(), 'workspaces.message', { workspaceId: 'a', message: 'hi' })).rejects.toThrow(/still running/)
    await call(host, caller(), 'workspaces.message', { workspaceId: 'b', message: 'hi' })
    expect(state.sent).toEqual([['cb', 'hi']])
    await call(host, caller(), 'workspaces.stop', { workspaceId: 'a' })
    expect(state.stopped).toEqual(['ca'])
  })
  it('summarizes a pull request and its checks', async () => {
    const { host } = fakeHost()
    expect(await call(host, caller(), 'prs.status', { workspaceId: 'a' })).toEqual({
      pr: { number: 7, url: 'https://github.com/x/y/pull/7', state: 'OPEN', isDraft: true, title: 'Fix', reviewDecision: '', mergeState: '', branch: '' },
      checks: { total: 2, passed: 1, pending: 0, failed: [{ name: 'CI / test', link: 'l' }] }
    })
  })
  it("keeps each add-on's storage to itself, with a size limit", async () => {
    const { host } = fakeHost()
    const other: Caller = { ...caller(), id: 'other@acme', key: 'other.acme' }
    expect(await call(host, caller(), 'store.get', { key: 'plan' })).toBeNull()
    await call(host, caller(), 'store.set', { key: 'plan', value: { tasks: [1, 2] } })
    expect(await call(host, caller(), 'store.get', { key: 'plan' })).toEqual({ tasks: [1, 2] })
    expect(await call(host, caller(), 'store.keys', undefined)).toEqual(['plan'])
    expect(await call(host, other, 'store.get', { key: 'plan' })).toBeNull()
    await expect(call(host, caller(), 'store.set', { key: 'big', value: 'x'.repeat(1024 * 1024) })).rejects.toThrow(/1 MB/)
    await call(host, caller(), 'store.delete', { key: 'plan' })
    expect(await call(host, caller(), 'store.keys', undefined)).toEqual([])
  })
  it("tells the add-on's other pages when its data changes", async () => {
    const { host } = fakeHost()
    const changes: string[] = []
    host.storeChanged = (addon, key) => void changes.push(`${addon}:${key}`)
    await call(host, caller(), 'store.set', { key: 'plan', value: 1 })
    await call(host, caller(), 'store.get', { key: 'plan' })
    await call(host, caller(), 'store.delete', { key: 'plan' })
    expect(changes).toEqual(['board.acme:plan', 'board.acme:plan'])
  })
  it('looks up a pull request by its number, with no workspace', async () => {
    const { host } = fakeHost()
    expect(await call(host, caller(), 'prs.get', { repoId: 'r1', number: 31 })).toEqual({
      pr: { number: 31, url: 'https://github.com/x/y/pull/31', state: 'OPEN', isDraft: false, title: 'Theirs', reviewDecision: 'APPROVED', mergeState: '', branch: 'ben/pr-31' },
      checks: { total: 1, passed: 1, pending: 0, failed: [] }
    })
    expect(((await call(host, caller(), 'prs.get', { repoId: 'r1', number: 404 })) as { pr: unknown }).pr).toBeNull()
    await expect(call(host, caller(), 'prs.get', { repoId: 'r2', number: 31 })).rejects.toThrow(/No project/)
    await expect(call(host, caller(), 'prs.get', { repoId: 'r1', number: 0 })).rejects.toThrow(/number/)
    await expect(call(host, caller(['workspaces:read']), 'prs.get', { repoId: 'r1', number: 31 })).rejects.toThrow(/"prs:read" permission/)
  })
  it('opens a pull request in a workspace: the one already on its branch, or a new one, and starts no agent', async () => {
    const { host, state } = fakeHost()
    const before = state.workspaces.length
    // #12 is made from ben/b, which workspace b is on.
    expect(((await call(host, caller(), 'workspaces.forPr', { repoId: 'r1', number: 12 })) as { id: string }).id).toBe('b')
    expect(state.workspaces).toHaveLength(before)
    const made = (await call(host, caller(), 'workspaces.forPr', { repoId: 'r1', number: 31 })) as { id: string; branch: string; startedBy: string; status: string }
    expect(made).toMatchObject({ branch: 'ben/pr-31', startedBy: 'board@acme', status: 'idle' })
    expect(state.workspaces).toHaveLength(before + 1)
    expect(state.sent).toEqual([])
    // Asking again finds the one just made.
    expect(((await call(host, caller(), 'workspaces.forPr', { repoId: 'r1', number: 31 })) as { id: string }).id).toBe(made.id)
    expect(state.workspaces).toHaveLength(before + 1)
    await expect(call(host, caller(), 'workspaces.forPr', { repoId: 'r1', number: 404 })).rejects.toThrow(/No pull request #404/)
    await expect(call(host, caller(['prs:read']), 'workspaces.forPr', { repoId: 'r1', number: 31 })).rejects.toThrow(/"workspaces:start" permission/)
  })
  it("reads text files in a workspace's own .choo-choo folder, and writes only to the project's", async () => {
    const { host, state } = fakeHost()
    const main = mkdtempSync(join(tmpdir(), 'choo-project-'))
    const tree = mkdtempSync(join(tmpdir(), 'choo-worktree-'))
    host.repos()[0].path = main
    state.workspaces[0].path = tree
    mkdirSync(join(tree, '.choo-choo', 'plans'), { recursive: true })
    writeFileSync(join(tree, '.choo-choo', 'plans', 'q3.plan.md'), '# From the agent\n')
    const c = caller()
    expect(await call(host, c, 'files.read', { repoId: 'r1', path: 'plans/q3.plan.md' })).toBeNull()
    expect(((await call(host, c, 'files.read', { repoId: 'r1', path: 'plans/q3.plan.md', workspaceId: 'a' })) as { content: string }).content).toBe('# From the agent\n')
    expect(((await call(host, c, 'files.list', { repoId: 'r1', workspaceId: 'a' })) as { path: string }[]).map((f) => f.path)).toEqual(['plans/q3.plan.md'])
    expect(await call(host, c, 'files.list', { repoId: 'r1' })).toEqual([])
    // A write names no workspace: it lands in the project's main checkout.
    await call(host, c, 'files.write', { repoId: 'r1', path: 'plans/q3.plan.md', content: '# Copied\n', workspaceId: 'a' })
    expect(readFileSync(join(main, '.choo-choo', 'plans', 'q3.plan.md'), 'utf8')).toBe('# Copied\n')
    expect(readFileSync(join(tree, '.choo-choo', 'plans', 'q3.plan.md'), 'utf8')).toBe('# From the agent\n')
    // Only a live workspace of that project, and never through a link.
    await expect(call(host, c, 'files.read', { repoId: 'r1', path: 'plans/q3.plan.md', workspaceId: 'old' })).rejects.toThrow(/No workspace/)
    await expect(call(host, c, 'files.read', { repoId: 'r1', path: 'plans/q3.plan.md', workspaceId: 'orch' })).rejects.toThrow(/No workspace/)
    state.workspaces[1].repoId = 'r3'
    await expect(call(host, c, 'files.read', { repoId: 'r1', path: 'plans/q3.plan.md', workspaceId: 'b' })).rejects.toThrow(/isn't in project/)
    const outside = mkdtempSync(join(tmpdir(), 'choo-outside-'))
    writeFileSync(join(outside, 'secret.md'), 'secret')
    rmSync(join(tree, '.choo-choo'), { recursive: true })
    symlinkSync(outside, join(tree, '.choo-choo'))
    await expect(call(host, c, 'files.read', { repoId: 'r1', path: 'secret.md', workspaceId: 'a' })).rejects.toThrow(/outside the workspace through a link/)
  })
  it("reads and writes text files in a project's .choo-choo folder", async () => {
    const { host } = fakeHost()
    const dir = mkdtempSync(join(tmpdir(), 'choo-project-'))
    host.repos()[0].path = dir
    const c = caller()
    expect(await call(host, c, 'files.list', { repoId: 'r1' })).toEqual([])
    expect(await call(host, c, 'files.read', { repoId: 'r1', path: 'plans/q3.plan.md' })).toBeNull()
    await call(host, c, 'files.write', { repoId: 'r1', path: 'plans/q3.plan.md', content: '# Q3\n' })
    expect(readFileSync(join(dir, '.choo-choo', 'plans', 'q3.plan.md'), 'utf8')).toBe('# Q3\n')
    expect(((await call(host, c, 'files.read', { repoId: 'r1', path: 'plans/q3.plan.md' })) as { content: string }).content).toBe('# Q3\n')
    await call(host, c, 'files.write', { repoId: 'r1', path: 'notes.json', content: '{}' })
    writeFileSync(join(dir, '.choo-choo', 'plans', '.hidden.md'), 'x')
    writeFileSync(join(dir, '.choo-choo', 'plans', 'run.sh'), 'x')
    expect(((await call(host, c, 'files.list', { repoId: 'r1' })) as { path: string }[]).map((f) => f.path)).toEqual(['notes.json', 'plans/q3.plan.md'])
    expect(((await call(host, c, 'files.list', { repoId: 'r1', dir: 'plans' })) as { path: string }[]).map((f) => f.path)).toEqual(['plans/q3.plan.md'])
    await call(host, c, 'files.delete', { repoId: 'r1', path: 'plans/q3.plan.md' })
    expect(await call(host, c, 'files.read', { repoId: 'r1', path: 'plans/q3.plan.md' })).toBeNull()
    // Leaves no temp files behind.
    expect(readdirSync(join(dir, '.choo-choo', 'plans')).sort()).toEqual(['.hidden.md', 'run.sh'])
  })
  it('keeps add-on files inside .choo-choo, as text, and never follows a link out', async () => {
    const { host } = fakeHost()
    const dir = mkdtempSync(join(tmpdir(), 'choo-project-'))
    const outside = mkdtempSync(join(tmpdir(), 'choo-outside-'))
    writeFileSync(join(outside, 'secret.md'), 'secret')
    host.repos()[0].path = dir
    const c = caller()
    const write = (path: string) => call(host, c, 'files.write', { repoId: 'r1', path, content: 'x' })
    for (const path of ['../x.md', '/etc/x.md', 'a/../../x.md', '.git/config.md', 'plans/.env.md']) await expect(write(path), path).rejects.toThrow(/isn't a path inside/)
    for (const path of ['run.sh', 'plans/hook', 'plans/a.js', 'x.md.exe']) await expect(write(path), path).rejects.toThrow(/can only keep/)
    await expect(call(host, c, 'files.write', { repoId: 'r1', path: 'big.md', content: 'x'.repeat(1024 * 1024 + 1) })).rejects.toThrow(/over 1 MB/)
    await expect(call(host, c, 'files.read', { repoId: 'r2', path: 'a.md' })).rejects.toThrow(/No project/)
    await expect(call(host, caller(['storage']), 'files.read', { repoId: 'r1', path: 'a.md' })).rejects.toThrow(/"files:read" permission/)
    await expect(call(host, caller(['files:read']), 'files.write', { repoId: 'r1', path: 'a.md', content: 'x' })).rejects.toThrow(/"files:write" permission/)

    // A folder that is a link to somewhere else.
    mkdirSync(join(dir, '.choo-choo'))
    symlinkSync(outside, join(dir, '.choo-choo', 'plans'))
    await expect(write('plans/new.md')).rejects.toThrow(/outside the project through a link/)
    await expect(call(host, c, 'files.read', { repoId: 'r1', path: 'plans/secret.md' })).rejects.toThrow(/through a link/)
    await expect(call(host, c, 'files.list', { repoId: 'r1', dir: 'plans' })).rejects.toThrow(/through a link/)
    expect(await call(host, c, 'files.list', { repoId: 'r1' })).toEqual([])
    // A file that is a link to somewhere else.
    symlinkSync(join(outside, 'secret.md'), join(dir, '.choo-choo', 'link.md'))
    await expect(call(host, c, 'files.read', { repoId: 'r1', path: 'link.md' })).rejects.toThrow(/through a link/)
    await expect(write('link.md')).rejects.toThrow(/through a link/)
    await expect(call(host, c, 'files.delete', { repoId: 'r1', path: 'link.md' })).rejects.toThrow(/through a link/)
    expect(readFileSync(join(outside, 'secret.md'), 'utf8')).toBe('secret')
    expect(readdirSync(outside)).toEqual(['secret.md'])
    // A pipe left under a text file's name is refused, not waited on.
    try {
      execFileSync('mkfifo', [join(dir, '.choo-choo', 'pipe.md')])
      await expect(call(host, c, 'files.read', { repoId: 'r1', path: 'pipe.md' })).rejects.toThrow(/isn't a file/)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    // The whole .choo-choo folder as a link.
    const linked = mkdtempSync(join(tmpdir(), 'choo-project-'))
    symlinkSync(outside, join(linked, '.choo-choo'))
    host.repos()[0].path = linked
    await expect(write('new.md')).rejects.toThrow(/through a link/)
    expect(readdirSync(outside)).toEqual(['secret.md'])
  })
  it('opens workspaces and notifies under its own name', async () => {
    const { host, state } = fakeHost()
    await call(host, caller(), 'ui.openWorkspace', { workspaceId: 'a' })
    await call(host, caller(), 'ui.notify', { title: 'Plan done', body: '9 of 9 merged' })
    expect(state.opened).toEqual(['a'])
    expect(state.notified).toEqual(['Board: Plan done'])
    await expect(call(host, caller(), 'ui.openWorkspace', { workspaceId: 'orch' })).rejects.toThrow(/No workspace/)
  })
})
