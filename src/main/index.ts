import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { SourceOption, WorkspaceSource } from '@shared/types'
import type { Artifact, Chat, FilePreview, PromptCustom, Repo, Settings, Workspace } from '@shared/types'
import { normalizeExtras, normalizeTelemetry, telemetryEnv } from '@shared/types'
import { sessionUsage } from './usage'
import * as store from './store'
import * as git from './git'
import * as agent from './agent'
import * as pty from './pty'
import { pickCityName } from './names'
import { readScripts } from './scripts'
import { listCommands } from './commands'
import * as gh from './github'
import { startPrWatch } from './prWatch'
import { suggestName, suggestTitleFromChats } from './naming'
import * as updates from './updater'
import { registerDevFeedback } from './devFeedback'
import * as conductor from './conductorImport'
import { modelDetails } from './models'
import { listOutputStyles } from './claudeOptions'
import * as mcp from './mcp'
import * as plugins from './plugins'
import { resolveTheme } from '@shared/themes'
import { autoSync, registerShareIpc } from './shareIpc'
import * as orchestrator from './orchestrator'
import * as reflection from './reflect'
import { isReflectTarget, type ReflectProposal } from '@shared/reflect'
import * as archive from './archive'
import * as remote from './remote'
import * as cloud from './cloud'
import { registerIntegrationsIpc } from './integrations'
import * as notion from './integrations/notion'
import * as addonHost from './addonHost'
import { originUrl, githubSlug } from './share'
import { prBranch, type PrInbox } from '@shared/prInbox'

let win: BrowserWindow | null = null

const WORKSPACES_ROOT = join(homedir(), 'choo-choo', 'workspaces')
const REPOS_ROOT = join(homedir(), 'choo-choo', 'repos')

function send(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  addonHost.appEvent(channel, args[0])
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
  const fromFiles = readScripts(ws.path, repo?.path ?? ws.path)
  return fromFiles.source || !repo?.scripts ? fromFiles : { ...repo.scripts, source: 'app settings' }
}

const workspacesRoot = () => {
  const r = store.get().settings.workspacesRoot?.trim()
  return r ? resolve(r.replace(/^~(?=$|\/)/, homedir())) : WORKSPACES_ROOT
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
  const repo: Repo = { id: randomUUID(), name: basename(root), path: root, defaultBranch: await git.defaultBranch(root), githubOwner: await git.githubOwner(root) }
  s.repos.push(repo)
  s.recentPaths = [root, ...(s.recentPaths ?? []).filter((p) => p !== root)].slice(0, 10)
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

async function createWorkspace(repoId: string, source?: WorkspaceSource, folders: string[] = []) {
  const s = store.get()
  const repo = s.repos.find((r) => r.id === repoId)
  if (!repo) throw new Error('Unknown repo')
  const taken = new Set(s.workspaces.filter((w) => w.repoId === repoId).map((w) => w.name))
  const name = pickCityName(taken)
  const baseRef = await git.baseRefFor(repo.path, repo.defaultBranch)
  const dir = join(workspacesRoot(), repo.name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  let branch: string
  let title = name
  let named = false
  let context: string | undefined
  if (source?.kind === 'branch') {
    branch = source.name
    await git.addWorktreeForRemoteBranch(repo.path, path, branch)
    title = branch
    named = true
  } else if (source?.kind === 'pr') {
    const pr = await gh.prHead(repo.path, source.number)
    branch = pr.isCrossRepository ? `pr-${source.number}` : pr.headRefName
    if (pr.isCrossRepository) await git.addWorktreeForPull(repo.path, path, source.number, branch)
    else await git.addWorktreeForRemoteBranch(repo.path, path, branch)
    title = `#${source.number} ${pr.title}`
    named = true
  } else {
    const prefix = store.get().settings.branchPrefix.trim() || (await git.branchPrefix(repo.path))
    branch = `${prefix}/${name}`
    await git.addWorktree(repo.path, path, branch, baseRef)
    if (source?.kind === 'issue') {
      const issue = await gh.issueText(repo.path, source.number)
      context = gh.issueContext(source.number, issue)
    } else if (source?.kind === 'notion') {
      context = notion.pageContext(source.id)
    }
  }
  const workspace: Workspace = { id: randomUUID(), repoId, name, branch, baseRef, path, title, named, createdAt: Date.now() }
  s.workspaces.push(workspace)
  const chat = newChat(workspace.id)
  if (folders.length) chat.additionalDirectories = [...new Set(folders)]
  runScript(workspace, 'setup')
  return { workspace, chat, context }
}

/** The PRs page's list, with each PR tied to its local project and any workspace already on its branch. */
async function loadPrInbox(): Promise<PrInbox> {
  const prs = await gh.prInbox()
  const s = store.get()
  const bySlug = new Map<string, string>()
  await Promise.all(
    s.repos.map(async (r) => {
      if (r.githubOwner === '' || !existsSync(r.path)) return
      const slug = githubSlug(await originUrl(r.path).catch(() => ''))
      if (slug && !bySlug.has(slug)) bySlug.set(slug, r.id)
    })
  )
  for (const p of prs) {
    const repoId = bySlug.get(p.repo.toLowerCase())
    if (!repoId) continue
    p.repoId = repoId
    const branch = prBranch(p)
    p.workspaceId = s.workspaces.find((w) => w.repoId === repoId && !w.archived && !w.orchestrator && w.branch === branch)?.id
  }
  return { prs, fetchedAt: Date.now() }
}

async function previewConductor() {
  if (!existsSync(conductor.CONDUCTOR_DB)) return { found: false, repos: [], workspaces: [], archivedSkipped: 0, settings: [] }
  const s = store.get()
  const data = await conductor.withConductorDb(conductor.CONDUCTOR_DB, conductor.readConductor)
  return conductor.preview(data, { repoPaths: s.repos.map((r) => r.path), workspacePaths: s.workspaces.map((w) => w.path) })
}

async function importConductor(opts: { useWorkspacesRoot: boolean }) {
  const s = store.get()
  const result = { repos: 0, workspaces: 0, chats: 0, messages: 0 }
  await conductor.withConductorDb(conductor.CONDUCTOR_DB, async (db) => {
    const data = conductor.readConductor(db)
    const repoIds = new Map<string, string>()
    for (const r of data.repos) {
      if (!existsSync(r.root_path)) continue
      const had = s.repos.some((x) => x.path === r.root_path)
      let repo: Repo
      try {
        repo = await addRepo(r.root_path)
      } catch {
        continue // not a git repo any more
      }
      if (!had) {
        result.repos++
        repo.hidden = !!r.hidden
      }
      repo.scripts ??= conductor.repoScripts(r)
      repoIds.set(r.id, repo.id)
    }
    for (const { ws, repo, sessions } of conductor.activeWorkspaces(data)) {
      const repoId = repoIds.get(repo.id)
      if (!repoId || s.workspaces.some((w) => w.path === ws.workspace_path)) continue
      const ours = s.repos.find((r) => r.id === repoId)!
      const target = ws.intended_target_branch || ours.defaultBranch
      const workspace: Workspace = {
        id: randomUUID(),
        repoId,
        name: ws.directory_name,
        branch: ws.branch || (await git.currentBranch(ws.workspace_path!)) || ws.directory_name,
        baseRef: await git.baseRefFor(ours.path, target),
        path: ws.workspace_path!,
        title: ws.workspace_name || ws.pr_title || ws.directory_name,
        named: true,
        createdAt: Date.parse(ws.created_at.replace(' ', 'T') + 'Z') || Date.now()
      }
      s.workspaces.push(workspace)
      result.workspaces++
      for (const cs of sessions) {
        const items = conductor.convertMessages(conductor.readMessages(db, cs.id))
        const chat = newChat(workspace.id)
        chat.title = cs.title && cs.title !== 'Untitled' ? cs.title : chat.title
        chat.model = conductor.mapModel(cs.model, cs.agent_type)
        chat.effort = conductor.mapEffort(cs.claude_effort_level, chat.effort)
        chat.planMode = cs.permission_mode === 'plan' || undefined
        // Same worktree path, so Claude Code can resume the Conductor session with its full context.
        if (cs.agent_type !== 'codex' && cs.claude_session_id) chat.sdkSessionId = cs.claude_session_id
        chat.createdAt = Date.parse(cs.created_at.replace(' ', 'T') + 'Z') || chat.createdAt
        store.replaceItems(chat.id, items)
        result.chats++
        result.messages += items.length
      }
      if (!sessions.length) newChat(workspace.id)
    }
    const set = data.settings
    if (set.default_model) s.settings.defaultModel = conductor.mapModel(set.default_model, null)
    if (opts.useWorkspacesRoot) {
      const root = conductor.workspacesRootOf(data)
      if (root) s.settings.workspacesRoot = root
    }
  })
  store.save()
  send('state:changed')
  return result
}

async function listSources(repoId: string, kind: WorkspaceSource['kind'], query: string): Promise<SourceOption[]> {
  const repo = store.get().repos.find((r) => r.id === repoId)
  if (!repo) throw new Error('Unknown repo')
  if (kind === 'pr') return gh.listPrs(repo.path, query)
  if (kind === 'issue') return gh.listIssues(repo.path, query)
  if (kind === 'notion') return notion.search(query)
  const q = query.toLowerCase()
  return (await git.remoteBranches(repo.path))
    .filter((b) => b.name.toLowerCase().includes(q))
    .slice(0, 100)
    .map((b) => ({ source: { kind: 'branch', name: b.name }, title: b.name, detail: b.when }))
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

const emitChat = (chatId: string, payload: object) => send('chat:event', { chatId, ...payload })

/** Messages the person sent while a turn couldn't take them (Codex, or the turn was ending), per chat. */
const afterTurn = new Map<string, { text: string; images: string[] }[]>()

/**
 * A message the person typed. While Claude is working it goes into the running turn, steered
 * or queued per Settings; when the turn can't take it, it waits and is sent when the turn ends.
 */
function sendFromPerson(chat: Chat, text: string, images: string[]) {
  if (!agent.isRunning(chat.id)) return sendToChat(chat, text, images)
  if (agent.pushMessage(chat, text, images.slice(0, 10), store.get().settings.whileRunning ?? 'steer', emitChat)) return
  afterTurn.set(chat.id, [...(afterTurn.get(chat.id) ?? []), { text, images }])
  emitChat(chat.id, { item: { id: randomUUID(), kind: 'note', text: 'Your message will be sent when Claude finishes.', ts: Date.now() } })
}

/** Starts a turn. Fire and forget; progress arrives through chat:event. */
function sendToChat(chat: Chat, text: string, images: string[] = [], opts: { fromAdvisor?: boolean } = {}) {
  if (agent.isRunning(chat.id)) throw new Error('Agent is already running in this chat')
  const ws = findWs(chat.workspaceId)
  const repo = store.get().repos.find((r) => r.id === ws.repoId)
  if (!ws.named) void nameWorkspace(ws, text)
  const env = agentEnv(ws)
  let extra: Parameters<typeof agent.send>[8]
  if (ws.orchestrator && repo) {
    const scope = scopeFor(ws, repo)
    // The orchestrator's tools only exist on Claude.
    if (chat.model === 'codex') chat.model = 'opus'
    extra = (sdk) => orchestrator.queryOptions(sdk, scope, orchestratorHost, addonHost.toolsets())
  }
  void agent.send(chat, ws, text, env, emitChat, onChatDone, images.slice(0, 10), notifyAsk, extra, opts)
}

/** What an orchestrator directs: its repo, or every repo in its project group. */
function scopeFor(ws: Workspace, repo: Repo): orchestrator.Scope {
  if (!ws.groupId) return orchestrator.repoScope(repo)
  const s = store.get()
  const group = s.groups?.find((g) => g.id === ws.groupId)
  if (!group) throw new Error('This project group was deleted')
  const scope = orchestrator.groupScope(group, s.repos)
  if (!scope.repos.length) throw new Error('Add a repository to this project group first')
  return scope
}

const cloudOut = { onData: (i: string, d: string) => send('pty:data', i, d), onExit: (i: string, c: number) => send('pty:exit', i, c), stateChanged: () => send('state:changed') }

const orchestratorHost: orchestrator.Host = {
  createWorkspace: async (repoId) => {
    const r = await createWorkspace(repoId)
    send('state:changed')
    return r
  },
  sendToChat: (chat, text) => sendToChat(chat, text),
  stopChat: (id) => agent.stop(id),
  archiveWorkspace: async (id) => {
    await archiveWorkspace(id)
    send('state:changed')
  },
  pendingChatIds: () => new Set(agent.pendingPermissions().map((p) => p.chatId)),
  runInCloud: async (chat, ws, task) => {
    await cloud.runInCloud(chat, ws, task, agentEnv(ws), emitChat, cloudOut)
    send('state:changed')
  },
  sendToCloud: (chat, ws, text) => cloud.sendToCloud(chat, ws, text, agentEnv(ws), emitChat),
  prStatus: async (ws) => {
    const pr = await gh.prForBranch(ws.path, ws.branch)
    return { pr, checks: pr ? await gh.checks(ws.path, ws.branch).catch(() => []) : [] }
  }
}

/** What add-on views may ask the app to do; see addonApi.ts for the permission checks in front of it. */
const addonDeps: addonHost.Deps = {
  host: {
    repos: () => store.get().repos,
    workspaces: () => store.get().workspaces,
    chats: () => store.get().chats,
    chatItems: (id) => store.chatItems(id),
    pendingChatIds: () => new Set(agent.pendingPermissions().map((p) => p.chatId)),
    createWorkspace: (repoId) => createWorkspace(repoId),
    sendToChat: (chat, text) => sendToChat(chat, text),
    stopChat: (id) => agent.stop(id),
    prStatus: orchestratorHost.prStatus,
    notify: (title, body, workspaceId) => {
      if (!store.get().settings.notifications || !Notification.isSupported()) return
      const n = new Notification({ title, body })
      n.on('click', () => {
        win?.show()
        win?.focus()
        if (workspaceId) addonDeps.host.openWorkspace(workspaceId)
      })
      n.show()
    },
    openWorkspace: (workspaceId) => {
      const chat = store.get().chats.find((c) => c.workspaceId === workspaceId && !c.review) ?? store.get().chats.find((c) => c.workspaceId === workspaceId)
      if (chat) send('navigate', workspaceId, chat.id)
    },
    saved: () => {
      store.save()
      send('state:changed')
    }
  },
  env: () => {
    const key = store.get().settings.anthropicApiKey.trim()
    return key ? { ANTHROPIC_API_KEY: key } : ({} as Record<string, string>)
  },
  send
}

function orchestratorChat(ws: Workspace, title: string): Chat {
  const s = store.get()
  let chat = s.chats.find((c) => c.workspaceId === ws.id)
  if (!chat) {
    chat = newChat(ws.id)
    chat.title = title
    if (chat.model === 'codex') chat.model = 'opus'
  }
  return chat
}

function newOrchestratorWorkspace(repo: Repo, title: string, groupId?: string): Workspace {
  const ws: Workspace = {
    id: randomUUID(),
    repoId: repo.id,
    name: 'orchestrator',
    branch: repo.defaultBranch,
    baseRef: repo.defaultBranch,
    path: repo.path,
    title,
    named: true,
    orchestrator: true,
    ...(groupId ? { groupId } : {}),
    createdAt: Date.now()
  }
  store.get().workspaces.push(ws)
  return ws
}

async function openOrchestrator(repoId: string) {
  const s = store.get()
  const repo = s.repos.find((r) => r.id === repoId)
  if (!repo) throw new Error('Unknown repo')
  const ws = s.workspaces.find((w) => w.repoId === repoId && w.orchestrator && !w.groupId) ?? newOrchestratorWorkspace(repo, 'Orchestrator')
  ws.archived = false
  const chat = orchestratorChat(ws, 'Orchestrator')
  store.save()
  return { workspace: ws, chat }
}

/** A project group's orchestrator runs in its first repo's checkout and can read the others. */
async function openGroupOrchestrator(groupId: string) {
  const s = store.get()
  const group = s.groups?.find((g) => g.id === groupId)
  if (!group) throw new Error('Unknown project group')
  const repos = orchestrator.groupScope(group, s.repos).repos
  if (!repos.length) throw new Error('Add a repository to this project group first')
  const ws = s.workspaces.find((w) => w.orchestrator && w.groupId === groupId) ?? newOrchestratorWorkspace(repos[0], group.name, groupId)
  ws.repoId = repos[0].id
  ws.path = repos[0].path
  ws.branch = ws.baseRef = repos[0].defaultBranch
  ws.title = group.name
  ws.archived = false
  const chat = orchestratorChat(ws, 'Orchestrator')
  chat.additionalDirectories = repos.slice(1).map((r) => r.path)
  store.save()
  return { workspace: ws, chat }
}

function saveGroup(input: { id?: string; name: string; repoIds: string[] }) {
  const s = store.get()
  const name = String(input?.name ?? '').trim()
  const known = new Set(s.repos.map((r) => r.id))
  const repoIds = [...new Set((input?.repoIds ?? []).filter((id) => known.has(id)))]
  if (!name) throw new Error('Give the project group a name')
  if (!repoIds.length) throw new Error('Pick at least one repository')
  s.groups ??= []
  if (s.groups.some((g) => g.name.toLowerCase() === name.toLowerCase() && g.id !== input.id)) throw new Error(`There is already a project group called ${name}`)
  let group = input.id ? s.groups.find((g) => g.id === input.id) : undefined
  if (input.id && !group) throw new Error('Unknown project group')
  if (!group) {
    group = { id: randomUUID(), name, repoIds, createdAt: Date.now() }
    s.groups.push(group)
  } else {
    group.name = name
    group.repoIds = repoIds
  }
  const orch = s.workspaces.find((w) => w.orchestrator && w.groupId === group.id)
  if (orch) orch.title = name
  store.save()
  return group
}

async function deleteGroup(groupId: string) {
  const s = store.get()
  for (const ws of s.workspaces.filter((w) => w.orchestrator && w.groupId === groupId)) {
    for (const c of s.chats.filter((c) => c.workspaceId === ws.id)) await agent.stop(c.id)
    ws.archived = true
    ws.archivedAt = Date.now()
  }
  s.groups = (s.groups ?? []).filter((g) => g.id !== groupId)
  store.save()
}

/** The orchestrator that started a workspace: its project group's, or its repo's. */
function orchestratorOf(ws: Workspace): Workspace | undefined {
  const all = store.get().workspaces.filter((w) => w.orchestrator && !w.archived)
  if (ws.orchestratorId) {
    const o = all.find((w) => (w.groupId ? w.groupId === ws.orchestratorId : w.repoId === ws.orchestratorId))
    if (o) return o
  }
  return all.find((w) => w.repoId === ws.repoId && !w.groupId)
}

/**
 * Automatic updates: when workspaces an orchestrator started finish, wake it (once its own turn is
 * over) so it checks them and reports back. Capped per stretch without a message from the person,
 * so two agents can't keep each other going forever.
 */
const MAX_AUTO_WAKES = 8
const autoWakes = new Map<string, number>()
const finished = new Map<string, Map<string, { title: string; id: string; state: 'finished' | 'error'; at: number }>>()
const wakeTimers = new Map<string, ReturnType<typeof setTimeout>>()

function noteForOrchestrator(chat: Chat) {
  const ws = store.get().workspaces.find((w) => w.id === chat.workspaceId)
  if (!ws?.orchestrated || ws.orchestrator) return
  const orch = orchestratorOf(ws)
  const orchChat = orch && store.get().chats.find((c) => c.workspaceId === orch.id)
  if (!orchChat) return
  const list = finished.get(orchChat.id) ?? new Map()
  list.set(ws.id, { title: ws.title, id: ws.id, state: chat.status === 'error' ? 'error' : 'finished', at: Date.now() })
  finished.set(orchChat.id, list)
  scheduleWake(orchChat.id)
}

/** Waits a few seconds so workspaces that finish together go out as one update. */
function scheduleWake(orchChatId: string) {
  clearTimeout(wakeTimers.get(orchChatId))
  wakeTimers.set(
    orchChatId,
    setTimeout(() => {
      wakeTimers.delete(orchChatId)
      wakeOrchestrator(orchChatId)
    }, 4000)
  )
}

function wakeOrchestrator(orchChatId: string) {
  const orchChat = store.get().chats.find((c) => c.id === orchChatId)
  const list = finished.get(orchChatId)
  if (!orchChat || !list?.size) return
  // Busy: it may be waiting on these already. Try again when its turn ends.
  if (agent.isRunning(orchChat.id)) return
  finished.delete(orchChatId)
  // Skip what the orchestrator already looked at after it finished.
  const fresh = [...list.values()].filter((d) => orchestrator.seenAt(d.id) < d.at)
  if (!fresh.length) return
  const wakes = autoWakes.get(orchChatId) ?? 0
  if (store.get().settings.orchestratorAutoUpdates && wakes < MAX_AUTO_WAKES && !orchChat.remote) {
    autoWakes.set(orchChatId, wakes + 1)
    try {
      sendToChat(orchChat, orchestrator.autoUpdatePrompt(fresh))
      return
    } catch {
      /* fall through to a note */
    }
  }
  const names = fresh.map((d) => `${d.title} ${d.state === 'error' ? 'hit an error' : 'finished'}`).join('; ')
  const paused = store.get().settings.orchestratorAutoUpdates && wakes >= MAX_AUTO_WAKES ? ' (automatic updates paused until you send a message)' : ''
  const item = { id: randomUUID(), kind: 'note' as const, text: `${names}. Ask me to check on it${paused}.`, ts: Date.now() }
  store.upsertItem(orchChat.id, item)
  orchChat.unread = true
  store.save()
  emitChat(orchChat.id, { item, chat: orchChat })
}

function onChatDone(chat: Chat) {
  const next = afterTurn.get(chat.id)?.shift()
  if (next) {
    // Let the finished turn wind down (the advisor may still run) before sending what waited.
    setTimeout(() => {
      try {
        sendFromPerson(chat, next.text, next.images)
      } catch (e) {
        emitChat(chat.id, { item: { id: randomUUID(), kind: 'error', text: (e as Error).message, ts: Date.now() } })
      }
    }, 0)
  }
  notifyDone(chat)
  noteForOrchestrator(chat)
  if (finished.has(chat.id)) scheduleWake(chat.id)
  const ws = store.get().workspaces.find((w) => w.id === chat.workspaceId)
  if (ws) autoSync(ws)
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

async function archiveWorkspace(id: string) {
  const ws = findWs(id)
  for (const c of store.get().chats.filter((c) => c.workspaceId === id)) {
    await agent.stop(c.id)
    await remote.bringBack(c, ws, emitChat)
  }
  if (ws.orchestrator) {
    // Lives in the main checkout: never remove that.
    ws.archived = true
    ws.archivedAt = Date.now()
    return store.save()
  }
  const repo = store.get().repos.find((r) => r.id === ws.repoId)
  pty.killPrefix(`${id}:`)
  const archiveCmd = scriptsFor(ws).archive
  if (archiveCmd) {
    const { execFile } = await import('node:child_process')
    await new Promise<void>((resolve) =>
      execFile(process.env.SHELL || '/bin/zsh', ['-lc', archiveCmd], { cwd: ws.path, env: { ...process.env, ...workspaceEnv(ws) }, timeout: 120_000 }, () => resolve())
    )
  }
  if (repo) await archive.stashWorktree(ws)
  ws.archived = true
  ws.archivedAt = Date.now()
  store.save()
}

/** Folders a workspace occupies on disk (never the main checkout, which an orchestrator uses). */
function workspaceFolders(ws: Workspace, repo: Repo | undefined): string[] {
  return [ws.path, ws.archivePath].filter((p): p is string => !!p && p !== repo?.path && existsSync(p))
}

/** Removes a worktree folder through git when it can, then deletes whatever is left. Refuses the repo itself. */
async function deleteFolder(repoPath: string, path: string) {
  if (resolve(path) === resolve(repoPath)) return
  if (existsSync(repoPath)) await git.removeWorktree(repoPath, path)
  rmSync(path, { recursive: true, force: true })
}

async function stopWorkspace(ws: Workspace) {
  for (const c of store.get().chats.filter((c) => c.workspaceId === ws.id)) await agent.stop(c.id)
  pty.killPrefix(`${ws.id}:`)
}

function forgetWorkspace(ws: Workspace) {
  const s = store.get()
  for (const c of s.chats.filter((c) => c.workspaceId === ws.id)) store.deleteChatItems(c.id)
  s.chats = s.chats.filter((c) => c.workspaceId !== ws.id)
  s.workspaces = s.workspaces.filter((w) => w.id !== ws.id)
}

async function deleteWorkspace(id: string) {
  const ws = findWs(id)
  const repo = store.get().repos.find((r) => r.id === ws.repoId)
  await stopWorkspace(ws)
  for (const p of workspaceFolders(ws, repo)) await deleteFolder(repo?.path ?? '', p)
  forgetWorkspace(ws)
  store.save()
  send('state:changed')
}

async function removeProject(id: string, opts: { deleteFiles: boolean }) {
  const s = store.get()
  const repo = s.repos.find((r) => r.id === id)
  if (!repo) return
  const wss = s.workspaces.filter((w) => w.repoId === id)
  const kept: string[] = []
  for (const ws of wss) {
    await stopWorkspace(ws)
    const folders = workspaceFolders(ws, repo)
    if (opts.deleteFiles) for (const p of folders) await deleteFolder(repo.path, p)
    else kept.push(...folders)
    forgetWorkspace(ws)
  }
  if (kept.length) s.leftovers = [...(s.leftovers ?? []), { id: randomUUID(), repoName: repo.name, repoPath: repo.path, paths: kept, removedAt: Date.now() }]
  s.repos = s.repos.filter((r) => r.id !== id)
  for (const g of s.groups ?? []) g.repoIds = g.repoIds.filter((r) => r !== id)
  store.save()
  send('state:changed')
}

/** Env for Claude agents: workspace vars, the API key, and OpenTelemetry export if it's on. */
function agentEnv(ws: Workspace): Record<string, string> {
  const settings = store.get().settings
  const repo = store.get().repos.find((r) => r.id === ws.repoId)
  const env = { ...workspaceEnv(ws), ...telemetryEnv(settings.telemetry, { 'choo.repo': repo?.name ?? '', 'choo.workspace': ws.name, 'choo.branch': ws.branch }) }
  const key = settings.anthropicApiKey.trim()
  if (key) env.ANTHROPIC_API_KEY = key
  return env
}

function registerIpc() {
  const h = (ch: string, fn: (...a: any[]) => unknown) => ipcMain.handle(ch, (_e, ...a) => fn(...a))

  h('state:get', () => {
    const s = store.get()
    // Drop recent folders that were deleted since.
    if (s.recentPaths?.some((p) => !existsSync(p))) s.recentPaths = s.recentPaths.filter((p) => existsSync(p))
    return s
  })
  h('repo:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], message: 'Choose a git repository' })
    if (r.canceled || !r.filePaths[0]) return null
    return addRepo(r.filePaths[0])
  })
  h('repo:add', (p: string) => addRepo(p))
  h('repo:remove', (id: string) => removeProject(id, { deleteFiles: false }))
  h('repo:removeProject', (id: string, opts: { deleteFiles: boolean }) => removeProject(id, opts))
  h('ws:delete', (id: string) => deleteWorkspace(id))
  h('leftover:delete', async (id: string) => {
    const s = store.get()
    const l = s.leftovers?.find((x) => x.id === id)
    if (!l) return
    for (const p of l.paths) await deleteFolder(l.repoPath, p)
    s.leftovers = s.leftovers!.filter((x) => x.id !== id)
    store.save()
  })
  h('repo:reorder', (ids: string[]) => {
    const s = store.get()
    const pos = new Map(ids.map((id, i) => [id, i]))
    s.repos = [...s.repos].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity))
    store.save()
  })
  h('repo:hidden', (id: string, hidden: boolean) => {
    const r = store.get().repos.find((x) => x.id === id)
    if (r) r.hidden = hidden
    store.save()
  })
  h('repo:prompt', (id: string, prompt: PromptCustom | undefined) => {
    const r = store.get().repos.find((x) => x.id === id)
    if (r) r.systemPrompt = prompt?.text.trim() ? prompt : undefined
    store.save()
  })
  h('repo:base', (id: string, branch: string) => {
    const r = store.get().repos.find((x) => x.id === id)
    if (r && branch.trim()) r.defaultBranch = branch.trim()
    store.save()
  })
  h('ws:create', (repoId: string, source?: WorkspaceSource, folders?: string[]) => createWorkspace(repoId, source, folders))
  h('files:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], message: 'Give the agent these files' })
    return r.canceled ? [] : r.filePaths
  })
  registerIntegrationsIpc(() => send('state:changed'))
  h('ws:sources', (repoId: string, kind: WorkspaceSource['kind'], query: string) => listSources(repoId, kind, query))
  h('ws:archive', (id: string) => archiveWorkspace(id))
  h('ws:orchestrator', (repoId: string) => openOrchestrator(repoId))
  h('group:orchestrator', (groupId: string) => openGroupOrchestrator(groupId))
  h('group:save', (g: { id?: string; name: string; repoIds: string[] }) => saveGroup(g))
  h('group:delete', (groupId: string) => deleteGroup(groupId))
  h('ws:restore', async (id: string) => {
    const ws = findWs(id)
    if (ws.orchestrator) {
      ws.archived = false
      return store.save()
    }
    const repo = store.get().repos.find((r) => r.id === ws.repoId)
    if (!repo) throw new Error('The repository for this workspace was removed')
    if (existsSync(ws.path)) throw new Error(`${ws.path} already exists`)
    if (!(await archive.unstashWorktree(ws))) {
      mkdirSync(join(ws.path, '..'), { recursive: true })
      await git.addWorktreeForBranch(repo.path, ws.path, ws.branch)
    }
    ws.archived = false
    store.save()
    runScript(ws, 'setup')
  })
  h('ws:preview', (id: string) => archive.preview(findWs(id)))
  h('ws:activity', () => archive.activity())
  h('ws:grep', (id: string, q: string) => git.grep(findWs(id).path, q))
  h('archive:cleanup', () => archive.cleanupArchives())
  h('ws:rename', (id: string, title: string) => {
    const t = title.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!t) return
    const ws = findWs(id)
    ws.title = t
    // A name the person chose isn't replaced by the first-prompt naming.
    ws.named = true
    store.save()
    send('state:changed')
  })
  h('ws:regenerateName', async (id: string) => {
    const ws = findWs(id)
    const chats = store.get().chats.filter((c) => c.workspaceId === id).map((c) => store.chatItems(c.id))
    const title = await suggestTitleFromChats(chats)
    if (!title) throw new Error('Nothing to name this workspace from yet. Send a message first, or rename it yourself.')
    ws.title = title
    ws.named = true
    store.save()
    send('state:changed')
    return title
  })
  h('ws:reorder', (ids: string[]) => {
    const all = store.get().workspaces
    ids.forEach((id, i) => {
      const ws = all.find((w) => w.id === id)
      if (ws) ws.order = i
    })
    store.save()
  })
  h('chat:create', (wsId: string) => newChat(wsId))
  h('chat:close', async (id: string) => {
    await agent.stop(id)
    const closing = store.get().chats.find((c) => c.id === id)
    if (closing) {
      pty.kill(remote.phoneTerminalId(closing))
      pty.kill(cloud.cloudTerminalId(closing))
    }
    const s = store.get()
    s.chats = s.chats.filter((c) => c.id !== id)
    store.deleteChatItems(id)
    store.save()
  })
  h('chat:items', (id: string) => store.chatItems(id))
  h('chat:usage', (id: string) => {
    const chat = findChat(id)
    if (chat.model === 'codex') return { points: [], compactions: [], contextWindow: 0, empty: 'Usage graphs are for Claude chats. Codex keeps its own transcript.' }
    // Claude Code reports a running total, so the last turn's cost covers the session.
    const last = [...store.chatItems(id)].reverse().find((x) => x.kind === 'result' && x.costUsd != null)
    return sessionUsage(chat.sdkSessionId, { contextWindow: chat.contextWindow, costUsd: last?.kind === 'result' ? last.costUsd : undefined })
  })
  h('chat:update', (id: string, patch: Partial<Chat>) => {
    const c = findChat(id)
    if (patch.model) c.model = patch.model
    if (patch.effort) c.effort = patch.effort
    if (patch.title) c.title = patch.title
    if (patch.unread !== undefined) c.unread = patch.unread
    if (patch.planMode !== undefined) c.planMode = patch.planMode
    if (patch.review !== undefined) c.review = patch.review
    if (patch.reviewKind) c.reviewKind = patch.reviewKind
    if (patch.advisor !== undefined) c.advisor = patch.advisor
    if (patch.advisorBlocker !== undefined) c.advisorBlocker = patch.advisorBlocker
    if (patch.permission) c.permission = patch.permission
    if (patch.fast !== undefined) c.fast = patch.fast || undefined
    if (patch.budgetUsd !== undefined) c.budgetUsd = Math.max(0, Number(patch.budgetUsd) || 0)
    if (patch.outputStyle !== undefined) c.outputStyle = patch.outputStyle || undefined
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
  h('pr:comments', async (id: string) => {
    const ws = findWs(id)
    const pr = await gh.prForBranch(ws.path, ws.branch)
    return pr ? gh.prComments(ws.path, pr.number) : []
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
    s.settings.extras = normalizeExtras(s.settings.extras)
    s.settings.telemetry = normalizeTelemetry(s.settings.telemetry)
    store.save()
    if ('theme' in patch) applyNativeTheme(s.settings)
    if ('archiveRetentionDays' in patch) void archive.cleanupArchives()
    updates.onSettingsChanged(Object.keys(patch))
    return s.settings
  })
  h('folder:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  h('repo:clone', async (url: string, dir?: string) => {
    url = url.trim()
    const root = dir?.trim() ? resolve(dir.trim().replace(/^~(?=$|\/)/, homedir())) : REPOS_ROOT
    // owner/repo shorthand (or a github.com URL) clones through gh, so private repos use the gh login.
    const gh_ = url.match(/^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1]
    if (!gh_ && !/^(https:\/\/|git@|ssh:\/\/)/.test(url)) throw new Error('Enter owner/repo, or an https or ssh git URL')
    mkdirSync(root, { recursive: true })
    let dest = join(root, git.repoNameFromUrl(url))
    for (let n = 2; existsSync(dest); n++) dest = join(root, `${git.repoNameFromUrl(url)}-${n}`)
    if (gh_) await gh.cloneRepo(gh_, dest)
    else await git.clone(url, dest)
    return addRepo(dest)
  })
  h('gh:repos', () => gh.listMyRepos())
  h('prs:inbox', () => loadPrInbox())
  h('models:details', () => modelDetails())
  h('conductor:preview', () => previewConductor())
  h('conductor:import', (opts: { useWorkspacesRoot: boolean }) => importConductor(opts))
  h('repo:quickstart', async (name: string) => {
    const slug = name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug) throw new Error('Enter a project name')
    const dest = join(REPOS_ROOT, slug)
    if (existsSync(dest)) throw new Error(`${dest} already exists`)
    mkdirSync(REPOS_ROOT, { recursive: true })
    await git.initRepo(dest)
    return addRepo(dest)
  })
  h('pr:merge', async (id: string) => {
    const ws = findWs(id)
    const pr = await gh.prForBranch(ws.path, ws.branch)
    if (!pr) throw new Error('No pull request for this branch')
    await gh.mergePr(ws.path, pr.number)
  })
  h('pr:ready', async (id: string) => {
    const ws = findWs(id)
    const pr = await gh.prForBranch(ws.path, ws.branch)
    if (!pr) throw new Error('No pull request for this branch')
    await gh.markPrReady(ws.path, pr.number)
  })
  h('chat:send', (id: string, text: string, images: string[] = []) => {
    // The person wrote, so the orchestrator may wake itself again.
    autoWakes.delete(id)
    return sendFromPerson(findChat(id), text, images)
  })
  h('reflect:run', (wsId: string, feedback = '') => {
    const ws = findWs(wsId)
    const repo = store.get().repos.find((r) => r.id === ws.repoId)
    if (!repo) throw new Error('The repository for this workspace was removed')
    const model = store.get().settings.defaultModel
    return reflection.reflect(ws, repo, agentEnv(ws), model === 'codex' ? 'opus' : model, typeof feedback === 'string' ? feedback : '')
  })
  h('reflect:cancel', (wsId: string) => reflection.cancel(wsId))
  h('reflect:apply', async (wsId: string, proposals: ReflectProposal[]) => {
    const source = findWs(wsId)
    const repo = store.get().repos.find((r) => r.id === source.repoId)
    if (!repo) throw new Error('The repository for this workspace was removed')
    if (!proposals.length) throw new Error('No changes to apply')
    const { workspace, chat } = await createWorkspace(repo.id)
    for (const p of proposals) {
      if (!isReflectTarget(p.file)) throw new Error(`Not an agent setup file: ${p.file}`)
      const abs = insideWorkspace(workspace, p.file)
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, p.after)
    }
    workspace.title = 'Improve agent setup'
    workspace.named = true
    store.save()
    sendToChat(chat, reflection.applyPrompt(source, proposals, repo.defaultBranch, workspace.branch))
    return { workspace, chat }
  })
  h('advisor:act', (chatId: string, itemId: string, action: 'send' | 'dismiss') => {
    const chat = findChat(chatId)
    if (action === 'send' && agent.isRunning(chat.id)) throw new Error('Wait for the agent to finish first')
    const { item, message } = agent.resolveAdvice(chat, itemId, action)
    emitChat(chatId, { item, chat })
    // A plan review is sent because the user clicked "Revise the plan", so it reads as their message.
    if (message) sendToChat(chat, message, [], { fromAdvisor: item.kind === 'advisor' && item.source !== 'planReview' })
  })
  h('plan:review', (chatId: string, planItemId: string) => {
    const chat = findChat(chatId)
    const ws = findWs(chat.workspaceId)
    const env = workspaceEnv(ws)
    const key = store.get().settings.anthropicApiKey.trim()
    if (key) env.ANTHROPIC_API_KEY = key
    return agent.reviewPlan(chat, ws, planItemId, env, emitChat)
  })
  h('chat:stop', (id: string) => agent.stop(id))
  h('chat:stopTask', (id: string, taskId: string) => agent.stopTask(id, taskId))
  h('chat:outputStyles', (wsId: string) => listOutputStyles(findWs(wsId).path))
  // MCP servers, managed through Claude Code itself in the repo's main checkout.
  const mcpRepo = (repoId: string) => {
    const repo = store.get().repos.find((r) => r.id === repoId)
    if (!repo) throw new Error('Repository not found')
    const key = store.get().settings.anthropicApiKey.trim()
    return { cwd: repo.path, env: key ? { ANTHROPIC_API_KEY: key } : ({} as Record<string, string>) }
  }
  h('mcp:status', (repoId: string) => {
    const r = mcpRepo(repoId)
    return mcp.status(r.cwd, r.env)
  })
  h('mcp:add', (repoId: string, spec) => {
    const r = mcpRepo(repoId)
    return mcp.add(r.cwd, r.env, spec)
  })
  h('mcp:remove', (repoId: string, name: string, scope: string) => {
    const r = mcpRepo(repoId)
    return mcp.remove(r.cwd, r.env, name, scope)
  })
  h('mcp:toggle', (repoId: string, name: string, enabled: boolean) => {
    const r = mcpRepo(repoId)
    return mcp.toggle(r.cwd, r.env, name, !!enabled)
  })
  h('mcp:reconnect', (repoId: string, name: string) => {
    const r = mcpRepo(repoId)
    return mcp.reconnect(r.cwd, r.env, name)
  })
  h('mcp:signIn', (repoId: string) => mcp.openSignIn(mcpRepo(repoId).cwd))
  // Plugins and skills, through `claude plugin …`.
  const pr = (repoId: string) => mcpRepo(repoId)
  h('plugins:installed', (repoId: string) => plugins.installed(pr(repoId).cwd, pr(repoId).env))
  h('plugins:available', (repoId: string, fresh?: boolean) => plugins.available(pr(repoId).cwd, pr(repoId).env, !!fresh))
  h('plugins:marketplaces', (repoId: string) => plugins.marketplaces(pr(repoId).cwd, pr(repoId).env))
  h('plugins:addMarketplace', (repoId: string, source: string) => plugins.addMarketplace(pr(repoId).cwd, pr(repoId).env, String(source)))
  h('plugins:removeMarketplace', (repoId: string, name: string) => plugins.removeMarketplace(pr(repoId).cwd, pr(repoId).env, String(name)))
  h('plugins:install', (repoId: string, id: string, scope: string, acceptSha?: string) => plugins.install(pr(repoId).cwd, pr(repoId).env, String(id), String(scope), acceptSha))
  h('plugins:uninstall', (repoId: string, id: string, scope: string) => plugins.uninstall(pr(repoId).cwd, pr(repoId).env, String(id), String(scope)))
  h('plugins:setEnabled', (repoId: string, id: string, enabled: boolean, scope: string) => plugins.setEnabled(pr(repoId).cwd, pr(repoId).env, String(id), !!enabled, String(scope)))
  h('plugins:details', (repoId: string, id: string) => plugins.details(pr(repoId).cwd, pr(repoId).env, String(id)))
  h('plugins:localSkills', (repoId: string) => plugins.localSkills(pr(repoId).cwd))
  h('shell:reveal', (p: string) => {
    // Only Claude Code's own folder, a repo or a workspace, so a renderer can't point Finder anywhere.
    if (typeof p !== 'string' || !isAbsolute(p) || !existsSync(p)) return
    const st = store.get()
    const roots = [join(homedir(), '.claude'), ...st.repos.map((r) => r.path), ...st.workspaces.map((w) => w.path)]
    const inside = (root: string) => {
      const rel = relative(root, resolve(p))
      return !rel.startsWith('..') && !isAbsolute(rel)
    }
    if (roots.some(inside)) shell.showItemInFolder(p)
  })
  h('chat:phone', (id: string) => {
    const chat = findChat(id)
    const ws = findWs(chat.workspaceId)
    return remote.continueOnPhone(chat, ws, agentEnv(ws), emitChat, (i, c) => send('pty:exit', i, c), (i, d) => send('pty:data', i, d))
  })
  h('chat:cloud', (id: string, task: string) => {
    const chat = findChat(id)
    const ws = findWs(chat.workspaceId)
    return cloud.runInCloud(chat, ws, typeof task === 'string' ? task : '', agentEnv(ws), emitChat, cloudOut)
  })
  h('chat:cloudSend', (id: string, text: string) => {
    const chat = findChat(id)
    const ws = findWs(chat.workspaceId)
    return cloud.sendToCloud(chat, ws, String(text ?? ''), agentEnv(ws), emitChat)
  })
  h('chat:cloudBack', (id: string) => {
    const chat = findChat(id)
    const ws = findWs(chat.workspaceId)
    return cloud.teleportBack(chat, ws, agentEnv(ws), emitChat, cloudOut)
  })
  h('chat:cloudForget', (id: string) => cloud.forgetCloud(findChat(id), emitChat))
  h('chat:phoneBack', (id: string) => {
    const chat = findChat(id)
    return remote.bringBack(chat, findWs(chat.workspaceId), emitChat)
  })
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
  h('updates:status', () => updates.getStatus())
  h('updates:check', (which?: 'app' | 'claude' | 'all') => updates.checkNowFor(which))
  h('updates:install-app', () => updates.installAppUpdate())
  h('updates:update-claude', () => updates.updateClaude())
  h('shell:open', (url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
}

function buildMenu() {
  const m = (action: string) => () => send('menu', action)
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => void updates.checkNow(win) },
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
        { label: 'Go to File…', accelerator: 'CmdOrCtrl+P', click: m('file-picker') },
        { label: 'Search in Files…', accelerator: 'CmdOrCtrl+Shift+F', click: m('search-files') },
        { label: 'Open Shared Session…', click: m('open-share') },
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

/** Match native chrome (menus, window background) to the chosen theme. */
function applyNativeTheme(settings: Settings) {
  nativeTheme.themeSource = settings.theme === 'system' ? 'system' : resolveTheme(settings.theme, true).dark ? 'dark' : 'light'
  win?.setBackgroundColor(windowBackground(settings))
}

function windowBackground(settings: Settings) {
  return resolveTheme(settings.theme, nativeTheme.shouldUseDarkColors).tokens.bg
}

/**
 * Web links open in the default browser, never inside the app: new-window links (target=_blank)
 * and plain links that would navigate the window away from the app alike.
 */
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    const appUrl = process.env.ELECTRON_RENDERER_URL
    if (appUrl && url.startsWith(appUrl)) return // dev-server reloads
    if (url.startsWith('file://')) return
    e.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
})

function createWindow() {
  applyNativeTheme(store.get().settings)
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: windowBackground(store.get().settings),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  // window-all-closed never fires while add-ons' unseen background window is open, so quit from here.
  win.on('closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  win.webContents.on('did-finish-load', () => {
    if (pendingLink) send('share:link', pendingLink)
    pendingLink = null
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

// choo-choo://share links open the shared session. macOS can deliver one before the window exists.
let pendingLink: string | null = null
function openLink(url: string) {
  if (!url.startsWith('choo-choo://')) return
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    send('share:link', url)
    win.show()
    win.focus()
  } else pendingLink = url
}
app.on('open-url', (e, url) => {
  e.preventDefault()
  openLink(url)
})
if (process.defaultApp) {
  if (process.argv[1]) app.setAsDefaultProtocolClient('choo-choo', process.execPath, [resolve(process.argv[1])])
} else app.setAsDefaultProtocolClient('choo-choo')

addonHost.registerScheme()

// Name the app explicitly so the menu bar and About panel say Choo Choo, not Electron, in dev too.
app.setName('Choo Choo')
app.setAboutPanelOptions({ applicationName: 'Choo Choo', applicationVersion: app.getVersion() })

app.whenReady().then(async () => {
  await fixPath()
  // Packaged builds get the icon from the .icns; in dev, show the brand icon in the Dock too.
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(join(app.getAppPath(), 'resources/icon.png'))
  store.load()
  // Projects added before avatars existed: look up their GitHub owner once.
  void Promise.all(store.get().repos.filter((r) => r.githubOwner === undefined).map(async (r) => (r.githubOwner = existsSync(r.path) ? await git.githubOwner(r.path) : ''))).then(() => {
    store.save()
    send('state:changed')
  })
  registerIpc()
  addonHost.start(addonDeps)
  cloud.recoverAfterRestart()
  void remote.recoverAfterRestart((id) => store.get().workspaces.find((w) => w.id === id), emitChat)
  archive.startArchiveCleanup()
  registerShareIpc({
    workspacesRoot: WORKSPACES_ROOT,
    reposRoot: REPOS_ROOT,
    findWs,
    addRepo,
    newChat,
    runSetup: (ws) => void runScript(ws, 'setup'),
    notifyChanged: () => send('state:changed')
  })
  registerDevFeedback(() => win)
  buildMenu()
  createWindow()
  updates.startUpdater(send)
  // PR and check changes: cheap ETag probes, and the UI refetches only when one reports a change.
  const prWatch = startPrWatch({
    targets: () => {
      const s = store.get()
      return s.workspaces
        .filter((w) => !w.archived && !w.orchestrator)
        .flatMap((w) => {
          const repo = s.repos.find((r) => r.id === w.repoId)
          return repo?.githubOwner && w.branch !== repo.defaultBranch ? [{ id: w.id, path: w.path, branch: w.branch }] : []
        })
    },
    focused: () => !!win?.isFocused(),
    onChange: (wsId) => send('pr:changed', wsId)
  })
  app.on('browser-window-focus', () => prWatch.poke())
  app.on('activate', () => {
    // The unseen window that hosts add-ons' background pages doesn't count as the app being open.
    if (!win || win.isDestroyed()) createWindow()
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
