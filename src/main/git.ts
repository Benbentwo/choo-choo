import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DiffStats, FileChange, GrepHit } from '@shared/types'
import type { PrHeadSync } from '@shared/prReview'

const exec = promisify(execFile)

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args)
  } catch {
    return null
  }
}

export async function repoRoot(path: string): Promise<string> {
  return (await git(path, ['rev-parse', '--show-toplevel'])).trim()
}

export async function defaultBranch(repo: string): Promise<string> {
  const remoteHead = await tryGit(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (remoteHead) return remoteHead.trim().replace(/^origin\//, '')
  for (const b of ['main', 'master']) {
    if (await tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])) return b
  }
  const cur = await tryGit(repo, ['branch', '--show-current'])
  return cur?.trim() || 'main'
}

/** The ref new worktrees branch from: origin/<default> when it exists, else the local branch. */
export async function baseRefFor(repo: string, branch: string): Promise<string> {
  await tryGit(repo, ['fetch', 'origin', branch, '--quiet'])
  if (await tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])) {
    return `origin/${branch}`
  }
  return branch
}

export async function branchPrefix(repo: string): Promise<string> {
  const gh = (await tryGit(repo, ['config', 'github.user']))?.trim()
  const name = gh || (await tryGit(repo, ['config', 'user.name']))?.trim() || 'choo'
  return name.replace(/[^A-Za-z0-9._-]+/g, '-')
}

export async function addWorktree(repo: string, path: string, branch: string, baseRef: string) {
  await git(repo, ['worktree', 'add', '-b', branch, path, baseRef])
}

export async function removeWorktree(repo: string, path: string) {
  await tryGit(repo, ['worktree', 'remove', '--force', path])
  await tryGit(repo, ['worktree', 'prune'])
}

async function mergeBase(cwd: string, baseRef: string): Promise<string> {
  const mb = await tryGit(cwd, ['merge-base', 'HEAD', baseRef])
  return mb?.trim() || 'HEAD'
}

async function countLines(file: string): Promise<number> {
  try {
    const buf = await readFile(file)
    if (buf.includes(0)) return 0 // binary
    if (buf.length === 0) return 0
    let n = 0
    for (const b of buf) if (b === 10) n++
    return buf[buf.length - 1] === 10 ? n : n + 1
  } catch {
    return 0
  }
}

/** Files changed in the worktree versus where it branched from, including uncommitted and untracked work. */
export async function changes(cwd: string, baseRef: string): Promise<FileChange[]> {
  const base = await mergeBase(cwd, baseRef)
  const [nameStatus, numstat, untracked] = await Promise.all([
    git(cwd, ['diff', '--name-status', '-M', base]),
    git(cwd, ['diff', '--numstat', '-M', base]),
    git(cwd, ['ls-files', '--others', '--exclude-standard'])
  ])
  const counts = new Map<string, [number, number]>()
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [a, d, ...rest] = line.split('\t')
    const p = normalizeRenamePath(rest.join('\t'))
    counts.set(p, [Number(a) || 0, Number(d) || 0])
  }
  const out: FileChange[] = []
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const parts = line.split('\t')
    const code = parts[0][0] as FileChange['status']
    const p = parts[parts.length - 1]
    const [additions, deletions] = counts.get(p) ?? [0, 0]
    out.push({ path: p, status: code === 'C' as string ? 'A' : code, additions, deletions })
  }
  for (const p of untracked.split('\n').filter(Boolean)) {
    out.push({ path: p, status: 'U', additions: await countLines(join(cwd, p)), deletions: 0 })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** numstat prints renames as `dir/{old => new}/f` or `old => new`. Return the new path. */
export function normalizeRenamePath(p: string): string {
  const brace = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/)
  if (brace) return (brace[1] + brace[3] + brace[4]).replace(/\/\//g, '/')
  const arrow = p.split(' => ')
  return arrow.length === 2 ? arrow[1] : p
}

export function summarize(files: FileChange[]): DiffStats {
  return files.reduce(
    (s, f) => ({ additions: s.additions + f.additions, deletions: s.deletions + f.deletions, files: s.files + 1 }),
    { additions: 0, deletions: 0, files: 0 }
  )
}

export async function fileDiff(cwd: string, baseRef: string, file: string): Promise<string> {
  const tracked = await tryGit(cwd, ['ls-files', '--error-unmatch', '--', file])
  if (tracked === null) {
    // Untracked: diff against nothing. --no-index exits 1 when files differ.
    try {
      return await git(cwd, ['diff', '--no-index', '--', '/dev/null', file])
    } catch (e) {
      return (e as { stdout?: string }).stdout ?? ''
    }
  }
  const base = await mergeBase(cwd, baseRef)
  return git(cwd, ['diff', '-M', base, '--', file])
}

/** Tracked plus untracked (not ignored) files, for @mentions. */
export async function listFiles(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard'])
  return [...new Set(out.split('\n').filter(Boolean))]
}

/** Renames a branch that has not been pushed yet. Returns false when it was left alone. */
export async function renameBranch(cwd: string, from: string, to: string): Promise<boolean> {
  if (await tryGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${from}`])) return false
  if (await tryGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${to}`])) return false
  return (await tryGit(cwd, ['branch', '-m', from, to])) !== null
}

/**
 * Snapshots the whole working tree (tracked, modified and untracked files) as a dangling commit,
 * without touching the index or HEAD. Returns the commit and the HEAD it sits on.
 */
export async function snapshot(cwd: string): Promise<{ head: string; tree: string } | null> {
  const head = (await tryGit(cwd, ['rev-parse', 'HEAD']))?.trim()
  if (!head) return null
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'choo-idx-'))
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') }
  try {
    await exec('git', ['read-tree', head], { cwd, env })
    await exec('git', ['add', '-A'], { cwd, env, maxBuffer: 64 * 1024 * 1024 })
    const tree = (await exec('git', ['write-tree'], { cwd, env })).stdout.trim()
    const commit = (await exec('git', ['commit-tree', tree, '-p', head, '-m', 'choo-choo checkpoint'], { cwd, env })).stdout.trim()
    // Keep it reachable so gc does not collect it.
    await git(cwd, ['update-ref', `refs/choo-choo/checkpoints/${commit}`, commit])
    return { head, tree: commit }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Puts the worktree back exactly as it was at a snapshot. */
export async function restore(cwd: string, snap: { head: string; tree: string }) {
  await git(cwd, ['reset', '-q', '--hard', snap.head])
  await git(cwd, ['clean', '-qfd'])
  await git(cwd, ['checkout', snap.tree, '--', '.'])
  await git(cwd, ['reset', '-q'])
}

/** Creates a new repo with one empty commit, so worktrees can branch from it. */
export async function initRepo(dest: string) {
  await exec('git', ['init', '-b', 'main', dest])
  await exec('git', ['-C', dest, 'commit', '--allow-empty', '-m', 'Initial commit'])
}

export async function clone(url: string, dest: string) {
  await exec('git', ['clone', url, dest], { maxBuffer: 64 * 1024 * 1024 })
}

export function repoNameFromUrl(url: string): string {
  const m = url.trim().replace(/\/+$/, '').replace(/\.git$/, '').match(/([^/:]+)$/)
  return m ? m[1] : 'repo'
}

/** Remote branches on origin, most recently committed first. */
export async function remoteBranches(repo: string): Promise<{ name: string; when: string }[]> {
  await tryGit(repo, ['fetch', 'origin', '--prune', '--quiet'])
  const out = await tryGit(repo, ['for-each-ref', 'refs/remotes/origin', '--sort=-committerdate', '--format=%(refname:short)%09%(committerdate:relative)'])
  return (out ?? '')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .filter(([n]) => n !== 'origin/HEAD' && n !== 'origin')
    .map(([n, when]) => ({ name: n.replace(/^origin\//, ''), when }))
}

/** Checks out branch `name` into a new worktree, creating a local tracking branch from origin when needed. */
export async function addWorktreeForRemoteBranch(repo: string, path: string, name: string) {
  await tryGit(repo, ['worktree', 'prune'])
  if (await tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) {
    await git(repo, ['worktree', 'add', path, name])
  } else {
    await tryGit(repo, ['fetch', 'origin', name, '--quiet'])
    await git(repo, ['worktree', 'add', '--track', '-b', name, path, `origin/${name}`])
  }
}

/**
 * Checks out a same-repo PR's branch into a new worktree. A merged PR's branch is usually deleted from
 * GitHub, so when origin no longer has it the PR head is fetched from `pull/<n>/head` instead. An existing
 * local branch is always used as is, so local commits are never overwritten.
 */
export async function addWorktreeForPrBranch(repo: string, path: string, number: number, name: string) {
  await tryGit(repo, ['worktree', 'prune'])
  if (await tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) {
    await git(repo, ['worktree', 'add', path, name])
  } else if ((await tryGit(repo, ['fetch', 'origin', name, '--quiet'])) !== null) {
    await git(repo, ['worktree', 'add', '--track', '-b', name, path, `origin/${name}`])
  } else {
    await addWorktreeForPull(repo, path, number, name)
  }
}

/** Fetches a PR head (works for forks) into local branch `local` and checks it out into a new worktree. */
export async function addWorktreeForPull(repo: string, path: string, number: number, local: string) {
  await tryGit(repo, ['worktree', 'prune'])
  await git(repo, ['fetch', 'origin', `+pull/${number}/head:${local}`])
  await git(repo, ['worktree', 'add', path, local])
}

/** Checks out an existing branch into a new worktree (used to restore an archived workspace). */
export async function addWorktreeForBranch(repo: string, path: string, branch: string) {
  await tryGit(repo, ['worktree', 'prune'])
  await git(repo, ['worktree', 'add', path, branch])
}

/**
 * Brings a branch's new commits on the remote into the worktree. Fast-forwards when it can; with unpushed
 * local commits it merges, and backs out if that conflicts. Uncommitted edits stay, or git refuses.
 */
export async function pullBranch(cwd: string, branch: string) {
  if ((await currentBranch(cwd)) !== branch) {
    // Another branch of the stack is checked out: move this one's ref without touching the files.
    await git(cwd, ['fetch', 'origin', `${branch}:${branch}`]).catch((e) => { throw fail(e) })
    return
  }
  const upstream = await tryGit(cwd, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])
  const from = upstream ? [] : ['origin', branch]
  if ((await tryGit(cwd, ['pull', '--ff-only', ...from])) !== null) return
  try {
    await git(cwd, ['pull', '--no-rebase', '--no-edit', ...from])
  } catch (e) {
    await tryGit(cwd, ['merge', '--abort'])
    throw fail(e)
  }
}

const fail = (e: unknown) => new Error(((e as { stderr?: string }).stderr || (e as Error).message).trim())

/** Makes sure `sha` is in the local repo, fetching the PR's head (works for forks) when it isn't. */
async function haveCommit(cwd: string, sha: string, prNumber: number): Promise<boolean> {
  if ((await tryGit(cwd, ['cat-file', '-e', `${sha}^{commit}`])) !== null) return true
  await tryGit(cwd, ['fetch', '--quiet', 'origin', `refs/pull/${prNumber}/head`])
  if ((await tryGit(cwd, ['cat-file', '-e', `${sha}^{commit}`])) !== null) return true
  // A commit the PR no longer points at, e.g. one you reviewed before a force-push. GitHub serves it by id.
  await tryGit(cwd, ['fetch', '--quiet', 'origin', sha])
  return (await tryGit(cwd, ['cat-file', '-e', `${sha}^{commit}`])) !== null
}

const count = async (cwd: string, range: string) => Number((await tryGit(cwd, ['rev-list', '--count', range]))?.trim() ?? 0) || 0

/**
 * Brings a review worktree to the PR's head commit after its author pushed. `how`:
 * - `check` only reports where the worktree stands;
 * - `ff` fast-forwards when the worktree has no commits of its own (uncommitted edits stay, or git refuses);
 * - `reset` moves to the PR's head after a force-push with `git reset --keep`, which keeps uncommitted
 *   edits and refuses when they'd be overwritten. Commits left behind stay in the reflog.
 */
export async function followPrHead(cwd: string, prNumber: number, prHead: string, how: 'check' | 'ff' | 'reset'): Promise<PrHeadSync> {
  const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  if (head === prHead) return { state: 'current', head }
  if (!(await haveCommit(cwd, prHead, prNumber))) {
    return { state: 'behind', head, prHead, commits: 0, local: 0, reason: 'Couldn\'t fetch the PR\'s new commits from GitHub.' }
  }
  const commits = await count(cwd, `${head}..${prHead}`)
  const local = await count(cwd, `${prHead}..${head}`)
  // Already has everything the PR has, plus its own commits: nothing to take.
  if (!commits) return { state: 'current', head }
  if (!local) {
    if (how === 'check') return { state: 'behind', head, prHead, commits, local }
    try {
      await git(cwd, ['merge', '--ff-only', '--quiet', prHead])
    } catch (e) {
      return { state: 'behind', head, prHead, commits, local, reason: `Git couldn't update the files: ${fail(e).message}` }
    }
    return { state: 'updated', head: prHead, from: head, commits }
  }
  if (how !== 'reset') {
    return { state: 'diverged', head, prHead, commits, local, reason: `The PR's history changed (force-pushed or rebased), and this worktree has ${local} commit${local === 1 ? '' : 's'} that ${local === 1 ? 'isn\'t' : 'aren\'t'} on it.` }
  }
  try {
    await git(cwd, ['reset', '--keep', prHead])
  } catch (e) {
    return { state: 'diverged', head, prHead, commits, local, reason: `Git couldn't switch: ${fail(e).message}` }
  }
  return { state: 'updated', head: prHead, from: head, commits }
}

/** `git diff -U0` of each file between two commits, for moving line comments from one to the other. */
export async function rangeDiffs(cwd: string, from: string, to: string, files: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  // A file left out means git couldn't diff it (e.g. `from` is gone); the caller treats that as changed.
  for (const f of files) {
    const d = await tryGit(cwd, ['diff', '-U0', '--no-color', from, to, '--', f])
    if (d !== null) out[f] = d
  }
  return out
}

/** Files and commits between `sha` (e.g. the commit you last reviewed) and HEAD. Null when `sha` can't be found. */
export async function changedSince(cwd: string, sha: string, prNumber: number): Promise<{ commits: number; files: FileChange[] } | null> {
  if (!(await haveCommit(cwd, sha, prNumber))) return null
  const [nameStatus, numstat] = await Promise.all([git(cwd, ['diff', '--name-status', '-M', sha, 'HEAD']), git(cwd, ['diff', '--numstat', '-M', sha, 'HEAD'])])
  const counts = new Map<string, [number, number]>()
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [a, d, ...rest] = line.split('\t')
    counts.set(normalizeRenamePath(rest.join('\t')), [Number(a) || 0, Number(d) || 0])
  }
  const files = nameStatus
    .split('\n')
    .filter(Boolean)
    .map((line): FileChange => {
      const parts = line.split('\t')
      const p = parts[parts.length - 1]
      const [additions, deletions] = counts.get(p) ?? [0, 0]
      const code = parts[0][0]
      return { path: p, status: (code === 'C' ? 'A' : code) as FileChange['status'], additions, deletions }
    })
  return { commits: await count(cwd, `${sha}..HEAD`), files }
}

export async function currentBranch(cwd: string): Promise<string | null> {
  return (await tryGit(cwd, ['branch', '--show-current']))?.trim() || null
}

/** The PR a branch was checked out from, when it tracks refs/pull/<n>/head (what `gh pr checkout` sets up for fork PRs). */
export async function pullNumberOf(cwd: string, branch: string): Promise<number | null> {
  const merge = (await tryGit(cwd, ['config', '--get', `branch.${branch}.merge`]))?.trim()
  const n = merge?.match(/^refs\/pull\/(\d+)\/head$/)?.[1]
  return n ? Number(n) : null
}

/** Moves a worktree folder, keeping uncommitted and untracked files. Fails for worktrees with submodules. */
export async function moveWorktree(repo: string, from: string, to: string) {
  await git(repo, ['worktree', 'move', from, to])
}

/** Searches tracked and untracked files for a fixed string, case-insensitively. */
export async function grep(cwd: string, query: string, limit = 200): Promise<GrepHit[]> {
  if (!query.trim()) return []
  const out = await tryGit(cwd, ['grep', '-n', '-I', '-i', '-F', '--untracked', '--max-count', '20', '-e', query])
  if (!out) return []
  const hits: GrepHit[] = []
  for (const l of out.split('\n')) {
    const m = l.match(/^(.+?):(\d+):(.*)$/)
    if (!m) continue
    hits.push({ path: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 200) })
    if (hits.length >= limit) break
  }
  return hits
}

/** The GitHub owner of the origin remote (https or ssh), or '' when origin isn't on github.com. */
export async function githubOwner(repo: string): Promise<string> {
  const url = (await tryGit(repo, ['config', '--get', 'remote.origin.url']))?.trim() ?? ''
  return url.match(/github\.com[:/]([^/]+)\//i)?.[1] ?? ''
}
