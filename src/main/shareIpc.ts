import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Chat, ChatItem, Repo, ShareStatus, Workspace } from '@shared/types'
import * as store from './store'
import * as git from './git'
import * as gh from './github'
import * as share from './share'
import { pickCityName } from './names'

export interface ShareDeps {
  workspacesRoot: string
  reposRoot: string
  findWs(id: string): Workspace
  addRepo(path: string): Promise<Repo>
  newChat(workspaceId: string): Chat
  runSetup(ws: Workspace): void
  notifyChanged(): void
}

function repoOf(ws: Workspace): Repo {
  const repo = store.get().repos.find((r) => r.id === ws.repoId)
  if (!repo) throw new Error('The repository for this workspace was removed')
  return repo
}

async function bundleFor(ws: Workspace, id: string): Promise<share.ShareBundle> {
  const key = store.get().settings.anthropicApiKey.trim()
  const chats = store.get().chats.filter((c) => c.workspaceId === ws.id)
  return {
    version: 1,
    id,
    title: ws.title,
    repoName: repoOf(ws).name,
    branch: ws.branch,
    baseRef: ws.baseRef,
    sharedBy: await share.sharerName(ws.path),
    sharedAt: Date.now(),
    chats: chats.map((c) => ({
      id: c.id,
      title: c.title,
      model: c.model,
      effort: c.effort,
      review: c.review,
      items: share.shareableItems(store.chatItems(c.id), key ? [key] : [])
    }))
  }
}

async function publish(ws: Workspace): Promise<NonNullable<Workspace['share']>> {
  const id = ws.share?.id ?? share.newShareId()
  const remote = await share.originUrl(ws.path)
  await share.publish(ws.path, await bundleFor(ws, id))
  ws.share = { id, link: share.shareLink(remote, id), sharedAt: Date.now(), autoSync: ws.share?.autoSync ?? true }
  store.save()
  return ws.share
}

const syncing = new Map<string, Promise<unknown>>()

/** Re-publishes a shared workspace after a turn, so coworkers see the latest. Errors stay quiet. */
export function autoSync(ws: Workspace) {
  if (!ws.share?.autoSync || ws.archived) return
  const prev = syncing.get(ws.id) ?? Promise.resolve()
  const next = prev.then(() => publish(ws)).catch(() => {})
  syncing.set(ws.id, next)
}

async function status(ws: Workspace): Promise<ShareStatus | null> {
  if (!ws.share) return null
  return { link: ws.share.link, sharedAt: ws.share.sharedAt, autoSync: ws.share.autoSync, visibility: await gh.repoVisibility(ws.path) }
}

/** The local repo whose origin is this remote, cloning it when there is none. */
async function repoForRemote(remote: string, deps: ShareDeps): Promise<Repo> {
  const want = share.normalizeRemote(remote)
  for (const r of store.get().repos) {
    try {
      if (share.normalizeRemote(await share.originUrl(r.path)) === want) return r
    } catch {
      /* no origin */
    }
  }
  mkdirSync(deps.reposRoot, { recursive: true })
  const name = git.repoNameFromUrl(remote)
  let dest = join(deps.reposRoot, name)
  for (let n = 2; existsSync(dest); n++) dest = join(deps.reposRoot, `${name}-${n}`)
  const slug = share.githubSlug(remote)
  if (slug) await gh.cloneRepo(slug, dest)
  else await git.clone(remote, dest)
  return deps.addRepo(dest)
}

function chatsFromBundle(ws: Workspace, bundle: share.ShareBundle, deps: ShareDeps): Chat[] {
  return bundle.chats.map((sc) => {
    const chat = deps.newChat(ws.id)
    chat.title = sc.title
    chat.model = sc.model
    chat.effort = sc.effort
    chat.review = sc.review
    chat.sharedChatId = sc.id
    setSharedItems(chat, sc.items, bundle)
    return chat
  })
}

function setSharedItems(chat: Chat, items: ChatItem[], bundle: share.ShareBundle) {
  const when = new Date(bundle.sharedAt).toLocaleString()
  const note: ChatItem = {
    id: `share-note-${chat.id}`,
    kind: 'note',
    text: `Shared by ${bundle.sharedBy}, last updated ${when}. Your next message continues this conversation with your own Claude login.`,
    ts: items[0]?.ts ?? bundle.sharedAt
  }
  store.replaceItems(chat.id, [note, ...items])
  chat.handoff = share.handoffContext(items, bundle.sharedBy)
  chat.unread = true
}

async function importShare(repo: Repo, id: string, deps: ShareDeps) {
  const s = store.get()
  const existing = s.workspaces.find((w) => w.importedShare?.id === id && w.repoId === repo.id && !w.archived)
  if (existing) {
    await refresh(existing, deps)
    const chat = s.chats.find((c) => c.workspaceId === existing.id) ?? deps.newChat(existing.id)
    return { workspace: existing, chat }
  }
  const { bundle, ref } = await share.fetchShare(repo.path, id)
  const taken = new Set(s.workspaces.filter((w) => w.repoId === repo.id).map((w) => w.name))
  const name = pickCityName(taken)
  // Keep the sharer's branch name so a push lands on the same branch and pull request.
  let branch = bundle.branch
  if (await share.branchExists(repo.path, branch)) branch = `${branch}-${name}`
  const dir = join(deps.workspacesRoot, repo.name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  await share.checkoutShare(repo.path, path, branch, ref)
  let baseRef = bundle.baseRef
  try {
    await git.git(repo.path, ['rev-parse', '--verify', '--quiet', baseRef])
  } catch {
    baseRef = await git.baseRefFor(repo.path, repo.defaultBranch)
  }
  const remote = await share.originUrl(repo.path)
  const workspace: Workspace = {
    id: randomUUID(),
    repoId: repo.id,
    name,
    branch,
    baseRef,
    path,
    title: bundle.title,
    named: true,
    createdAt: Date.now(),
    importedShare: { id, link: share.shareLink(remote, id), sharedBy: bundle.sharedBy, sharedAt: bundle.sharedAt }
  }
  s.workspaces.push(workspace)
  const chats = chatsFromBundle(workspace, bundle, deps)
  const chat = chats[0] ?? deps.newChat(workspace.id)
  store.save()
  deps.runSetup(workspace)
  return { workspace, chat }
}

/**
 * Pulls the latest transcripts of an opened share. Chats you have already continued are left
 * alone, and so are your files. Returns whether anything changed.
 */
async function refresh(ws: Workspace, deps: ShareDeps): Promise<boolean> {
  const imp = ws.importedShare
  if (!imp) return false
  const { bundle } = await share.fetchShare(repoOf(ws).path, imp.id)
  if (bundle.sharedAt <= imp.sharedAt) return false
  const chats = store.get().chats.filter((c) => c.workspaceId === ws.id)
  for (const sc of bundle.chats) {
    const mine = chats.find((c) => c.sharedChatId === sc.id)
    if (mine && (mine.sdkSessionId || mine.codexThreadId || mine.status === 'running')) continue
    if (mine) {
      mine.title = sc.title
      setSharedItems(mine, sc.items, bundle)
    }
  }
  const known = new Set(chats.map((c) => c.sharedChatId))
  const added = bundle.chats.filter((c) => !known.has(c.id))
  if (added.length) chatsFromBundle(ws, { ...bundle, chats: added }, deps)
  ws.importedShare = { ...imp, sharedAt: bundle.sharedAt }
  store.save()
  return true
}

export function registerShareIpc(deps: ShareDeps) {
  const h = (ch: string, fn: (...a: any[]) => unknown) => ipcMain.handle(ch, (_e, ...a) => fn(...a))
  h('share:status', (id: string) => status(deps.findWs(id)))
  h('share:create', async (id: string) => {
    const ws = deps.findWs(id)
    await publish(ws)
    return status(ws)
  })
  h('share:autoSync', (id: string, on: boolean) => {
    const ws = deps.findWs(id)
    if (ws.share) ws.share.autoSync = on
    store.save()
  })
  h('share:remove', async (id: string) => {
    const ws = deps.findWs(id)
    if (!ws.share) return
    await share.unpublish(ws.path, ws.share.id)
    ws.share = undefined
    store.save()
  })
  h('share:list', async () => {
    const repos = store.get().repos.filter((r) => !r.hidden)
    const out = await Promise.all(
      repos.map(async (r) => {
        try {
          return { repoId: r.id, repoName: r.name, shares: await share.listShares(r.path) }
        } catch {
          return { repoId: r.id, repoName: r.name, shares: [] }
        }
      })
    )
    return out.filter((r) => r.shares.length)
  })
  h('share:open', async (link: string) => {
    const parsed = share.parseShareLink(link)
    if (!parsed) throw new Error('That is not a Choo Choo share link. It starts with choo-choo://share')
    const repo = await repoForRemote(parsed.remote, deps)
    const res = await importShare(repo, parsed.id, deps)
    deps.notifyChanged()
    return res
  })
  h('share:openById', async (repoId: string, id: string) => {
    const repo = store.get().repos.find((r) => r.id === repoId)
    if (!repo) throw new Error('Unknown repository')
    const res = await importShare(repo, id, deps)
    deps.notifyChanged()
    return res
  })
  h('share:refresh', async (id: string) => {
    const changed = await refresh(deps.findWs(id), deps)
    if (changed) deps.notifyChanged()
    return changed
  })
}
