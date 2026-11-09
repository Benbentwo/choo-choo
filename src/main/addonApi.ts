/**
 * The host API add-on views call through `window.choo`. Every call lands in `call()`, which checks
 * the add-on's granted permissions before doing anything. No Electron imports here: what it needs
 * from the app comes in through `AddonHost`, so it can be tested on its own.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { Chat, ChatItem, CheckRun, PrInfo, Repo, Workspace } from '@shared/types'
import { ADDON_API_VERSION, checkCall, type AddonContext, type AddonWorkspace } from '@shared/addons'
import { summarizeChecks } from '@shared/prStatus'

export interface AddonHost {
  repos(): Repo[]
  workspaces(): Workspace[]
  chats(): Chat[]
  chatItems(chatId: string): ChatItem[]
  /** Chats waiting for the person to approve a tool call. */
  pendingChatIds(): Set<string>
  createWorkspace(repoId: string): Promise<{ workspace: Workspace; chat: Chat }>
  /** Starts a turn in a chat. Throws if the chat is busy. */
  sendToChat(chat: Chat, text: string): void
  stopChat(chatId: string): Promise<void>
  prStatus(ws: Workspace): Promise<{ pr: PrInfo | null; checks: CheckRun[] }>
  notify(title: string, body: string, workspaceId?: string): void
  openWorkspace(workspaceId: string): void
  /** Persist state changed by a call and tell the window. */
  saved(): void
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

const MODELS = ['opus', 'fable', 'sonnet', 'haiku', 'codex'] as const

const schemas = {
  'app.info': z.object({}).optional(),
  'repos.list': z.object({}).optional(),
  'workspaces.list': z.object({ repoId: z.string().optional() }).optional(),
  'workspaces.read': z.object({ workspaceId: z.string(), last: z.number().int().min(1).max(200).optional() }),
  'workspaces.start': z.object({ repoId: z.string(), task: z.string().min(1).max(100_000), title: z.string().max(80).optional(), model: z.enum(MODELS).optional(), planFirst: z.boolean().optional() }),
  'workspaces.message': z.object({ workspaceId: z.string(), message: z.string().min(1).max(100_000) }),
  'workspaces.stop': z.object({ workspaceId: z.string() }),
  'prs.status': z.object({ workspaceId: z.string() }),
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

    case 'prs.status': {
      const ws = findWorkspace(host, a.workspaceId)
      const { pr, checks } = await host.prStatus(ws)
      const sum = summarizeChecks(checks)
      return {
        pr: pr ? { number: pr.number, url: pr.url, state: pr.state, isDraft: pr.isDraft, title: pr.title, reviewDecision: pr.reviewDecision ?? '', mergeState: pr.mergeStateStatus ?? '' } : null,
        checks: { total: sum.total, passed: sum.passed, pending: sum.pending, failed: sum.failed.map((c) => ({ name: c.workflow ? `${c.workflow} / ${c.name}` : c.name, link: c.link })) }
      }
    }

    case 'store.get':
      return readStorage(host, caller)[a.key] ?? null
    case 'store.keys':
      return Object.keys(readStorage(host, caller))
    case 'store.set': {
      if (a.value === undefined) throw new Error('store.set: value is missing')
      writeStorage(host, caller, { ...readStorage(host, caller), [a.key]: a.value })
      return null
    }
    case 'store.delete': {
      const data = readStorage(host, caller)
      delete data[a.key]
      writeStorage(host, caller, data)
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
