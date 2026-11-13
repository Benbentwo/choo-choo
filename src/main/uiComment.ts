// Comment mode (⌘⇧K): a note about the app's own UI, sent to whatever can act on it.
// - dev (`npm run dev`): written to .feedback/ in the running checkout, where Claude Code picks it up live.
// - packaged: opens a workspace on choo-choo itself (cloned, or forked when the person can't push),
//   or opens a prefilled GitHub issue.
import { app, clipboard, ClipboardItem, ipcMain, shell, type BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Chat, Repo, Workspace } from '@shared/types'
import {
  UPSTREAM_REPO,
  commentPrompt,
  commentSlug,
  commentTargets,
  defaultCommentTarget,
  isUpstreamRemote,
  issueUrl,
  type BuildInfo,
  type CommentInfo,
  type CommentPayload,
  type CommentResult,
  type CommentSubmit
} from '@shared/uiComment'

const exec = promisify(execFile)

declare const __BUILD_COMMIT__: string

export interface UiCommentDeps {
  getWin(): BrowserWindow | null
  repos(): Repo[]
  reposRoot: string
  addRepo(path: string): Promise<Repo>
  createWorkspace(repoId: string, opts: { baseRef: string; branch: string }): Promise<{ workspace: Workspace; chat: Chat }>
  sendToChat(chat: Chat, text: string, images: string[]): void
}

export function buildInfo(): BuildInfo {
  const commit = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : ''
  return { version: app.getVersion(), commit, packaged: app.isPackaged }
}

export function registerUiComment(deps: UiCommentDeps) {
  ipcMain.handle('uiComment:info', (): CommentInfo => {
    const b = buildInfo()
    return {
      ...b,
      targets: commentTargets(b.packaged),
      defaultTarget: defaultCommentTarget(b.packaged)
    }
  })
  ipcMain.handle('uiComment:submit', async (_e, p: CommentSubmit): Promise<CommentResult> => {
    const win = deps.getWin()
    if (!win) throw new Error('no window')
    if (!p?.comment?.trim()) throw new Error('Write a comment first')
    if (!commentTargets(app.isPackaged).includes(p.target)) throw new Error(`Can't send comments to ${p.target} in this build`)
    const shots = await capture(win, p.rect)
    if (p.target === 'local') return { target: 'local', id: writeLocal(p, shots, win) }
    if (p.target === 'issue') {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(shots.element)], { type: 'image/png' }) })])
      const url = issueUrl(p, buildInfo(), `macOS ${process.getSystemVersion()}`)
      await shell.openExternal(url)
      return { target: 'issue', url }
    }
    return openWorkspace(deps, p, shots)
  })
}

type Shots = { element: Buffer; full: Buffer }

async function capture(win: BrowserWindow, rect: CommentPayload['rect']): Promise<Shots> {
  const pad = 24
  const [w, h] = win.getContentSize()
  const x = Math.max(0, Math.floor(rect.x - pad))
  const y = Math.max(0, Math.floor(rect.y - pad))
  const crop = {
    x,
    y,
    width: Math.min(w - x, Math.ceil(rect.width + pad * 2)),
    height: Math.min(h - y, Math.ceil(rect.height + pad * 2))
  }
  const [full, el] = await Promise.all([win.webContents.capturePage(), win.webContents.capturePage(crop)])
  return { element: el.toPNG(), full: full.toPNG() }
}

/** Dev: .feedback/<id>.json plus screenshots in the checkout running the app. */
function writeLocal(p: CommentSubmit, shots: Shots, win: BrowserWindow): string {
  const dir = join(process.cwd(), '.feedback')
  mkdirSync(dir, { recursive: true })
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const [w, h] = win.getContentSize()
  writeFileSync(join(dir, `${id}.full.png`), shots.full)
  writeFileSync(join(dir, `${id}.element.png`), shots.element)
  const { target: _t, includeFull: _f, ...payload } = p
  // Write the JSON last: its appearance is the signal that the comment is complete.
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, ...payload, window: { width: w, height: h } }, null, 2))
  return id
}

async function openWorkspace(deps: UiCommentDeps, p: CommentSubmit, shots: Shots): Promise<CommentResult> {
  const { repo, fork } = await chooChooRepo(deps)
  const remote = fork ? 'upstream' : 'origin'
  await git(repo.path, ['fetch', remote, 'main', '--quiet']).catch(() => undefined)
  const baseRef = (await git(repo.path, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/main`]).catch(() => null))
    ? `${remote}/main`
    : repo.defaultBranch
  const branch = await freeBranch(repo.path, `comment/${commentSlug(p.comment)}`)
  const { workspace, chat } = await deps.createWorkspace(repo.id, {
    baseRef,
    branch
  })
  const images = [`data:image/png;base64,${shots.element.toString('base64')}`]
  const names = ['a screenshot of the element']
  if (p.includeFull) {
    images.push(`data:image/png;base64,${shots.full.toString('base64')}`)
    names.push('the whole window')
  }
  deps.sendToChat(chat, commentPrompt(p, buildInfo(), { fork, baseRef, images: names }), images)
  return {
    target: 'workspace',
    workspaceId: workspace.id,
    chatId: chat.id,
    branch
  }
}

/** A choo-choo checkout to branch from: one already added, else a fresh clone (of a fork without push access). */
async function chooChooRepo(deps: UiCommentDeps): Promise<{ repo: Repo; fork: boolean }> {
  for (const r of deps.repos()) {
    if (r.hidden || !existsSync(r.path)) continue
    if (isUpstreamRemote(await remoteUrl(r.path, 'origin'))) return { repo: r, fork: false }
    if (isUpstreamRemote(await remoteUrl(r.path, 'upstream'))) return { repo: r, fork: true }
  }
  for (const r of deps.repos()) {
    if (!existsSync(r.path)) continue
    if (isUpstreamRemote(await remoteUrl(r.path, 'origin'))) return { repo: await deps.addRepo(r.path), fork: false }
  }
  const perms = await gh(['api', `repos/${UPSTREAM_REPO}`, '--jq', '.permissions.push']).catch(() => {
    throw new Error('Sign in to GitHub first (run `gh auth login` in a terminal), or send the comment as a GitHub issue.')
  })
  const push = perms.trim() === 'true'
  const slug = push ? UPSTREAM_REPO : (await gh(['api', '-X', 'POST', `repos/${UPSTREAM_REPO}/forks`, '--jq', '.full_name'])).trim()
  mkdirSync(deps.reposRoot, { recursive: true })
  let dest = join(deps.reposRoot, 'choo-choo')
  for (let n = 2; existsSync(dest); n++) dest = join(deps.reposRoot, `choo-choo-${n}`)
  // A fork can take a few seconds to exist after it's created.
  for (let attempt = 0; ; attempt++) {
    try {
      await gh(['repo', 'clone', slug, dest])
      break
    } catch (err) {
      if (push || attempt >= 4) throw err
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  if (!push) {
    // gh adds `upstream` when cloning a fork; make sure it exists and that `gh pr create` targets it.
    if (!(await remoteUrl(dest, 'upstream'))) await git(dest, ['remote', 'add', 'upstream', `https://github.com/${UPSTREAM_REPO}.git`])
    await git(dest, ['config', 'remote.upstream.gh-resolved', 'base'])
  }
  return { repo: await deps.addRepo(dest), fork: !push }
}

async function freeBranch(repo: string, want: string): Promise<string> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? want : `${want}-${n}`
    const taken = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).then(
      () => true,
      () => false
    )
    if (!taken) return name
  }
}

async function remoteUrl(cwd: string, name: string): Promise<string> {
  return (await git(cwd, ['remote', 'get-url', name]).catch(() => '')).trim()
}

async function git(cwd: string, args: string[]) {
  return (await exec('git', args, { cwd })).stdout
}

async function gh(args: string[]) {
  return (await exec('gh', args, { maxBuffer: 64 * 1024 * 1024 })).stdout
}
