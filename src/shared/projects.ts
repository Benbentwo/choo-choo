import type { Chat, Repo, RepoGroup, Workspace } from './types'

/**
 * Projects: a project group seen as one big piece of work. The person mostly talks to the
 * project's orchestrator chat, which forwards each message to the thread it belongs to.
 * Threads are more chats on the same orchestrator workspace. Each thread owns the workspaces it
 * starts, and the sidebar lists them by thread, then repo. See docs/prd/projects.md.
 */

/** First line of a message the orchestrator chat forwarded into a thread. */
export const ROUTED_PREFIX = '[Sent here from the orchestrator chat]'

/** Whether a message was forwarded from the orchestrator chat, and its text without the marker. */
export function stripRouted(text: string): { routed: boolean; text: string } {
  if (!text.startsWith(ROUTED_PREFIX)) return { routed: false, text }
  return { routed: true, text: text.slice(ROUTED_PREFIX.length).replace(/^\s*\n/, '') }
}

/** First line of the message that wakes an orchestrator when workspaces it started finish. */
export const AUTO_UPDATE_PREFIX = '[Automatic update from Choo Choo, not from the person]'

export type AutoUpdateState = 'finished' | 'error' | 'needs-approval'
export type AutoUpdateEntry = { title: string; id: string; state: AutoUpdateState }

const AUTO_UPDATE_WORDS: Record<AutoUpdateState, string> = {
  finished: 'finished',
  error: 'hit an error',
  'needs-approval': 'is waiting for the person to approve a tool call'
}

/** One workspace's line in an automatic update, as the orchestrator reads it. */
export function autoUpdateLine(d: AutoUpdateEntry): string {
  return `- ${d.title} (${d.id}) ${AUTO_UPDATE_WORDS[d.state]}.`
}

/** The workspaces an automatic update reported, or null when the message isn't one. */
export function parseAutoUpdate(text: string): AutoUpdateEntry[] | null {
  if (!text.startsWith(AUTO_UPDATE_PREFIX)) return null
  const out: AutoUpdateEntry[] = []
  for (const line of text.split('\n')) {
    const m = /^- (.*) \(([^()\s]+)\) (.+)\.$/.exec(line)
    const state = m && (Object.keys(AUTO_UPDATE_WORDS) as AutoUpdateState[]).find((s) => AUTO_UPDATE_WORDS[s] === m[3])
    if (m && state) out.push({ title: m[1], id: m[2], state })
  }
  return out
}

/** The orchestrator chat: the first chat on the orchestrator workspace that isn't a thread. */
export function routerChat(chats: Chat[], orchWsId: string): Chat | undefined {
  return chats.find((c) => c.workspaceId === orchWsId && !c.thread)
}

/** A project's threads, newest first. */
export function projectThreads(chats: Chat[], orchWsId: string): Chat[] {
  return chats.filter((c) => c.workspaceId === orchWsId && c.thread).sort((a, b) => b.createdAt - a.createdAt)
}

/** Where a finished workspace's update goes: the thread that started it, or the orchestrator chat. */
export function updateTarget(ws: Workspace, chats: Chat[], orchWsId: string): Chat | undefined {
  const thread = ws.threadId ? chats.find((c) => c.id === ws.threadId && c.workspaceId === orchWsId) : undefined
  return thread ?? routerChat(chats, orchWsId) ?? chats.find((c) => c.workspaceId === orchWsId)
}

/** A short thread title from the first message: its first line, cut at a word. */
export function threadTitle(text: string): string {
  const line = stripRouted(text).text.trim().split('\n')[0].replace(/\s+/g, ' ')
  if (line.length <= 40) return line || 'New thread'
  const cut = line.slice(0, 40)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : 40)}…`
}

/** Workspaces that belong to a project: started by its orchestrator and still open. */
export function projectWorkspaces(group: RepoGroup, workspaces: Workspace[]): Workspace[] {
  return workspaces.filter((w) => !w.archived && !w.orchestrator && w.orchestratorId === group.id)
}

/** A project's archived workspaces, most recently archived first, for its Archived list. */
export function projectArchived(group: RepoGroup, workspaces: Workspace[]): Workspace[] {
  return workspaces.filter((w) => w.archived && !w.orchestrator && w.orchestratorId === group.id).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
}

/** Whether a workspace belongs to some project, so the plain repo list leaves it out. */
export function inProject(ws: Workspace, groups: RepoGroup[]): boolean {
  return !!ws.orchestratorId && groups.some((g) => g.id === ws.orchestratorId)
}

/** Workspaces grouped by repo, in the project's repo order, newest workspace first in each. */
function byRepo(group: RepoGroup, repos: Repo[], list: Workspace[]): { repo: Repo; workspaces: Workspace[] }[] {
  const ids = [...group.repoIds, ...list.map((w) => w.repoId).filter((id) => !group.repoIds.includes(id))]
  return [...new Set(ids)]
    .map((id) => repos.find((r) => r.id === id))
    .filter((r): r is Repo => !!r)
    .map((repo) => ({ repo, workspaces: list.filter((w) => w.repoId === repo.id).sort((a, b) => b.createdAt - a.createdAt) }))
    .filter((n) => n.workspaces.length > 0)
}

/** The thread a workspace belongs to: the thread that started it, if it is still one of the project's threads. */
export function workspaceThread(ws: Workspace, chats: Chat[], orchWsId: string | undefined): Chat | undefined {
  if (!ws.threadId || !orchWsId) return undefined
  return chats.find((c) => c.id === ws.threadId && c.workspaceId === orchWsId && c.thread)
}

export interface ThreadNode {
  /** The thread, or undefined for work no thread owns (started before threads, or its thread was deleted). */
  thread?: Chat
  repos: { repo: Repo; workspaces: Workspace[] }[]
}

/**
 * The sidebar tree under a project: thread › repo › workspace. Each thread owns the workspaces
 * (and so the PRs) it started. Only threads with open work show, newest thread first; work no
 * thread owns comes last.
 */
export function projectTree(group: RepoGroup, repos: Repo[], workspaces: Workspace[], chats: Chat[], orchWsId: string | undefined): ThreadNode[] {
  const mine = projectWorkspaces(group, workspaces)
  const threads = orchWsId ? projectThreads(chats, orchWsId) : []
  const owned = new Map<string, Workspace[]>()
  const loose: Workspace[] = []
  for (const w of mine) {
    const t = workspaceThread(w, chats, orchWsId)
    if (t) owned.set(t.id, [...(owned.get(t.id) ?? []), w])
    else loose.push(w)
  }
  const nodes: ThreadNode[] = threads.filter((t) => owned.has(t.id)).map((thread) => ({ thread, repos: byRepo(group, repos, owned.get(thread.id)!) }))
  if (loose.length) nodes.push({ repos: byRepo(group, repos, loose) })
  return nodes
}

/** Fold-key id for a thread node; `none` for work no thread owns. */
export const threadKey = (n: ThreadNode) => n.thread?.id ?? 'none'

/** Keys in Settings.sidebarCollapsed for folding the Projects section, the Repos list, a project, a thread in it, or a repo in a thread. */
export const foldKey = {
  section: 'section:projects',
  /** The Repos list below the Projects section. */
  repos: 'section:repos',
  project: (groupId: string) => `project:${groupId}`,
  projectThread: (groupId: string, threadId: string) => `project:${groupId}:thread:${threadId}`,
  projectRepo: (groupId: string, threadId: string, repoId: string) => `project:${groupId}:thread:${threadId}:${repoId}`
}

/** Colors a project icon can take. `accent` follows the theme. */
export const PROJECT_COLORS: { id: string; label: string; hex: string }[] = [
  { id: 'accent', label: 'Theme accent', hex: 'var(--color-accent)' },
  { id: 'red', label: 'Red', hex: '#ef4444' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'amber', label: 'Amber', hex: '#f59e0b' },
  { id: 'green', label: 'Green', hex: '#22c55e' },
  { id: 'teal', label: 'Teal', hex: '#14b8a6' },
  { id: 'sky', label: 'Sky', hex: '#0ea5e9' },
  { id: 'blue', label: 'Blue', hex: '#3b82f6' },
  { id: 'violet', label: 'Violet', hex: '#8b5cf6' },
  { id: 'pink', label: 'Pink', hex: '#ec4899' },
  { id: 'slate', label: 'Gray', hex: '#94a3b8' }
]

/**
 * Telemetry tags for one agent turn. Every workspace gets choo.repo, choo.workspace and
 * choo.branch; work that belongs to a project also gets choo.project, and a thread's turns (or a
 * workspace a thread started) get choo.thread, so a backend can filter project work like any repo.
 */
export function telemetryTags(ws: Workspace, chat: Chat | undefined, s: { repos: Repo[]; groups?: RepoGroup[]; workspaces: Workspace[]; chats: Chat[] }): Record<string, string> {
  const repo = s.repos.find((r) => r.id === ws.repoId)
  const tags: Record<string, string> = { 'choo.repo': repo?.name ?? '', 'choo.workspace': ws.name, 'choo.branch': ws.branch }
  const groups = s.groups ?? []
  const group = ws.orchestrator ? groups.find((g) => g.id === ws.groupId) : groups.find((g) => g.id === ws.orchestratorId)
  if (!group) return tags
  tags['choo.project'] = group.name
  const thread = ws.orchestrator
    ? chat?.thread
      ? chat
      : undefined
    : workspaceThread(ws, s.chats, s.workspaces.find((w) => w.orchestrator && w.groupId === group.id && !w.archived)?.id)
  if (thread) tags['choo.thread'] = thread.title
  return tags
}
