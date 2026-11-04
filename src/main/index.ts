import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Artifact, Chat, FilePreview, Repo, Settings, Workspace } from '@shared/types'
import * as store from './store'
import * as git from './git'
import * as agent from './agent'
import * as pty from './pty'
import { pickCityName } from './names'
import { readScripts } from './scripts'
import { listCommands } from './commands'
import * as gh from './github'
import { suggestName } from './naming'
import { checkNow, installUpdate, startUpdater } from './updater'

let win: BrowserWindow | null = null

const WORKSPACES_ROOT = join(homedir(), 'choo-choo', 'workspaces')
const REPOS_ROOT = join(homedir(), 'choo-choo', 'repos')

function send(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

function findWs(id: string): Workspace {
  const ws = store.get().workspaces.find((w) => w.id === id)
  if (!ws) throw new Error(`Unknown workspace ${id}`)
  return ws
}

function findChat(id: string): Chat {
  const c = store.get().chats.find((x) => x.id === id)
  if (!c) throw new Error(`Unknown chat ${id}`)
  return c
}

/** Env vars scripts and agents see. Conductor-compatible names plus CHOO_ aliases. */
function workspaceEnv(ws: Workspace): Record<string, string> {
  const repo = store.get().repos.find((r) => r.id === ws.repoId)
  const index = store.get().workspaces.filter((w) => !w.archived).findIndex((w) => w.id === ws.id)
  const port = String(55000 + Math.max(0, index) * 10)
  const vars: Record<string, string> = {
    ROOT_PATH: repo?.path ?? '',
    WORKSPACE_NAME: ws.name,
    WORKSPACE_PATH: ws.path,
    DEFAULT_BRANCH: repo?.defaultBranch ?? 'main',
    PORT: port
  }
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    env[`CONDUCTOR_${k}`] = v
    env[`CHOO_${k}`] = v
  }
  return env
}

function scriptsFor(ws: Workspace) {
  const repo = store.get().repos.find((r) => r.id === ws.repoId)
  return readScripts(ws.path, repo?.path ?? ws.path)
}

function runScript(ws: Workspace, kind: 'setup' | 'run'): boolean {
  const cmd = scriptsFor(ws)[kind]
  if (!cmd) return false
  const id = `${ws.id}:${kind}`
  pty.kill(id)
  send('script:started', ws.id, kind)
  pty.create(
    id,
    ws.path,
    workspaceEnv(ws),
    (i, d) => send('pty:data', i, d),
    (i, c) => send('pty:exit', i, c),
    cmd,
    `\x1b[2m$ ${cmd}\x1b[0m\r\n`
  )
  return true
}

async function addRepo(path: string): Promise<Repo> {
  const root = await git.repoRoot(path)
  const s = store.get()
  const existing = s.repos.find((r) => r.path === root)
  if (existing) {
    existing.hidden = false
    store.save()
    return existing
  }
  const repo: Repo = { id: randomUUID(), name: basename(root), path: root, defaultBranch: await git.defaultBranch(root) }
  s.repos.push(repo)
  store.save()
  return repo
}

function newChat(workspaceId: string): Chat {
  const chat: Chat = {
    id: randomUUID(),
    workspaceId,
    title: 'New chat',
    model: store.get().settings.defaultModel,
    effort: store.get().settings.defaultEffort,
    permission: store.get().settings.defaultPermission,
    status: 'idle',
    createdAt: Date.now()
  }
  store.get().chats.push(chat)
  store.save()
  return chat
}

async function createWorkspace(repoId: string) {
  const s = store.get()
  const repo = s.repos.find((r) => r.id === repoId)
  if (!repo) throw new Error('Unknown repo')
  const taken = new Set(s.workspaces.filter((w) => w.repoId === repoId).map((w) => w.name))
  const name = pickCityName(taken)
  const prefix = store.get().settings.branchPrefix.trim() || (await git.branchPrefix(repo.path))
  const branch = `${prefix}/${name}`
  const baseRef = await git.baseRefFor(repo.path, repo.defaultBranch)
  const dir = join(WORKSPACES_ROOT, repo.name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  await git.addWorktree(repo.path, path, branch, baseRef)
  const workspace: Workspace = {
    id: randomUUID(),
    repoId,
    name,
    branch,
    baseRef,
    path,
    title: name,
    createdAt: Date.now()
  }
  s.workspaces.push(workspace)
  const chat = newChat(workspace.id)
  runScript(workspace, 'setup')
  return { workspace, chat }
}

/** After the first prompt, give the workspace a real title and rename its branch to match (until it is pushed). */
async function nameWorkspace(ws: Workspace, prompt: string) {
  ws.named = true
  store.save()
  const { title, slug } = await suggestName(prompt)
  ws.title = title
  if (slug) {
    const prefix = ws.branch.includes('/') ? ws.branch.slice(0, ws.branch.lastIndexOf('/') + 1) : ''
    const next = `${prefix}${slug}`
    if (next !== ws.branch && (await git.renameBranch(ws.path, ws.branch, next))) ws.branch = next
  }
  store.save()
  send('state:changed')
}

function notifyDone(chat: Chat) {
  if (!store.get().settings.notifications || win?.isFocused() || !Notification.isSupported()) return
  const ws = store.get().workspaces.find((w) => w.id === chat.workspaceId)
  const n = new Notification({
    title: ws?.title ?? 'Choo Choo',
    body: chat.status === 'error' ? 'The agent hit an error' : 'The agent finished and is waiting for you'
  })
  n.on('click', () => {
    win?.show()
    win?.focus()
    send('navigate', chat.workspaceId, chat.id)
  })
  n.show()
}

function notifyAsk(chat: Chat, req: { toolName: string }) {
  if (!store.get().settings.notifications || win?.isFocused() || !Notification.isSupported()) return
  const ws = store.get().workspaces.find((w) => w.id === chat.workspaceId)
  const n = new Notification({ title: ws?.title ?? 'Choo Choo', body: `The agent wants to use ${req.toolName}` })
  n.on('click', () => {
    win?.show()
    win?.focus()
    send('navigate', chat.workspaceId, chat.id)
  })
  n.show()
}

/** Resolves a path inside the workspace, refusing anything that escapes it. */
function insideWorkspace(ws: Workspace, rel: string): string {
  const abs = resolve(ws.path, rel)
  const r = relative(ws.path, abs)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error('Path is outside the workspace')
  return abs
}

function readPreview(ws: Workspace, rel: string): FilePreview {
  const abs = insideWorkspace(ws, rel)
  if (!existsSync(abs)) return { path: rel, content: null, reason: 'File not found' }
  const st = statSync(abs)
  if (st.size > 1024 * 1024) return { path: rel, content: null, reason: 'File is larger than 1 MB' }
  const buf = readFileSync(abs)
  if (buf.subarray(0, 8000).includes(0)) return { path: rel, content: null, reason: 'Binary file' }
  return { path: rel, content: buf.toString('utf8') }
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

function artifacts(ws: Workspace): Artifact[] {
  const seen = new Map<string, Artifact>()
  for (const c of store.get().chats.filter((c) => c.workspaceId === ws.id)) {
    for (const it of store.chatItems(c.id)) {
      if (it.kind !== 'tool' || !WRITE_TOOLS.has(it.name) || it.isError) continue
      const fp = (it.input as { file_path?: string; notebook_path?: string })?.file_path ?? (it.input as { notebook_path?: string })?.notebook_path
      if (!fp) continue
      const rel = isAbsolute(fp) ? relative(ws.path, fp) : fp
      seen.set(rel, { path: rel, tool: it.name, ts: it.ts })
    }
  }
  return [...seen.values()].sort((a, b) => b.ts - a.ts)
}

function registerIpc() {
  const h = (ch: string, fn: (...a: any[]) => unknown) => ipcMain.handle(ch, (_e, ...a) => fn(...a))

  h('state:get', () => store.get())
  h('repo:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], message: 'Choose a git repository' })
    if (r.canceled || !r.filePaths[0]) return null
    return addRepo(r.filePaths[0])
  })
  h('repo:add', (p: string) => addRepo(p))
  h('repo:remove', (id: string) => {
    const s = store.get()
    s.repos = s.repos.filter((r) => r.id !== id)
    store.save()
  })
  h('repo:hidden', (id: string, hidden: boolean) => {
    const r = store.get().repos.find((x) => x.id === id)
    if (r) r.hidden = hidden
    store.save()
  })
  h('ws:create', (repoId: string) => createWorkspace(repoId))
  h('ws:archive', async (id: string) => {
    const ws = findWs(id)
    const repo = store.get().repos.find((r) => r.id === ws.repoId)
    for (const c of store.get().chats.filter((c) => c.workspaceId === id)) await agent.stop(c.id)
    pty.killPrefix(`${id}:`)
    const archiveCmd = scriptsFor(ws).archive
    if (archiveCmd) {
      const { execFile } = await import('node:child_process')
      await new Promise<void>((resolve) =>
        execFile(process.env.SHELL || '/bin/zsh', ['-lc', archiveCmd], { cwd: ws.path, env: { ...process.env, ...workspaceEnv(ws) }, timeout: 120_000 }, () => resolve())
      )
    }
    if (repo) await git.removeWorktree(repo.path, ws.path)
    ws.archived = true
    ws.archivedAt = Date.now()
    store.save()
  })
  h('ws:restore', async (id: string) => {
    const ws = findWs(id)
    const repo = store.get().repos.find((r) => r.id === ws.repoId)
    if (!repo) throw new Error('The repository for this workspace was removed')
    if (existsSync(ws.path)) throw new Error(`${ws.path} already exists`)
    mkdirSync(join(ws.path, '..'), { recursive: true })
    await git.addWorktreeForBranch(repo.path, ws.path, ws.branch)
    ws.archived = false
    store.save()
    runScript(ws, 'setup')
  })
  h('ws:rename', (id: string, title: string) => {
    findWs(id).title = title
    store.save()
  })
  h('chat:create', (wsId: string) => newChat(wsId))
  h('chat:close', async (id: string) => {
    await agent.stop(id)
    const s = store.get()
    s.chats = s.chats.filter((c) => c.id !== id)
    store.deleteChatItems(id)
    store.save()
  })
  h('chat:items', (id: string) => store.chatItems(id))
  h('chat:update', (id: string, patch: Partial<Chat>) => {
    const c = findChat(id)
    if (patch.model) c.model = patch.model
    if (patch.effort) c.effort = patch.effort
    if (patch.title) c.title = patch.title
    if (patch.unread !== undefined) c.unread = patch.unread
    if (patch.planMode !== undefined) c.planMode = patch.planMode
    if (patch.review !== undefined) c.review = patch.review
    if (patch.permission) c.permission = patch.permission
    store.save()
    return c
  })
  h('chat:addFolder', async (id: string) => {
    const c = findChat(id)
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'multiSelections'], message: 'Give the agent access to folders' })
    if (!r.canceled) c.additionalDirectories = [...new Set([...(c.additionalDirectories ?? []), ...r.filePaths])]
    store.save()
    return c
  })
  h('chat:removeFolder', (id: string, dir: string) => {
    const c = findChat(id)
    c.additionalDirectories = (c.additionalDirectories ?? []).filter((d) => d !== dir)
    store.save()
    return c
  })
  h('ws:files', (id: string) => git.listFiles(findWs(id).path))
  h('ws:commands', (id: string) => listCommands(findWs(id).path, agent.reportedCommands.get(id)))
  h('scripts:get', (id: string) => scriptsFor(findWs(id)))
  h('scripts:run', (id: string, kind: 'setup' | 'run') => runScript(findWs(id), kind))
  ipcMain.on('scripts:stop', (_e, id: string, kind: string) => pty.kill(`${id}:${kind}`))
  h('scripts:running', (id: string, kind: string) => pty.isAlive(`${id}:${kind}`))
  h('pr:get', (id: string) => {
    const ws = findWs(id)
    return gh.prForBranch(ws.path, ws.branch)
  })
  h('checks:get', (id: string) => {
    const ws = findWs(id)
    return gh.checks(ws.path, ws.branch)
  })
  h('checks:rerun', (id: string, link: string) => gh.rerunFailed(findWs(id).path, link))
  h('ws:artifacts', (id: string) => artifacts(findWs(id)))
  h('ws:readFile', (id: string, rel: string) => readPreview(findWs(id), rel))
  h('chat:revert', (id: string, itemId: string) => {
    const chat = findChat(id)
    return agent.revert(chat, findWs(chat.workspaceId), itemId)
  })
  h('settings:save', (patch: Partial<Settings>) => {
    const s = store.get()
    s.settings = { ...s.settings, ...patch }
    store.save()
    return s.settings
  })
  h('repo:clone', async (url: string) => {
    if (!/^(https:\/\/|git@|ssh:\/\/)/.test(url.trim())) throw new Error('Enter an https or ssh git URL')
    mkdirSync(REPOS_ROOT, { recursive: true })
    let dest = join(REPOS_ROOT, git.repoNameFromUrl(url))
    for (let n = 2; existsSync(dest); n++) dest = join(REPOS_ROOT, `${git.repoNameFromUrl(url)}-${n}`)
    await git.clone(url.trim(), dest)
    return addRepo(dest)
  })
  h('pr:merge', async (id: string) => {
    const ws = findWs(id)
    const pr = await gh.prForBranch(ws.path, ws.branch)
    if (!pr) throw new Error('No pull request for this branch')
    await gh.mergePr(ws.path, pr.number)
  })
  h('chat:send', (id: string, text: string, images: string[] = []) => {
    const chat = findChat(id)
    const ws = findWs(chat.workspaceId)
    if (!ws.named) void nameWorkspace(ws, text)
    // Fire and forget; progress arrives through chat:event.
    const env = workspaceEnv(ws)
    const key = store.get().settings.anthropicApiKey.trim()
    if (key) env.ANTHROPIC_API_KEY = key
    void agent.send(chat, ws, text, env, (chatId, payload) => send('chat:event', { chatId, ...payload }), notifyDone, images.slice(0, 10), notifyAsk)
  })
  h('chat:stop', (id: string) => agent.stop(id))
  ipcMain.on('permission:respond', (_e, id: string, d: 'allow' | 'always' | 'deny') => agent.respondPermission(id, d))
  h('permission:pending', () => agent.pendingPermissions())
  h('git:changes', (wsId: string) => {
    const ws = findWs(wsId)
    return git.changes(ws.path, ws.baseRef)
  })
  h('git:stats', async (wsId: string) => {
    const ws = findWs(wsId)
    try {
      return git.summarize(await git.changes(ws.path, ws.baseRef))
    } catch {
      return { additions: 0, deletions: 0, files: 0 }
    }
  })
  h('git:fileDiff', (wsId: string, file: string) => {
    const ws = findWs(wsId)
    return git.fileDiff(ws.path, ws.baseRef, file)
  })
  h('pty:create', (id: string, wsId: string) => {
    const ws = findWs(wsId)
    return pty.create(id, ws.path, workspaceEnv(ws), (i, d) => send('pty:data', i, d), (i, c) => send('pty:exit', i, c))
  })
  h('pty:attach', (id: string) => pty.attach(id))
  ipcMain.on('pty:write', (_e, id: string, d: string) => pty.write(id, d))
  ipcMain.on('pty:resize', (_e, id: string, c: number, r: number) => pty.resize(id, c, r))
  ipcMain.on('pty:kill', (_e, id: string) => pty.kill(id))
  h('update:install', () => installUpdate())
  h('shell:open', (url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  h('shell:reveal', (p: string) => shell.showItemInFolder(p))
}

function buildMenu() {
  const m = (action: string) => () => send('menu', action)
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => void checkNow(win) },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: m('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'Add Repository…', accelerator: 'CmdOrCtrl+O', click: m('add-repo') },
        { label: 'New Workspace', accelerator: 'CmdOrCtrl+N', click: m('new-workspace') },
        { label: 'New Chat Tab', accelerator: 'CmdOrCtrl+T', click: m('new-chat') },
        { label: 'Close Chat Tab', accelerator: 'CmdOrCtrl+W', click: m('close-chat') },
        { type: 'separator' },
        { label: 'Run', accelerator: 'CmdOrCtrl+R', click: m('run') },
        { label: 'Next Unread', accelerator: 'CmdOrCtrl+Shift+U', click: m('next-unread') },
        { label: 'Search…', accelerator: 'CmdOrCtrl+K', click: m('search') },
        { type: 'separator' },
        { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: m('toggle-sidebar') },
        { label: 'Toggle Right Panel', accelerator: 'CmdOrCtrl+Alt+B', click: m('toggle-right') },
        { label: 'Toggle Terminal', accelerator: 'CmdOrCtrl+J', click: m('toggle-terminal') },
        { type: 'separator' },
        { role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#1a1817',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

// GUI apps on macOS start with a minimal PATH. Pick up the login shell's PATH so git, gh and claude resolve.
async function fixPath() {
  if (process.platform !== 'darwin') return
  const { execFile } = await import('node:child_process')
  await new Promise<void>((resolve) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "%s" "$PATH"'], { timeout: 5000 }, (err, out) => {
      if (!err && out) process.env.PATH = out.trim().split('\n').pop()
      resolve()
    })
  })
}

app.whenReady().then(async () => {
  await fixPath()
  store.load()
  registerIpc()
  buildMenu()
  createWindow()
  startUpdater(send)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  agent.stopAll()
  store.flush()
  pty.killAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
