import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChatItem, Workspace, WorkspacePreview } from '@shared/types'
import * as store from './store'
import * as git from './git'

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

/** Deletes archived worktrees older than the retention setting. The branch and transcript stay, so restore still works. */
export async function cleanupArchives(now = Date.now()) {
  const days = store.get().settings.archiveRetentionDays
  if (!days || days <= 0) return 0
  let n = 0
  for (const ws of store.get().workspaces) {
    if (!ws.archived || !ws.archivePath || (ws.archivedAt ?? now) > now - days * DAY) continue
    const repo = repoOf(ws)
    if (repo) await git.removeWorktree(repo.path, ws.archivePath)
    rmSync(ws.archivePath, { recursive: true, force: true })
    ws.archivePath = undefined
    n++
  }
  if (n) store.save()
  return n
}

let timer: NodeJS.Timeout | null = null
export function startArchiveCleanup() {
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
