import type { Chat, Repo, RepoGroup, Workspace } from './types'

/**
 * Projects: a project group seen as one big piece of work. The person mostly talks to the
 * project's orchestrator chat, which forwards each message to the thread it belongs to.
 * Threads are more chats on the same orchestrator workspace. Workspaces belong to the project,
 * and the sidebar lists them by repo. See docs/prd/projects.md.
 */

/** First line of a message the orchestrator chat forwarded into a thread. */
export const ROUTED_PREFIX = '[Sent here from the orchestrator chat]'

/** Whether a message was forwarded from the orchestrator chat, and its text without the marker. */
export function stripRouted(text: string): { routed: boolean; text: string } {
  if (!text.startsWith(ROUTED_PREFIX)) return { routed: false, text }
  return { routed: true, text: text.slice(ROUTED_PREFIX.length).replace(/^\s*\n/, '') }
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

/** Whether a workspace belongs to some project, so the plain repo list leaves it out. */
export function inProject(ws: Workspace, groups: RepoGroup[]): boolean {
  return !!ws.orchestratorId && groups.some((g) => g.id === ws.orchestratorId)
}

/**
 * The sidebar tree under a project: its repos, each with that project's open workspaces.
 * Only repos with work show, unless `showAll`.
 */
export function projectTree(group: RepoGroup, repos: Repo[], workspaces: Workspace[], showAll = false): { repo: Repo; workspaces: Workspace[] }[] {
  const mine = projectWorkspaces(group, workspaces)
  const ids = [...group.repoIds, ...mine.map((w) => w.repoId).filter((id) => !group.repoIds.includes(id))]
  return [...new Set(ids)]
    .map((id) => repos.find((r) => r.id === id))
    .filter((r): r is Repo => !!r)
    .map((repo) => ({ repo, workspaces: mine.filter((w) => w.repoId === repo.id).sort((a, b) => b.createdAt - a.createdAt) }))
    .filter((n) => showAll || n.workspaces.length > 0)
}

/** Keys in Settings.sidebarCollapsed for folding a project, a repo inside it, or the Projects section. */
export const foldKey = {
  section: 'section:projects',
  project: (groupId: string) => `project:${groupId}`,
  projectRepo: (groupId: string, repoId: string) => `project:${groupId}:${repoId}`
}
