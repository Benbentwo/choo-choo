import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Chat, FeedbackOptions, GithubStack, MergeThroughResult, PrInfo, Stack, StackJob, StackLayerStatus, StackStatus, Workspace } from '@shared/types'
import { advanceStep, bottomFirst, feedbackSteps, githubLinkPlan, layerIndex, mergedBottom, mergeThroughPrs, nextLayerBranch, parentRef, prBaseFor, restackConflictPrompt, stackFeedbackPrompt } from '@shared/stack'
import { summarizeChecks } from '@shared/prStatus'
import * as gh from './github'

/**
 * Stacked PRs: several branches in one worktree, each built on the one below. Restacking rebases each
 * branch's own commits (those after the parent commit it was built on) onto its parent's new tip.
 * One worktree per stack, because git won't rebase a branch that is checked out in another worktree.
 * See docs/prd/stacked-prs.md and docs/decisions/0010-one-worktree-per-stack.md.
 */

const exec = promisify(execFile)
/** Never open an editor: rebase --continue keeps the original messages. */
const ENV = { ...process.env, GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' }

async function g(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, env: ENV, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}
async function tryG(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await g(cwd, args)
  } catch {
    return null
  }
}
const sha = async (cwd: string, ref: string) => (await tryG(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]))?.trim() || null
const isAncestor = async (cwd: string, a: string, b: string) => (await tryG(cwd, ['merge-base', '--is-ancestor', a, b])) !== null
const current = async (cwd: string) => (await tryG(cwd, ['branch', '--show-current']))?.trim() || ''

/** Tracked changes not yet committed. Untracked files don't block switching branches. */
export async function isDirty(cwd: string): Promise<boolean> {
  return !!(await g(cwd, ['status', '--porcelain', '--untracked-files=no'])).trim()
}

export async function rebaseInProgress(cwd: string): Promise<boolean> {
  for (const d of ['rebase-merge', 'rebase-apply']) {
    const p = (await tryG(cwd, ['rev-parse', '--git-path', d]))?.trim()
    if (p && existsSync(resolve(cwd, p))) return true
  }
  return false
}

const conflicted = async (cwd: string) => (await g(cwd, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean)

export interface Host {
  save(): void
  /** The stack's state changed; tell the window. */
  changed(wsId: string): void
  sendToChat(chat: Chat, text: string): void
  isRunning(chatId: string): boolean
  stopChat(chatId: string): void
  findChat(id: string): Chat | undefined
  /** A line in the chat, e.g. "Restacked #122 and #123". */
  note(chat: Chat, text: string): void
  defaultBranch(ws: Workspace): string
}

let host: Host

export function init(h: Host) {
  host = h
}

// One stack operation at a time per workspace: two rebases in one worktree would trip over each other.
const locks = new Map<string, Promise<unknown>>()
function locked<T>(wsId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(wsId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(wsId, next.catch(() => {}))
  return next
}

function need(ws: Workspace): Stack {
  if (!ws.stack) throw new Error('This workspace is not a stack')
  return ws.stack
}

/** Makes the workspace a stack of one, the branch it's on. */
async function ensureStack(ws: Workspace): Promise<Stack> {
  if (ws.stack) return ws.stack
  const base = (await tryG(ws.path, ['merge-base', 'HEAD', ws.baseRef]))?.trim()
  ws.stack = { layers: [{ branch: ws.branch, parentSha: base || undefined }], autoRestack: true }
  return ws.stack
}

/** Adds a branch on top of the top PR and checks it out. */
export function addLayer(ws: Workspace) {
  return locked(ws.id, async () => {
    if (await rebaseInProgress(ws.path)) throw new Error('Finish the restack in progress first')
    const st = await ensureStack(ws)
    const top = st.layers[st.layers.length - 1].branch
    const here = await current(ws.path)
    if (here !== top && (await isDirty(ws.path))) throw new Error(`Commit the changes on ${here} before adding a PR on top`)
    const refs = new Set((await g(ws.path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin'])).split('\n').map((r) => r.replace(/^origin\//, '')))
    const name = nextLayerBranch(st, (n) => refs.has(n))
    const tip = await sha(ws.path, top)
    if (!tip) throw new Error(`Branch ${top} is missing`)
    // From the top branch itself, uncommitted work comes along to the new branch.
    await g(ws.path, here === top ? ['checkout', '-b', name] : ['checkout', '-b', name, top])
    st.layers.push({ branch: name, parentSha: tip })
    ws.branch = name
    host.save()
    host.changed(ws.id)
  })
}

/** Checks out another PR of the stack, so the agent works on that one. */
export function switchLayer(ws: Workspace, branch: string) {
  return locked(ws.id, () => checkout(ws, branch))
}

async function checkout(ws: Workspace, branch: string) {
  const st = need(ws)
  if (layerIndex(st, branch) < 0) throw new Error(`${branch} is not in this stack`)
  if (await rebaseInProgress(ws.path)) throw new Error('Finish the restack in progress first')
  const here = await current(ws.path)
  if (here !== branch) {
    if (await isDirty(ws.path)) throw new Error(`Commit or stash the changes on ${here} first`)
    await g(ws.path, ['checkout', branch])
  }
  ws.branch = branch
  host.save()
  host.changed(ws.id)
}

export interface RestackResult {
  conflict?: { branch: string; parent: string; files: string[] }
  rewritten: string[]
  pushed: string[]
  dropped: string[]
}

/**
 * Rebases every PR whose parent moved onto the parent's tip, bottom up, then pushes the PRs that
 * changed and points each PR at the branch below it. `ontoBase` also moves the bottom PR onto the
 * latest base branch, first dropping bottom PRs that already merged. Picks up a rebase that stopped.
 */
export function restack(ws: Workspace, ontoBase = false): Promise<RestackResult> {
  return locked(ws.id, () => restackNow(ws, ontoBase))
}

async function restackNow(ws: Workspace, ontoBase: boolean): Promise<RestackResult> {
  const st = need(ws)
  const cwd = ws.path
  const out: RestackResult = { rewritten: [], pushed: [], dropped: [] }

  if (await rebaseInProgress(cwd)) {
    const parent = st.restacking ? parentRef(st, Math.max(0, layerIndex(st, st.restacking.branch)), ws.baseRef) : ''
    let files = await conflicted(cwd)
    if (!files.length) {
      try {
        await g(cwd, ['rebase', '--continue'])
      } catch (e) {
        files = await conflicted(cwd)
        if (!files.length) throw e
      }
    }
    if (files.length) return { ...out, conflict: { branch: st.restacking?.branch ?? (await current(cwd)), parent, files } }
    if (st.restacking) {
      const l = st.layers.find((x) => x.branch === st.restacking!.branch)
      if (l) l.parentSha = st.restacking.newParent
      out.rewritten.push(st.restacking.branch)
    }
  }
  if (await isDirty(cwd)) throw new Error(`Commit the changes on ${await current(cwd)} before restacking`)
  const home = st.restacking?.home ?? (await current(cwd))
  st.restacking = undefined

  if (ontoBase) {
    const baseBranch = ws.baseRef.replace(/^origin\//, '')
    await tryG(cwd, ['fetch', 'origin', baseBranch, '--quiet'])
    const prs = await Promise.all(st.layers.map((l) => gh.prForBranch(cwd, l.branch)))
    const n = Math.min(mergedBottom(prs), st.layers.length - 1)
    for (let i = 0; i < n; i++) {
      const gone = st.layers.shift()!
      // The merged branch's newest commit is what the squash took in, so the next PR keeps only commits after it.
      const tip = (await sha(cwd, `origin/${gone.branch}`)) ?? (await sha(cwd, gone.branch))
      if (tip && (await isAncestor(cwd, st.layers[0].parentSha ?? tip, tip))) st.layers[0].parentSha = tip
      out.dropped.push(gone.branch)
    }
  }

  for (let i = 0; i < st.layers.length; i++) {
    if (i === 0 && !ontoBase) continue
    const layer = st.layers[i]
    const parent = parentRef(st, i, ws.baseRef)
    const tip = await sha(cwd, parent)
    if (!tip) throw new Error(`Can't find ${parent}`)
    const old = layer.parentSha ?? (await tryG(cwd, ['merge-base', parent, layer.branch]))?.trim()
    if (old === tip) continue
    if (!old || (await isAncestor(cwd, tip, layer.branch))) {
      // Already built on the parent's tip (say the agent merged it in): just remember that.
      layer.parentSha = tip
      continue
    }
    st.restacking = { branch: layer.branch, newParent: tip, home }
    host.save()
    try {
      await g(cwd, ['rebase', '--onto', tip, old, layer.branch])
    } catch (e) {
      const files = await conflicted(cwd)
      if (files.length) {
        host.changed(ws.id)
        return { ...out, conflict: { branch: layer.branch, parent, files } }
      }
      await tryG(cwd, ['rebase', '--abort'])
      st.restacking = undefined
      host.save()
      throw e
    }
    layer.parentSha = tip
    st.restacking = undefined
    out.rewritten.push(layer.branch)
  }

  const back = layerIndex(st, home) >= 0 ? home : st.layers[0].branch
  if ((await current(cwd)) !== back) await g(cwd, ['checkout', back])
  ws.branch = back
  host.save()

  // Push every PR branch that's on origin and differs from it, then point each PR at the branch below.
  for (const l of st.layers) {
    const remote = await sha(cwd, `origin/${l.branch}`)
    if (!remote || remote === (await sha(cwd, l.branch))) continue
    if ((await tryG(cwd, ['push', '--force-with-lease', 'origin', l.branch])) !== null) out.pushed.push(l.branch)
  }
  await fixPrBases(ws)
  host.changed(ws.id)
  return out
}

async function prView(cwd: string, branch: string): Promise<(PrInfo & { baseRefName?: string }) | null> {
  try {
    const { stdout } = await exec('gh', ['pr', 'view', branch, '--json', 'number,url,state,isDraft,title,mergeable,reviewDecision,mergeStateStatus,baseRefName'], { cwd, timeout: 20_000 })
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

/** Each open PR should merge into the branch below it (the bottom one into the default branch). */
async function fixPrBases(ws: Workspace) {
  const st = need(ws)
  await Promise.all(
    st.layers.map(async (l) => {
      const pr = await prView(ws.path, l.branch)
      const want = prBaseFor(st, l.branch, host.defaultBranch(ws))
      if (pr?.state === 'OPEN' && pr.baseRefName && pr.baseRefName !== want) {
        await exec('gh', ['pr', 'edit', String(pr.number), '--base', want], { cwd: ws.path }).catch(() => {})
      }
    })
  )
}

/** Everything the Stack tab shows. Also follows a branch switch made outside the app. */
export async function status(ws: Workspace): Promise<StackStatus | null> {
  const st = ws.stack
  if (!st) return null
  const cwd = ws.path
  const here = await current(cwd)
  if (here && here !== ws.branch && layerIndex(st, here) >= 0) {
    ws.branch = here
    host.save()
    host.changed(ws.id)
  }
  const rebasing = await rebaseInProgress(cwd)
  const layers = await Promise.all(
    st.layers.map(async (l, i): Promise<StackLayerStatus> => {
      const parent = parentRef(st, i, ws.baseRef)
      const [tip, ptip, remote, pr] = await Promise.all([sha(cwd, l.branch), sha(cwd, parent), sha(cwd, `origin/${l.branch}`), prView(cwd, l.branch)])
      const [behind, commits, comments, checks] = await Promise.all([
        tip && ptip ? isAncestor(cwd, ptip, tip).then((a) => !a) : Promise.resolve(false),
        tryG(cwd, ['rev-list', '--count', `${parent}..${l.branch}`]).then((n) => Number(n?.trim()) || 0),
        pr?.state === 'OPEN' ? gh.prComments(cwd, pr.number).then((c) => c.length, () => 0) : Promise.resolve(0),
        pr?.state === 'OPEN' ? gh.checks(cwd, l.branch).then(summarizeChecks) : Promise.resolve(null)
      ])
      if (pr) l.pr = { number: pr.number, title: pr.title }
      return {
        branch: l.branch,
        sha: tip ?? '',
        behind,
        commits,
        pushed: !!remote,
        unpushed: !!remote && remote !== tip,
        pr,
        comments,
        checks: checks ? { total: checks.total, failed: checks.failed.length, pending: checks.pending } : { total: 0, failed: 0, pending: 0 }
      }
    })
  )
  host.save()
  const conflict = rebasing ? { branch: st.restacking?.branch ?? here, files: await conflicted(cwd) } : undefined
  const open = openPrs(layers)
  const [github, ghStackCli] = await Promise.all([open.length ? githubStackFor(cwd, open[0]) : Promise.resolve(null), hasGhStack()])
  return { current: here, base: ws.baseRef, dirty: await isDirty(cwd), conflict, layers, job: jobs.get(ws.id)?.view, github, ghStackCli }
}

// ---- GitHub's stacked pull requests: link the stack, merge through a PR ----

const API = ['-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2026-03-10']

/** Open PR numbers, bottom first. */
const openPrs = (layers: StackLayerStatus[]) => layers.filter((l) => l.pr?.state === 'OPEN').map((l) => l.pr!.number)

interface ApiStack {
  number: number
  pull_requests?: { number: number; state?: string; merged_at?: string | null }[]
}
const toStack = (s: ApiStack): GithubStack => ({ number: s.number, prs: (s.pull_requests ?? []).filter((p) => !p.merged_at && p.state !== 'closed').map((p) => p.number) })

/** The GitHub stack that holds this PR, null if none, 'unavailable' if this repo has no stacks API. */
export async function githubStackFor(cwd: string, pr: number): Promise<GithubStack | null | 'unavailable'> {
  try {
    const { stdout } = await exec('gh', ['api', ...API, `repos/{owner}/{repo}/stacks?pull_request=${pr}`], { cwd, timeout: 20_000 })
    const list = JSON.parse(stdout) as ApiStack[]
    return Array.isArray(list) && list[0] ? toStack(list[0]) : null
  } catch {
    return 'unavailable'
  }
}

/** Creates the stack on GitHub from the open PRs, or appends the PRs GitHub's stack is missing. */
export function linkGithub(ws: Workspace): Promise<GithubStack> {
  return locked(ws.id, async () => {
    const st = need(ws)
    const prs: number[] = []
    for (const l of st.layers) {
      const pr = await prView(ws.path, l.branch)
      if (pr?.state === 'MERGED') continue
      if (pr?.state !== 'OPEN') throw new Error(`Open a PR for ${l.branch} first`)
      prs.push(pr.number)
    }
    if (prs.length < 2) throw new Error('A GitHub stack needs at least two open PRs')
    const theirs = await githubStackFor(ws.path, prs[0])
    if (theirs === 'unavailable') throw new Error("GitHub's stacked pull requests aren't available for this repository")
    const plan = githubLinkPlan(prs, theirs)
    if (plan.action === 'mismatch') throw new Error(`#${prs[0]} is already in GitHub stack #${theirs!.number} with different PRs. Unstack it on GitHub first.`)
    if (plan.action === 'none') return theirs!
    const path = plan.action === 'create' ? 'repos/{owner}/{repo}/stacks' : `repos/{owner}/{repo}/stacks/${theirs!.number}/add`
    const fields = plan.prs.flatMap((n) => ['-F', `pull_requests[]=${n}`])
    const { stdout } = await exec('gh', ['api', ...API, '-X', 'POST', path, ...fields], { cwd: ws.path, timeout: 30_000 }).catch((e) => {
      throw new Error(`GitHub didn't accept the stack: ${ghError(e)}`)
    })
    host.changed(ws.id)
    return toStack(JSON.parse(stdout) as ApiStack)
  })
}

const ghError = (e: unknown) => ((e as { stderr?: string }).stderr || (e as Error).message || '').trim().split('\n').slice(-3).join(' ')

let ghStackCache = false
/** GitHub's `gh stack` extension is installed. Once seen, it's remembered; until then each status asks again. */
export async function hasGhStack(): Promise<boolean> {
  if (ghStackCache) return true
  try {
    const { stdout } = await exec('gh', ['extension', 'list'], { timeout: 10_000 })
    ghStackCache = /\bgh-stack\b/.test(stdout)
  } catch {
    ghStackCache = false
  }
  return ghStackCache
}

/** For tests: forget that gh-stack was seen. */
export function forgetGhStack() {
  ghStackCache = false
}

export async function installCli() {
  try {
    await exec('gh', ['extension', 'install', 'github/gh-stack'], { timeout: 120_000 })
  } catch (e) {
    const msg = ghError(e)
    if (!/already installed/i.test(msg)) throw new Error(`Couldn't install gh-stack: ${msg}`)
  }
  ghStackCache = true
}

/**
 * Merges the PR on `branch` and every open PR below it in one step, through GitHub's stack merge (all or
 * none, merge-queue aware), then drops the merged branches from the bottom of the stack.
 */
export function mergeThrough(ws: Workspace, branch: string): Promise<MergeThroughResult> {
  return locked(ws.id, async () => {
    const st = need(ws)
    const cwd = ws.path
    const i = layerIndex(st, branch)
    if (i < 0) throw new Error(`${branch} is not in this stack`)
    if (jobs.has(ws.id)) throw new Error('Wait for the stack job to finish')
    if (await rebaseInProgress(cwd)) throw new Error('Finish the restack in progress first')
    if (await isDirty(cwd)) throw new Error(`Commit the changes on ${await current(cwd)} first`)
    const s = await status(ws)
    if (!s) throw new Error('This workspace is not a stack')
    const pick = mergeThroughPrs(s.layers, i)
    if ('why' in pick) throw new Error(pick.why)
    const gs = s.github
    if (!gs || gs === 'unavailable' || githubLinkPlan(openPrs(s.layers), gs).action !== 'none') throw new Error('Link the stack on GitHub first')
    if (!(await hasGhStack())) throw new Error('Install gh-stack first')

    const top = pick.prs[pick.prs.length - 1]
    try {
      await exec('gh', ['stack', 'merge', String(top), '--squash', '--yes'], { cwd, timeout: 5 * 60_000 })
    } catch (e) {
      throw new Error(`GitHub didn't merge the stack: ${ghError(e)}`)
    }

    // The merge runs in the background on GitHub (or waits in the merge queue): watch the top PR for a while.
    let merged = false
    for (let t = 0; t < 30 && !merged; t++) {
      merged = (await prView(cwd, branch))?.state === 'MERGED'
      if (!merged) await new Promise((r) => setTimeout(r, t < 5 ? 1000 : 3000))
    }
    if (!merged) {
      host.changed(ws.id)
      return { merged: [], queued: true, dropped: [] }
    }
    const dropped = await afterMerge(ws)
    host.changed(ws.id)
    return { merged: pick.prs, queued: false, dropped }
  })
}

/**
 * After GitHub merged the bottom of the stack: take GitHub's rebased branches for the PRs above (it
 * retargets them onto the base), drop the merged branches, and leave the worktree on a live PR.
 */
async function afterMerge(ws: Workspace): Promise<string[]> {
  const st = need(ws)
  const cwd = ws.path
  const baseBranch = ws.baseRef.replace(/^origin\//, '')
  const before = new Map<string, string | null>()
  for (const l of st.layers) before.set(l.branch, await sha(cwd, l.branch))
  await tryG(cwd, ['fetch', 'origin', baseBranch, ...st.layers.map((l) => `+refs/heads/${l.branch}:refs/remotes/origin/${l.branch}`), '--quiet'])

  const prs = await Promise.all(st.layers.map((l) => prView(cwd, l.branch)))
  const n = mergedBottom(prs)
  const dropped = st.layers.slice(0, n).map((l) => l.branch)
  const home = await current(cwd)

  if (n >= st.layers.length) {
    // Everything merged: the stack is done. Leave the workspace on the top branch like any merged PR.
    st.layers = st.layers.slice(-1)
    st.layers[0].parentSha = (await sha(cwd, ws.baseRef)) ?? undefined
    host.save()
    return dropped.slice(0, -1)
  }

  const rest = st.layers.slice(n)
  const baseTip = await sha(cwd, ws.baseRef)
  // GitHub retargets the PRs above onto the base and rebases them. Take its branches when it did that for
  // every PR left. Merging needed every branch pushed, so the local branches hold nothing GitHub lacks.
  let adopt = !!baseTip
  for (const l of rest) {
    if (!adopt) break
    const remote = await sha(cwd, `origin/${l.branch}`)
    adopt = !!remote && (await isAncestor(cwd, baseTip!, remote))
  }
  if (adopt) {
    st.layers = rest
    for (let k = 0; k < rest.length; k++) {
      const l = rest[k]
      const remote = (await sha(cwd, `origin/${l.branch}`))!
      if (remote !== before.get(l.branch)) {
        if (l.branch === home) await g(cwd, ['reset', '--hard', remote])
        else await g(cwd, ['branch', '-f', l.branch, remote])
      }
      l.parentSha = k === 0 ? baseTip! : ((await sha(cwd, rest[k - 1].branch)) ?? undefined)
    }
    if (layerIndex(st, home) < 0) await g(cwd, ['checkout', st.layers[0].branch])
  } else {
    // GitHub hasn't rebased the rest (yet): do it here, the same way Sync with main does.
    await restackNow(ws, true)
  }
  ws.branch = await current(cwd)
  host.save()
  return dropped
}

export function setAuto(ws: Workspace, on: boolean) {
  need(ws).autoRestack = on
  host.save()
  host.changed(ws.id)
}

export function dissolve(ws: Workspace) {
  if (jobs.has(ws.id)) throw new Error('Stop the running stack job first')
  ws.stack = undefined
  host.save()
  host.changed(ws.id)
}

// ---- Jobs: work the app drives across several agent turns ----

interface Job {
  view: StackJob
  wsId: string
  /** PRs still to address, bottom first. */
  queue: { branch: string; number: number; url: string }[]
  phase: 'idle' | 'fixing' | 'restack' | 'conflict'
  reply: boolean
  askEach: boolean
  home: string
}

const jobs = new Map<string, Job>()

export function job(wsId: string) {
  return jobs.get(wsId)?.view
}

/** Addresses review feedback on several PRs of the stack, one at a time, bottom first, restacking after each. */
export async function addressFeedback(ws: Workspace, chat: Chat, opts: FeedbackOptions) {
  const st = need(ws)
  if (jobs.has(ws.id)) throw new Error('A stack job is already running')
  if (host.isRunning(chat.id)) throw new Error('Wait for the agent to finish')
  if (await isDirty(ws.path)) throw new Error(`Commit the changes on ${ws.branch} first`)
  const order: { branch: string; number: number; url: string; comments: number }[] = []
  for (const b of bottomFirst(st, opts.branches)) {
    const pr = await prView(ws.path, b)
    if (pr?.state !== 'OPEN') continue
    const n = (await gh.prComments(ws.path, pr.number).catch(() => [])).length
    if (n) order.push({ branch: b, number: pr.number, url: pr.url, comments: n })
  }
  if (!order.length) throw new Error('No open feedback on those PRs')
  const j: Job = {
    view: { kind: 'feedback', chatId: chat.id, steps: feedbackSteps(st, order) },
    wsId: ws.id,
    queue: order.map(({ branch, number, url }) => ({ branch, number, url })),
    phase: 'idle',
    reply: opts.reply,
    askEach: opts.askEach,
    home: await current(ws.path)
  }
  jobs.set(ws.id, j)
  host.changed(ws.id)
  await step(ws, j)
}

export async function continueJob(ws: Workspace) {
  const j = jobs.get(ws.id)
  if (!j) return
  j.view.paused = false
  j.view.error = undefined
  // Retry a failed step from where it stopped.
  j.view.steps = j.view.steps.map((s) => (s.state === 'failed' ? { ...s, state: 'doing' } : s))
  host.changed(ws.id)
  await step(ws, j)
}

export function stopJob(ws: Workspace) {
  const j = jobs.get(ws.id)
  if (!j) return
  jobs.delete(ws.id)
  if (j.phase !== 'idle' && host.isRunning(j.view.chatId)) host.stopChat(j.view.chatId)
  host.changed(ws.id)
}

function fail(ws: Workspace, j: Job, msg: string) {
  j.view.steps = advanceStep(j.view.steps, 'failed')
  j.view.error = msg
  host.changed(ws.id)
}

/** Restacks after a fix; on conflicts hands them to the agent and waits for the next turn. Returns true when clean. */
async function restackStep(ws: Workspace, j: Job, chat: Chat): Promise<boolean> {
  const r = await restack(ws)
  if (r.conflict) {
    if (j.phase === 'conflict') {
      fail(ws, j, `Conflicts are left on ${r.conflict.branch}. Resolve them, then press Continue.`)
      return false
    }
    j.phase = 'conflict'
    host.changed(ws.id)
    host.sendToChat(chat, restackConflictPrompt(r.conflict.branch, r.conflict.parent, r.conflict.files))
    return false
  }
  return true
}

async function step(ws: Workspace, j: Job) {
  const chat = host.findChat(j.view.chatId)
  if (!chat) return fail(ws, j, 'The chat was closed')
  try {
    if (j.phase === 'conflict') {
      if (!(await restackStep(ws, j, chat))) return
      j.view.steps = advanceStep(j.view.steps, 'done')
      j.phase = 'idle'
      if (j.view.kind === 'feedback') {
        j.queue.shift()
        if (j.askEach && j.queue.length) {
          j.view.paused = true
          host.changed(ws.id)
          return
        }
      }
    } else if (j.phase === 'fixing') {
      j.view.steps = advanceStep(j.view.steps, 'done')
      j.phase = 'restack'
    }
    if (j.phase === 'restack') {
      const item = j.queue[0]
      if (layerIndex(need(ws), item.branch) < need(ws).layers.length - 1) {
        if (await isDirty(ws.path)) return fail(ws, j, `The agent left uncommitted changes on ${item.branch}. Commit them, then press Continue.`)
        j.view.steps = advanceStep(j.view.steps, 'doing')
        host.changed(ws.id)
        if (!(await restackStep(ws, j, chat))) return
        j.view.steps = advanceStep(j.view.steps, 'done')
      }
      j.phase = 'idle'
      j.queue.shift()
      if (j.askEach && j.queue.length) {
        j.view.paused = true
        host.changed(ws.id)
        return
      }
    }
    if (j.view.kind === 'restack') {
      jobs.delete(ws.id)
      host.note(chat, 'Restacked the PRs above and pushed them.')
      host.changed(ws.id)
      return
    }
    const item = j.queue[0]
    if (!item) {
      jobs.delete(ws.id)
      if (layerIndex(need(ws), j.home) >= 0 && !(await isDirty(ws.path))) await switchLayer(ws, j.home).catch(() => {})
      host.note(chat, 'Done addressing feedback across the stack.')
      host.changed(ws.id)
      return
    }
    await switchLayer(ws, item.branch)
    const comments = await gh.prComments(ws.path, item.number)
    const st = need(ws)
    j.view.steps = advanceStep(j.view.steps, 'doing')
    j.phase = 'fixing'
    host.changed(ws.id)
    host.sendToChat(chat, stackFeedbackPrompt({ branch: item.branch, index: layerIndex(st, item.branch), total: st.layers.length }, item, comments, j.reply))
  } catch (e) {
    fail(ws, j, (e as Error).message)
  }
}

/** After an agent turn in a stack: drive the running job, or restack the PRs above if they fell behind. */
/** The person stopped the chat a stack job was driving: the job stops too instead of taking its next step. */
export function onTurnStopped(ws: Workspace, chat: Chat) {
  const j = jobs.get(ws.id)
  if (!j || j.view.chatId !== chat.id) return
  jobs.delete(ws.id)
  host.changed(ws.id)
}

export function onTurnDone(ws: Workspace, chat: Chat) {
  if (!ws.stack) return
  // Let the advisor's follow-up (if any) start first; if it does, the next turn's end lands here again.
  setTimeout(() => {
    if (host.isRunning(chat.id)) return
    const j = jobs.get(ws.id)
    if (j) {
      if (j.view.chatId === chat.id && j.phase !== 'idle' && !j.view.paused && !j.view.error) void step(ws, j)
      return
    }
    if (ws.stack?.autoRestack && chat.status !== 'error') void autoRestack(ws, chat)
  }, 400)
}

async function autoRestack(ws: Workspace, chat: Chat) {
  const st = ws.stack
  if (!st) return
  try {
    if ((await rebaseInProgress(ws.path)) || (await isDirty(ws.path))) return
    const i = layerIndex(st, await current(ws.path))
    if (i < 0 || i === st.layers.length - 1) return
    let behind = false
    for (let k = i + 1; k < st.layers.length && !behind; k++) {
      const p = await sha(ws.path, st.layers[k - 1].branch)
      behind = !!p && (st.layers[k].parentSha ?? '') !== p && !(await isAncestor(ws.path, p, st.layers[k].branch))
    }
    if (!behind) return
    const r = await restack(ws)
    if (r.conflict) {
      const j: Job = { view: { kind: 'restack', chatId: chat.id, steps: [{ label: `Resolve conflicts on ${r.conflict.branch}`, state: 'doing' }] }, wsId: ws.id, queue: [], phase: 'conflict', reply: false, askEach: false, home: '' }
      jobs.set(ws.id, j)
      host.changed(ws.id)
      host.sendToChat(chat, restackConflictPrompt(r.conflict.branch, r.conflict.parent, r.conflict.files))
      return
    }
    if (r.rewritten.length) {
      const names = r.rewritten.map((b) => st.layers.find((l) => l.branch === b)?.pr?.number).map((n, k) => (n ? `#${n}` : r.rewritten[k]))
      host.note(chat, `Restacked ${names.join(', ')} on your changes${r.pushed.length ? ' and pushed them' : ''}.`)
    }
  } catch (e) {
    host.note(chat, `Couldn't restack the PRs above: ${(e as Error).message}`)
  }
}

