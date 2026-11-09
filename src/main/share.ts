/**
 * Shared sessions.
 *
 * A share is one commit pushed to a hidden ref in the workspace's own git remote:
 * `refs/choo-choo/shares/<id>`. Its tree holds `share.json` (workspace info and chat transcripts)
 * and its parent is a snapshot of the worktree, uncommitted and untracked files included, whose
 * own parent is the branch HEAD. So whoever can read the repo can open the share, and nobody
 * else can. Nothing about anyone's Claude login travels with it: each person runs the
 * conversation on with their own sign-in.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { ChatItem, ModelId, Effort, ShareInfo } from '@shared/types'
import { git, snapshot } from './git'

export const SHARE_REF = 'refs/choo-choo/shares'
const IMPORT_REF = 'refs/choo-choo/imports'

export interface SharedChat {
  id: string
  title: string
  model: ModelId
  effort: Effort
  review?: boolean
  items: ChatItem[]
}

export interface ShareBundle {
  version: 1
  id: string
  title: string
  repoName: string
  branch: string
  baseRef: string
  sharedBy: string
  sharedAt: number
  chats: SharedChat[]
}

export const newShareId = () => randomBytes(6).toString('hex')

// ---- links ----

/** choo-choo://share?remote=<origin url>&id=<share id>. Also what the user copies and pastes. */
export function shareLink(remote: string, id: string): string {
  return `choo-choo://share?remote=${encodeURIComponent(remote)}&id=${id}`
}

export function parseShareLink(text: string): { remote: string; id: string } | null {
  const t = text.trim()
  const m = t.match(/^choo-choo:\/\/share\?(.+)$/)
  if (!m) return null
  const q = new URLSearchParams(m[1])
  const remote = q.get('remote')
  const id = q.get('id')
  if (!remote || !id || !/^[\w-]+$/.test(id)) return null
  return { remote, id }
}

/** Reduces https, ssh and scp-style git URLs to host/owner/repo so different clones of one repo match. */
export function normalizeRemote(url: string): string {
  let u = url.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  u = u.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '')
  u = u.replace(/^([^/:]+):(?!\d+\/)/, '$1/') // scp form host:owner/repo
  u = u.replace(/^([^/:]+):\d+\//, '$1/') // drop a port
  return u.toLowerCase()
}

/** owner/repo when the remote is on github.com, so it can be cloned through gh. */
export function githubSlug(remote: string): string | null {
  const n = normalizeRemote(remote)
  const m = n.match(/^github\.com\/([\w.-]+\/[\w.-]+)$/)
  return m ? m[1] : null
}

// ---- what goes into a share ----

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{32,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
]

/** Blanks out things that look like credentials, plus any exact strings passed in (such as the user's API key). */
export function redact(text: string, extra: string[] = []): string {
  let out = text
  for (const s of extra) if (s && s.length >= 8) out = out.split(s).join('[redacted]')
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]')
  return out
}

function redactDeep<T>(v: T, extra: string[]): T {
  if (typeof v === 'string') return (v.startsWith('data:image/') ? v : redact(v, extra)) as T
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, extra)) as T
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) o[k] = redactDeep(x, extra)
    return o as T
  }
  return v
}

/** Chat items as they go into a share: secrets redacted, local-only checkpoint data dropped. */
export function shareableItems(items: ChatItem[], extraSecrets: string[] = []): ChatItem[] {
  return items
    .filter((it) => !(it.kind === 'assistant' && it.streaming))
    .map((it) => {
      if (it.kind !== 'user') return redactDeep(it, extraSecrets)
      const { checkpoint: _c, resumeAt: _r, ...rest } = it
      return redactDeep(rest, extraSecrets) as ChatItem
    })
}

const HANDOFF_LIMIT = 40_000

function short(v: unknown, n: number): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '')
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/**
 * The transcript a coworker's agent reads before their first message, because a Claude session
 * itself lives on the machine that ran it and can't be resumed elsewhere.
 */
export function handoffContext(items: ChatItem[], sharedBy: string): string {
  const lines: string[] = []
  for (const it of items) {
    if (it.kind === 'user') lines.push(`USER: ${it.text}${it.images?.length ? ` [${it.images.length} image(s)]` : ''}`)
    else if (it.kind === 'assistant') lines.push(`ASSISTANT: ${it.text}`)
    else if (it.kind === 'tool') lines.push(`TOOL ${it.name}(${short(it.input, 300)})${it.isError ? ' failed' : ''}${it.result ? ` -> ${short(it.result, 300)}` : ''}`)
    else if (it.kind === 'error') lines.push(`ERROR: ${it.text}`)
  }
  let body = lines.join('\n\n')
  if (body.length > HANDOFF_LIMIT) body = `[earlier messages trimmed]\n\n${body.slice(body.length - HANDOFF_LIMIT)}`
  return [
    `<shared-session>`,
    `${sharedBy} shared this conversation with me. It ran on their machine, so here is the transcript so far. The working tree already has their changes. Pick up from where it left off.`,
    ``,
    body,
    `</shared-session>`
  ].join('\n')
}

// ---- git plumbing ----

function gitIn(cwd: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('git', args, { cwd })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `git ${args[0]} failed`))))
    // git can exit before it reads its input (a bad ref, say). 'close' reports that; this keeps the
    // broken pipe from surfacing as an unhandled error.
    p.stdin.on('error', () => {})
    p.stdin.end(input)
  })
}

export async function originUrl(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ['remote', 'get-url', 'origin'])).trim()
  } catch {
    throw new Error('This repository has no origin remote to share through. Add one with git remote add origin <url>.')
  }
}

export async function sharerName(cwd: string): Promise<string> {
  const read = async (k: string) => {
    try {
      return (await git(cwd, ['config', k])).trim()
    } catch {
      return ''
    }
  }
  return (await read('user.name')) || (await read('github.user')) || 'A coworker'
}

/** Writes the share commit locally and returns it. */
export async function writeShareCommit(cwd: string, bundle: ShareBundle): Promise<string> {
  const snap = await snapshot(cwd)
  if (!snap) throw new Error('Could not snapshot the workspace')
  const blob = (await gitIn(cwd, ['hash-object', '-w', '--stdin'], JSON.stringify(bundle))).trim()
  const tree = (await gitIn(cwd, ['mktree'], `100644 blob ${blob}\tshare.json\n`)).trim()
  const commit = (await gitIn(cwd, ['commit-tree', tree, '-p', snap.tree, '-m', `choo-choo share: ${bundle.title}`], '')).trim()
  await git(cwd, ['update-ref', `${SHARE_REF}/${bundle.id}`, commit])
  return commit
}

/** Snapshots the workspace and pushes the share. Replaces an earlier version of the same share. */
export async function publish(cwd: string, bundle: ShareBundle, remote = 'origin'): Promise<string> {
  const commit = await writeShareCommit(cwd, bundle)
  await git(cwd, ['push', '--quiet', remote, `+${commit}:${SHARE_REF}/${bundle.id}`])
  return commit
}

export async function unpublish(cwd: string, id: string, remote = 'origin') {
  await git(cwd, ['push', '--quiet', remote, `:${SHARE_REF}/${id}`])
  try {
    await git(cwd, ['update-ref', '-d', `${SHARE_REF}/${id}`])
  } catch {
    /* already gone */
  }
}

async function readBundle(cwd: string, ref: string): Promise<ShareBundle> {
  const b = JSON.parse(await git(cwd, ['show', `${ref}:share.json`])) as ShareBundle
  if (b.version !== 1 || !Array.isArray(b.chats)) throw new Error('This share was made by a newer version of Choo Choo')
  return b
}

/** Fetches one share into the local repo. */
export async function fetchShare(cwd: string, id: string, remote = 'origin'): Promise<{ bundle: ShareBundle; ref: string }> {
  const ref = `${IMPORT_REF}/${id}`
  try {
    await git(cwd, ['fetch', '--quiet', '--no-tags', remote, `+${SHARE_REF}/${id}:${ref}`])
  } catch {
    throw new Error('Could not fetch that share. It may have been unshared, or you may not have access to the repository.')
  }
  return { bundle: await readBundle(cwd, ref), ref }
}

/** Every share in the remote, newest first, without their transcripts. */
export async function listShares(cwd: string, remote = 'origin'): Promise<ShareInfo[]> {
  const heads = await git(cwd, ['ls-remote', remote, `${SHARE_REF}/*`])
  if (!heads.trim()) return []
  await git(cwd, ['fetch', '--quiet', '--no-tags', remote, `+${SHARE_REF}/*:${IMPORT_REF}/*`])
  const out: ShareInfo[] = []
  for (const line of heads.split('\n').filter(Boolean)) {
    const id = line.split('\t')[1]?.slice(SHARE_REF.length + 1)
    if (!id) continue
    try {
      const b = await readBundle(cwd, `${IMPORT_REF}/${id}`)
      out.push({ id, title: b.title, branch: b.branch, sharedBy: b.sharedBy, sharedAt: b.sharedAt, chats: b.chats.length })
    } catch {
      /* skip shares we can't read */
    }
  }
  return out.sort((a, b) => b.sharedAt - a.sharedAt)
}

/**
 * Creates a worktree for a fetched share: the branch starts at the sharer's HEAD and their
 * uncommitted work is laid on top as uncommitted changes, just as they had it.
 */
export async function checkoutShare(repo: string, path: string, branch: string, ref: string) {
  const snap = `${ref}^1`
  const head = `${ref}^1^1`
  await git(repo, ['worktree', 'add', '-b', branch, path, head])
  await git(path, ['checkout', snap, '--', '.'])
  const deleted = (await git(path, ['diff', '--name-only', '--diff-filter=D', head, snap])).split('\n').filter(Boolean)
  if (deleted.length) await git(path, ['rm', '-q', '--', ...deleted])
  await git(path, ['reset', '-q'])
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  try {
    await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}
