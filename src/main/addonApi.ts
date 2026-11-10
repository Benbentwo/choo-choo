/**
 * The host API add-on views call through `window.choo`. Every call lands in `call()`, which checks
 * the add-on's granted permissions before doing anything. No Electron imports here: what it needs
 * from the app comes in through `AddonHost`, so it can be tested on its own.
 */
import { randomUUID } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { z } from 'zod'
import type { Chat, ChatItem, CheckRun, PrInfo, Repo, Workspace } from '@shared/types'
import { ACTIONS_PERMISSION, ADDON_API_VERSION, actionTarget, checkCall, safeRelativePath, type AddonActionContext, type AddonActionPress, type AddonContext, type AddonManifest, type AddonWorkspace } from '@shared/addons'
import { summarizeChecks } from '@shared/prStatus'

export interface AddonHost {
  repos(): Repo[]
  workspaces(): Workspace[]
  chats(): Chat[]
  chatItems(chatId: string): ChatItem[]
  /** Chats waiting for the person to approve a tool call. */
  pendingChatIds(): Set<string>
  /** A new workspace on a fresh branch, or on a pull request's own branch when `source` names one. */
  createWorkspace(repoId: string, source?: { kind: 'pr'; number: number }): Promise<{ workspace: Workspace; chat: Chat }>
  /** Starts a turn in a chat. Throws if the chat is busy. */
  sendToChat(chat: Chat, text: string): void
  stopChat(chatId: string): Promise<void>
  prStatus(ws: Workspace): Promise<{ pr: PrInfo | null; checks: CheckRun[] }>
  /** A pull request of the project by its number, whether or not a workspace is on it. */
  prByNumber(repo: Repo, number: number): Promise<{ pr: PrInfo | null; checks: CheckRun[] }>
  notify(title: string, body: string, workspaceId?: string): void
  openWorkspace(workspaceId: string): void
  /** Persist state changed by a call and tell the window. */
  saved(): void
  /** An add-on changed its own data: tell its other pages. */
  storeChanged?(addonKey: string, key: string): void
  appVersion(): string
  /** Folder for add-ons' own data, one JSON file each. */
  storageDir(): string
}

/** The add-on making a call, as the app knows it (never as the view describes itself). */
export interface Caller {
  id: string
  key: string
  name: string
  granted: string[]
}

/** A runaway add-on can't start agents without end: at most this many of its workspaces run at once. */
export const MAX_RUNNING_PER_ADDON = 8
export const STORAGE_LIMIT = 1024 * 1024

/** The one folder of a project add-ons may read and write, in its main checkout. */
export const PROJECT_DIR = '.choo-choo'
export const FILE_LIMIT = 1024 * 1024
/** Text only: nothing an add-on writes there can be a script or a binary. */
const FILE_TYPES = ['.md', '.json', '.txt', '.yaml', '.yml']
const LIST_LIMIT = 500

const MODELS = ['opus', 'fable', 'sonnet', 'haiku', 'codex'] as const

const schemas = {
  'app.info': z.object({}).optional(),
  'repos.list': z.object({}).optional(),
  'workspaces.list': z.object({ repoId: z.string().optional() }).optional(),
  'workspaces.read': z.object({ workspaceId: z.string(), last: z.number().int().min(1).max(200).optional() }),
  'workspaces.start': z.object({ repoId: z.string(), task: z.string().min(1).max(100_000), title: z.string().max(80).optional(), model: z.enum(MODELS).optional(), planFirst: z.boolean().optional() }),
  'workspaces.message': z.object({ workspaceId: z.string(), message: z.string().min(1).max(100_000) }),
  'workspaces.stop': z.object({ workspaceId: z.string() }),
  'workspaces.forPr': z.object({ repoId: z.string(), number: z.number().int().min(1) }),
  'prs.status': z.object({ workspaceId: z.string() }),
  'prs.get': z.object({ repoId: z.string(), number: z.number().int().min(1) }),
  'files.list': z.object({ repoId: z.string(), dir: z.string().max(300).optional(), workspaceId: z.string().optional() }),
  'files.read': z.object({ repoId: z.string(), path: z.string().min(1).max(300), workspaceId: z.string().optional() }),
  'files.write': z.object({ repoId: z.string(), path: z.string().min(1).max(300), content: z.string() }),
  'files.delete': z.object({ repoId: z.string(), path: z.string().min(1).max(300) }),
  'store.get': z.object({ key: z.string().min(1).max(128) }),
  'store.set': z.object({ key: z.string().min(1).max(128), value: z.unknown() }),
  'store.delete': z.object({ key: z.string().min(1).max(128) }),
  'store.keys': z.object({}).optional(),
  'ui.openWorkspace': z.object({ workspaceId: z.string() }),
  'ui.notify': z.object({ title: z.string().min(1).max(80), body: z.string().max(240).optional(), workspaceId: z.string().optional() })
} as const

type Method = keyof typeof schemas

function clip(s: string, n: number) {
  s = s.trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function statusOf(chats: Chat[], pending: Set<string>): AddonWorkspace['status'] {
  if (chats.some((c) => pending.has(c.id))) return 'needs-approval'
  if (chats.some((c) => c.status === 'running')) return 'running'
  if (chats.some((c) => c.remote?.kind === 'cloud')) return 'in-cloud'
  if (chats.some((c) => c.status === 'error')) return 'error'
  return 'idle'
}

function lastAssistantText(items: ChatItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'assistant' && it.text) return it.text
  }
  return ''
}

/**
 * What to tell an add-on's background page about a press, or null when there is nothing to tell:
 * the add-on has no such button, the button opens a view, or the place it names doesn't exist.
 * Only ids of a live project and a workspace of it are passed on.
 */
export function backgroundPress(addon: { manifest?: AddonManifest }, actionId: string, ctx: AddonActionContext, host: Pick<AddonHost, 'repos' | 'workspaces'>): AddonActionPress | null {
  const m = addon.manifest
  const action = m?.permissions.includes(ACTIONS_PERMISSION) ? m.actions?.find((a) => a.id === actionId) : undefined
  if (!m || !action || actionTarget(m, action, ctx)?.to !== 'background') return null
  const ws = ctx.workspaceId ? host.workspaces().find((w) => w.id === ctx.workspaceId && !w.archived && !w.orchestrator) : undefined
  const repo = host.repos().find((r) => r.id === (ws?.repoId ?? ctx.repoId))
  if ((ctx.workspaceId && !ws) || (ctx.repoId && !repo) || (ws && ctx.repoId && ws.repoId !== ctx.repoId)) return null
  const needsWorkspace = action.place === 'workspace-header' || action.place === 'workspace-row'
  if ((needsWorkspace && !ws) || (action.place === 'project-row' && !repo)) return null
  return { id: action.id, place: action.place, ...(repo ? { repoId: repo.id } : {}), ...(ws ? { workspaceId: ws.id } : {}) }
}

/** A workspace an add-on may see or act on: live, and not an orchestrator's own chat. */
function findWorkspace(host: AddonHost, id: string): Workspace {
  const ws = host.workspaces().find((w) => w.id === id && !w.archived && !w.orchestrator)
  if (!ws) throw new Error(`No workspace ${id}`)
  return ws
}

const chatsOf = (host: AddonHost, wsId: string) => host.chats().filter((c) => c.workspaceId === wsId)

function mainChat(host: AddonHost, ws: Workspace): Chat {
  const chats = chatsOf(host, ws.id)
  const chat = chats.find((c) => !c.review) ?? chats[0]
  if (!chat) throw new Error(`Workspace ${ws.title} has no chat`)
  return chat
}

function describe(host: AddonHost, ws: Workspace, pending: Set<string>): AddonWorkspace {
  const chats = chatsOf(host, ws.id)
  const main = chats.find((c) => !c.review) ?? chats[0]
  return {
    id: ws.id,
    repoId: ws.repoId,
    title: ws.title,
    branch: ws.branch,
    status: statusOf(chats, pending),
    unread: chats.some((c) => c.unread),
    orchestrated: !!ws.orchestrated,
    ...(ws.addonId ? { startedBy: ws.addonId } : {}),
    createdAt: ws.createdAt,
    lastMessage: main ? clip(lastAssistantText(host.chatItems(main.id)), 600) : ''
  }
}

/** The transcript as entries a view can render: messages, one line per tool call, and turn ends. */
export function transcriptEntries(items: ChatItem[], last: number) {
  const out: { kind: 'user' | 'assistant' | 'tool' | 'error' | 'note' | 'turn-end'; text: string; ts: number; ok?: boolean }[] = []
  for (const it of items.slice(-last)) {
    if (it.kind === 'user') out.push({ kind: 'user', text: clip(it.text, 4000), ts: it.ts })
    else if (it.kind === 'assistant') out.push({ kind: 'assistant', text: clip(it.text, 8000), ts: it.ts })
    else if (it.kind === 'tool') out.push({ kind: 'tool', text: `${it.name}: ${clip(JSON.stringify(it.input ?? {}), 200)}`, ts: it.ts, ok: !it.isError })
    else if (it.kind === 'error') out.push({ kind: 'error', text: it.text, ts: it.ts })
    else if (it.kind === 'note') out.push({ kind: 'note', text: it.text, ts: it.ts })
    else if (it.kind === 'result') out.push({ kind: 'turn-end', text: it.ok ? 'finished' : 'failed', ts: it.ts, ok: it.ok })
  }
  return out
}

function storageFile(host: AddonHost, caller: Caller) {
  return join(host.storageDir(), `${caller.key}.json`)
}

function readStorage(host: AddonHost, caller: Caller): Record<string, unknown> {
  const f = storageFile(host, caller)
  if (!existsSync(f)) return {}
  try {
    const data = JSON.parse(readFileSync(f, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

function writeStorage(host: AddonHost, caller: Caller, data: Record<string, unknown>) {
  const text = JSON.stringify(data)
  if (Buffer.byteLength(text) > STORAGE_LIMIT) throw new Error('This add-on is over its 1 MB of storage. Delete some keys first.')
  mkdirSync(host.storageDir(), { recursive: true })
  const f = storageFile(host, caller)
  writeFileSync(`${f}.tmp`, text)
  renameSync(`${f}.tmp`, f)
}

const okSegments = (p: string) => safeRelativePath(p) && p.split('/').every((seg) => !seg.startsWith('.'))

/** A project an add-on may name: one the person hasn't hidden. */
function findRepo(host: AddonHost, repoId: string): Repo {
  const repo = host.repos().find((r) => r.id === repoId && !r.hidden)
  if (!repo) throw new Error(`No project ${repoId}`)
  return repo
}

/**
 * The absolute path for `rel` inside a project's `.choo-choo` folder: the one in its main checkout,
 * or the one in a workspace's worktree when `workspaceId` names a workspace of that project.
 * Refuses anything that could land elsewhere: odd paths, dotfiles, and any symlink in the part of
 * the path that already exists.
 */
function projectPath(host: AddonHost, repoId: string, rel: string | undefined, kind: 'file' | 'dir', workspaceId?: string): string {
  const repo = findRepo(host, repoId)
  const ws = workspaceId ? findWorkspace(host, workspaceId) : undefined
  if (ws && ws.repoId !== repo.id) throw new Error(`Workspace ${ws.id} isn't in project ${repoId}`)
  const root = ws ? ws.path : repo.path
  if (rel !== undefined && !okSegments(rel)) throw new Error(`"${rel}" isn't a path inside ${PROJECT_DIR}/. Use one like plans/q3.plan.md.`)
  if (kind === 'file' && !FILE_TYPES.includes(extname(rel ?? '').toLowerCase())) throw new Error(`Add-ons can only keep ${FILE_TYPES.join(', ')} files in ${PROJECT_DIR}/`)
  const target = join(root, PROJECT_DIR, rel ?? '')
  let exists = target
  while (!existsSync(exists) && exists !== root && dirname(exists) !== exists) exists = dirname(exists)
  const real = realpathSync(exists)
  if (real !== join(realpathSync(root), relative(root, exists))) throw new Error(`${PROJECT_DIR}/${rel ?? ''} leads outside the ${ws ? 'workspace' : 'project'} through a link`)
  return target
}

/** A pull request and its checks, as an add-on sees them. */
function describePr({ pr, checks }: { pr: PrInfo | null; checks: CheckRun[] }) {
  const sum = summarizeChecks(checks)
  return {
    pr: pr ? { number: pr.number, url: pr.url, state: pr.state, isDraft: pr.isDraft, title: pr.title, reviewDecision: pr.reviewDecision ?? '', mergeState: pr.mergeStateStatus ?? '', branch: pr.headRefName ?? '' } : null,
    checks: { total: sum.total, passed: sum.passed, pending: sum.pending, failed: sum.failed.map((c) => ({ name: c.workflow ? `${c.workflow} / ${c.name}` : c.name, link: c.link })) }
  }
}

function listFiles(root: string, dir: string, out: { path: string; size: number; modified: number }[], depth = 0) {
  if (depth > 4 || !existsSync(dir)) return
  for (const name of readdirSync(dir).sort()) {
    if (out.length >= LIST_LIMIT) return
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = lstatSync(full)
    if (st.isDirectory()) listFiles(root, full, out, depth + 1)
    else if (st.isFile() && FILE_TYPES.includes(extname(name).toLowerCase())) out.push({ path: relative(root, full).split('\\').join('/'), size: st.size, modified: Math.round(st.mtimeMs) })
  }
}

/**
 * Runs one host API call for an add-on. `caller` comes from the app's own record of which view
 * sent the message; `args` is whatever the view sent and is validated here.
 */
export async function call(host: AddonHost, caller: Caller, method: string, args: unknown, _context?: AddonContext): Promise<unknown> {
  checkCall(method, caller.granted)
  const schema = schemas[method as Method]
  const parsed = schema.safeParse(args ?? undefined)
  if (!parsed.success) throw new Error(`${method}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'} ${i.message}`).join('; ')}`)
  const a = (parsed.data ?? {}) as Record<string, any>

  switch (method as Method) {
    case 'app.info':
      return { apiVersion: ADDON_API_VERSION, appVersion: host.appVersion(), addon: { id: caller.id, name: caller.name, permissions: [...caller.granted] } }

    case 'repos.list':
      return host
        .repos()
        .filter((r) => !r.hidden)
        .map((r) => ({ id: r.id, name: r.name, defaultBranch: r.defaultBranch }))

    case 'workspaces.list': {
      const pending = host.pendingChatIds()
      return host
        .workspaces()
        .filter((w) => !w.archived && !w.orchestrator && (!a.repoId || w.repoId === a.repoId))
        .map((w) => describe(host, w, pending))
    }

    case 'workspaces.read': {
      const ws = findWorkspace(host, a.workspaceId)
      const chat = mainChat(host, ws)
      return { workspace: describe(host, ws, host.pendingChatIds()), entries: transcriptEntries(host.chatItems(chat.id), a.last ?? 40) }
    }

    case 'workspaces.start': {
      const repo = host.repos().find((r) => r.id === a.repoId)
      if (!repo) throw new Error(`No project ${a.repoId}`)
      const mine = host.workspaces().filter((w) => w.addonId === caller.id && !w.archived)
      const running = mine.filter((w) => chatsOf(host, w.id).some((c) => c.status === 'running')).length
      if (running >= MAX_RUNNING_PER_ADDON) throw new Error(`${caller.name} already has ${running} agents running. Wait for one to finish.`)
      const { workspace, chat } = await host.createWorkspace(repo.id)
      workspace.addonId = caller.id
      if (a.title) {
        workspace.title = a.title
        workspace.named = true
      }
      if (a.model) chat.model = a.model
      if (a.planFirst) chat.planMode = true
      host.saved()
      host.sendToChat(chat, a.task)
      return describe(host, workspace, host.pendingChatIds())
    }

    case 'workspaces.message': {
      const ws = findWorkspace(host, a.workspaceId)
      const chat = mainChat(host, ws)
      if (chat.remote) throw new Error(`${ws.title} is running somewhere else (${chat.remote.kind}). Bring it back first.`)
      if (chat.status === 'running') throw new Error(`${ws.title} is still running. Wait for it to finish.`)
      host.sendToChat(chat, a.message)
      return null
    }

    case 'workspaces.stop': {
      const ws = findWorkspace(host, a.workspaceId)
      await Promise.all(
        chatsOf(host, ws.id)
          .filter((c) => c.status === 'running')
          .map((c) => host.stopChat(c.id))
      )
      return null
    }

    case 'workspaces.forPr': {
      const repo = findRepo(host, a.repoId)
      const { pr } = await host.prByNumber(repo, a.number)
      if (!pr) throw new Error(`No pull request #${a.number} in ${repo.name}, or GitHub couldn't be reached`)
      // One workspace per pull request: the one already on its branch, however it got there.
      const there = host.workspaces().find((w) => w.repoId === repo.id && !w.archived && !w.orchestrator && (w.branch === pr.headRefName || w.branch === `pr-${a.number}`))
      if (there) return describe(host, there, host.pendingChatIds())
      const { workspace } = await host.createWorkspace(repo.id, { kind: 'pr', number: a.number })
      workspace.addonId = caller.id
      host.saved()
      return describe(host, workspace, host.pendingChatIds())
    }

    case 'prs.status':
      return describePr(await host.prStatus(findWorkspace(host, a.workspaceId)))
    case 'prs.get':
      return describePr(await host.prByNumber(findRepo(host, a.repoId), a.number))

    case 'files.list': {
      const out: { path: string; size: number; modified: number }[] = []
      listFiles(projectPath(host, a.repoId, undefined, 'dir', a.workspaceId), projectPath(host, a.repoId, a.dir || undefined, 'dir', a.workspaceId), out)
      return out
    }
    case 'files.read': {
      const file = projectPath(host, a.repoId, a.path, 'file', a.workspaceId)
      // Open first, then check what was opened: a file checked by name could be swapped before it is read.
      // Never through a link, and never waiting on a pipe someone left under that name.
      let fd: number
      try {
        fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ENOTDIR') return null
        if (code === 'ELOOP') throw new Error(`${PROJECT_DIR}/${a.path} leads outside the ${a.workspaceId ? 'workspace' : 'project'} through a link`)
        throw e
      }
      try {
        const st = fstatSync(fd)
        if (!st.isFile()) throw new Error(`${a.path} isn't a file`)
        if (st.size > FILE_LIMIT) throw new Error(`${a.path} is over 1 MB`)
        // The folders above it, checked again now that the file is open: what was opened is what is at that path.
        const there = lstatSync(projectPath(host, a.repoId, a.path, 'file', a.workspaceId))
        if (there.ino !== st.ino || there.dev !== st.dev) throw new Error(`${a.path} changed while it was being read. Try again.`)
        return { content: readFileSync(fd, 'utf8'), modified: Math.round(st.mtimeMs) }
      } finally {
        closeSync(fd)
      }
    }
    case 'files.write': {
      if (Buffer.byteLength(a.content) > FILE_LIMIT) throw new Error(`${a.path} would be over 1 MB`)
      const file = projectPath(host, a.repoId, a.path, 'file')
      if (existsSync(file) && !lstatSync(file).isFile()) throw new Error(`${a.path} isn't a file`)
      mkdirSync(dirname(file), { recursive: true })
      // A fresh name, created exclusively: a link someone left at a guessable temp path is never written through.
      const tmp = `${file}.${randomUUID()}.tmp`
      writeFileSync(tmp, a.content, { flag: 'wx' })
      try {
        // The folders are checked once more before the file takes its name, in case one was swapped for a link meanwhile.
        projectPath(host, a.repoId, a.path, 'file')
        renameSync(tmp, file)
      } catch (e) {
        try {
          unlinkSync(tmp)
        } catch {
          // Already gone.
        }
        throw e
      }
      return { modified: Math.round(lstatSync(file).mtimeMs) }
    }
    case 'files.delete': {
      const file = projectPath(host, a.repoId, a.path, 'file')
      if (existsSync(file)) {
        if (!lstatSync(file).isFile()) throw new Error(`${a.path} isn't a file`)
        unlinkSync(file)
      }
      return null
    }

    case 'store.get':
      return readStorage(host, caller)[a.key] ?? null
    case 'store.keys':
      return Object.keys(readStorage(host, caller))
    case 'store.set': {
      if (a.value === undefined) throw new Error('store.set: value is missing')
      writeStorage(host, caller, { ...readStorage(host, caller), [a.key]: a.value })
      host.storeChanged?.(caller.key, a.key)
      return null
    }
    case 'store.delete': {
      const data = readStorage(host, caller)
      delete data[a.key]
      writeStorage(host, caller, data)
      host.storeChanged?.(caller.key, a.key)
      return null
    }

    case 'ui.openWorkspace':
      host.openWorkspace(findWorkspace(host, a.workspaceId).id)
      return null
    case 'ui.notify':
      host.notify(`${caller.name}: ${a.title}`, a.body ?? '', a.workspaceId ? findWorkspace(host, a.workspaceId).id : undefined)
      return null
  }
}
