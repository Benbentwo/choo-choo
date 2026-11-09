import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('../src/main/claudeBinary', () => ({ claudeExecutable: () => '/nonexistent/claude' }))
import { ADDON_API_VERSION, addonKey, addonState, checkCall, describePermission, isAddonRequest, missingGrants, netHost, parseManifest, safeRelativePath, viewCsp, METHOD_PERMISSION } from '../src/shared/addons'
import { availableFrom, contentType, describeAddons, readManifest, resolveFile } from '../src/main/addons'
import { call, MAX_RUNNING_PER_ADDON, transcriptEntries, type AddonHost, type Caller } from '../src/main/addonApi'
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
    expect(manifest).toEqual({ apiVersion: 1, name: 'Plan board', description: undefined, permissions: good.permissions, views: good.views })
  })
  it('needs nothing but apiVersion', () => {
    expect(parseManifest({ apiVersion: 1 }).manifest).toEqual({ apiVersion: 1, name: undefined, description: undefined, permissions: [], views: [] })
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
    for (const v of read!.manifest!.views) expect(resolveFile(join(__dirname, '..', 'examples', 'addons', 'workspace-board'), `/${v.entry}`)).toBeTruthy()
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
    createWorkspace: async (repoId) => {
      const w = ws(`new${state.workspaces.length}`, { repoId })
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
      pr: { number: 7, url: 'https://github.com/x/y/pull/7', state: 'OPEN', isDraft: true, title: 'Fix', reviewDecision: '', mergeState: '' },
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
  it('opens workspaces and notifies under its own name', async () => {
    const { host, state } = fakeHost()
    await call(host, caller(), 'ui.openWorkspace', { workspaceId: 'a' })
    await call(host, caller(), 'ui.notify', { title: 'Plan done', body: '9 of 9 merged' })
    expect(state.opened).toEqual(['a'])
    expect(state.notified).toEqual(['Board: Plan done'])
    await expect(call(host, caller(), 'ui.openWorkspace', { workspaceId: 'orch' })).rejects.toThrow(/No workspace/)
  })
})
