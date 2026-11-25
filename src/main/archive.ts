import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChatItem, Workspace, WorkspacePreview } from '@shared/types'
import * as store from './store'
import * as git from './git'
import * as gh from './github'

/** Archived worktrees are moved here so their uncommitted work survives until cleanup. */
export const ARCHIVE_ROOT = join(homedir(), 'choo-choo', 'archive')

const DAY = 24 * 60 * 60 * 1000

function repoOf(ws: Workspace) {
  return store.get().repos.find((r) => r.id === ws.repoId)
}

/**
 * Takes the worktree out of the workspaces folder. It is moved to the archive folder when git allows it,
 * so restoring brings back uncommitted files too; otherwise it is removed and the branch is kept.
 */
export async function stashWorktree(ws: Workspace) {
  const repo = repoOf(ws)
  if (!repo) return
  const dest = join(ARCHIVE_ROOT, repo.name, `${ws.name}-${ws.id.slice(0, 8)}`)
  if (existsSync(ws.path)) {
    try {
      mkdirSync(join(dest, '..'), { recursive: true })
      rmSync(dest, { recursive: true, force: true })
      await git.moveWorktree(repo.path, ws.path, dest)
      ws.archivePath = dest
      return
    } catch {
      /* fall back to removing it */
    }
  }
  await git.removeWorktree(repo.path, ws.path)
  ws.archivePath = undefined
}

/** Puts an archived worktree back. Returns false when it has to be recreated from the branch. */
export async function unstashWorktree(ws: Workspace): Promise<boolean> {
  const repo = repoOf(ws)
  if (!repo || !ws.archivePath || !existsSync(ws.archivePath)) return false
  mkdirSync(join(ws.path, '..'), { recursive: true })
  await git.moveWorktree(repo.path, ws.archivePath, ws.path)
  ws.archivePath = undefined
  return true
}

/** Drops a workspace and its chats from the store. */
export function forgetWorkspace(ws: Workspace) {
  const s = store.get()
  for (const c of s.chats.filter((c) => c.workspaceId === ws.id)) store.deleteChatItems(c.id)
  s.chats = s.chats.filter((c) => c.workspaceId !== ws.id)
  s.workspaces = s.workspaces.filter((w) => w.id !== ws.id)
}

/** Whether a branch's commits are safe on GitHub or in the base branch, so deleting it locally loses nothing. */
async function branchDone(repoPath: string, ws: Workspace): Promise<boolean> {
  if (await git.branchIsSafeToDelete(repoPath, ws.branch, ws.baseRef)) return true
  // Squash merges leave the local branch unmerged and, once GitHub deletes the head, without an upstream.
  const pr = await gh.prForBranch(repoPath, ws.prNumber ? String(ws.prNumber) : ws.branch)
  if (pr?.state !== 'MERGED' || !pr.headRefOid) return false
  const tip = (await git.git(repoPath, ['rev-parse', `refs/heads/${ws.branch}`]).catch(() => '')).trim()
  return tip === pr.headRefOid
}

/**
 * Deletes a workspace's local branch when no commits would be lost. Returns whether the branch is gone.
 * Orchestrators (the main checkout) and stacks are never touched.
 */
export async function deleteBranchIfDone(repoPath: string, ws: Workspace): Promise<boolean> {
  if (ws.orchestrator || ws.stack || !existsSync(repoPath)) return false
  if (!(await branchDone(repoPath, ws))) return false
  // git refuses when another worktree has the branch checked out.
  return (await git.deleteBranch(repoPath, ws.branch)) || !(await git.localBranchExists(repoPath, ws.branch))
}

let onForget: () => void = () => {}

/**
 * Deletes archived worktrees older than the retention setting. The branch and transcript stay, so restore still works,
 * unless "archiveDeleteBranches" is on: then a workspace whose branch is merged or pushed also loses its local
 * branch and its Archived entry, freeing its name.
 */
export async function cleanupArchives(now = Date.now()) {
  const { archiveRetentionDays: days, archiveDeleteBranches } = store.get().settings
  if (!days || days <= 0) return 0
  let n = 0
  let forgot = false
  for (const ws of [...store.get().workspaces]) {
    if (!ws.archived || (ws.archivedAt ?? now) > now - days * DAY) continue
    const repo = repoOf(ws)
    if (ws.archivePath) {
      if (repo) await git.removeWorktree(repo.path, ws.archivePath)
      rmSync(ws.archivePath, { recursive: true, force: true })
      ws.archivePath = undefined
      n++
    }
    // A branch that stays keeps its entry, so restore still works and the name stays reserved.
    if (!archiveDeleteBranches || !repo || !(await deleteBranchIfDone(repo.path, ws))) continue
    forgetWorkspace(ws)
    forgot = true
    n++
  }
  if (n) store.save()
  if (forgot) onForget()
  return n
}

let timer: NodeJS.Timeout | null = null
/** `changed` runs when cleanup removed workspaces from the store, so the window can refresh. */
export function startArchiveCleanup(changed: () => void) {
  onForget = changed
  setTimeout(() => void cleanupArchives(), 15_000)
  timer ??= setInterval(() => void cleanupArchives(), 6 * 60 * 60 * 1000)
}

function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** What the sidebar hover card shows: the latest thing the agent said, and when the workspace was last active. */
export function preview(ws: Workspace): WorkspacePreview {
  let last: ChatItem | null = null
  let lastText: ChatItem | null = null
  for (const c of store.get().chats.filter((c) => c.workspaceId === ws.id)) {
    for (const it of store.chatItems(c.id)) {
      if (!last || it.ts > last.ts) last = it
      if ((it.kind === 'assistant' || it.kind === 'user') && it.text.trim() && (!lastText || it.ts >= lastText.ts)) lastText = it
    }
  }
  const text = lastText && (lastText.kind === 'assistant' || lastText.kind === 'user') ? plain(lastText.text).slice(0, 240) : ''
  return { snippet: text, lastActive: last?.ts ?? ws.createdAt }
}

/** When each workspace last had chat activity: the newest message across its chats. */
export function activity(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of store.get().chats) {
    const list = store.chatItems(c.id)
    const ts = list.length ? list[list.length - 1].ts : c.createdAt
    out[c.workspaceId] = Math.max(out[c.workspaceId] ?? 0, ts)
  }
  return out
}
