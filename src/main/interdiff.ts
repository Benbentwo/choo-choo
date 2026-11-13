import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { matchesAny, type Interdiff } from '@shared/reviewUpdates'

const exec = promisify(execFile)

async function run(cwd: string, args: string[], env?: NodeJS.ProcessEnv, input?: string): Promise<string> {
  const p = exec('git', args, { cwd, maxBuffer: 128 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env })
  if (input !== undefined) {
    p.child.stdin?.end(input)
  }
  return (await p).stdout
}

async function tryRun(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    return await run(cwd, args, env)
  } catch {
    return null
  }
}

const has = async (cwd: string, sha: string) => (await tryRun(cwd, ['cat-file', '-e', `${sha}^{commit}`])) !== null

/** Makes sure a commit is here, fetching the PR's head (works for forks) or the commit itself. */
export async function ensureCommit(cwd: string, sha: string, prNumber?: number): Promise<boolean> {
  if (await has(cwd, sha)) return true
  if (prNumber) {
    await tryRun(cwd, ['fetch', '--quiet', 'origin', `refs/pull/${prNumber}/head`])
    if (await has(cwd, sha)) return true
  }
  // A commit the PR no longer points at (before a force-push): GitHub still serves it by id.
  await tryRun(cwd, ['fetch', '--quiet', 'origin', sha])
  return has(cwd, sha)
}

/** The base branch as a local ref, fetched fresh when possible. */
async function baseRef(cwd: string, base: string): Promise<string | null> {
  await tryRun(cwd, ['fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`])
  for (const r of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
    if ((await tryRun(cwd, ['rev-parse', '--verify', '--quiet', r])) !== null) return r
  }
  return null
}

const mergeBase = async (cwd: string, a: string, b: string) => (await tryRun(cwd, ['merge-base', a, b]))?.trim() || null

interface Replayed {
  /** The old PR's changes replayed onto the new base, as a tree. */
  tree: string
  /** Files whose old changes didn't apply to the new base. */
  conflicts: string[]
  baseFrom: string
  baseTo: string
}

const replays = new Map<string, Promise<Replayed | null>>()

/**
 * The PR as it was at `from`, replayed onto the base it has at `to`. Diffing that against `to`
 * shows only what the author changed: whatever came in from the base branch is on both sides.
 * Works with any git: a throwaway index, `git apply --cached`, `git write-tree`.
 */
function replay(cwd: string, from: string, to: string, base: string): Promise<Replayed | null> {
  const key = `${cwd}\0${from}\0${to}\0${base}`
  let p = replays.get(key)
  if (!p) {
    p = doReplay(cwd, from, to, base).catch(() => null)
    replays.set(key, p)
    if (replays.size > 200) replays.delete(replays.keys().next().value as string)
  }
  return p
}

async function doReplay(cwd: string, from: string, to: string, base: string): Promise<Replayed | null> {
  const ref = await baseRef(cwd, base)
  if (!ref) return null
  const baseFrom = await mergeBase(cwd, ref, from)
  const baseTo = await mergeBase(cwd, ref, to)
  if (!baseFrom || !baseTo) return null
  if (baseFrom === baseTo) return { tree: (await run(cwd, ['rev-parse', `${from}^{tree}`])).trim(), conflicts: [], baseFrom, baseTo }
  const dir = mkdtempSync(join(tmpdir(), 'choo-interdiff-'))
  const env = { GIT_INDEX_FILE: join(dir, 'index') }
  try {
    await run(cwd, ['read-tree', baseTo], env)
    const patch = await run(cwd, ['diff', '--binary', '--full-index', '--no-renames', baseFrom, from])
    const conflicts: string[] = []
    if (patch.trim()) {
      const whole = await applyCached(cwd, patch, env)
      if (!whole) {
        // Some files clash with the new base: apply file by file and note the ones that don't go in.
        const files = (await run(cwd, ['diff', '--name-only', '--no-renames', baseFrom, from])).split('\n').filter(Boolean)
        for (const f of files) {
          const one = await run(cwd, ['diff', '--binary', '--full-index', '--no-renames', baseFrom, from, '--', f])
          if (!(await applyCached(cwd, one, env))) conflicts.push(f)
        }
      }
    }
    const tree = (await run(cwd, ['write-tree'], env)).trim()
    return { tree, conflicts, baseFrom, baseTo }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function applyCached(cwd: string, patch: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await run(cwd, ['apply', '--cached', '--binary', '-'], env, patch)
    return true
  } catch {
    return false
  }
}

function parseNameStatus(nameStatus: string, numstat: string) {
  const counts = new Map<string, [number, number]>()
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [a, d, ...rest] = line.split('\t')
    counts.set(rest.join('\t'), [Number(a) || 0, Number(d) || 0])
  }
  return nameStatus
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      const path = parts[parts.length - 1]
      const [additions, deletions] = counts.get(path) ?? [0, 0]
      const code = parts[0][0]
      const status = (code === 'A' || code === 'D' || code === 'R' ? code : 'M') as Interdiff['files'][number]['status']
      return { path, status, additions, deletions }
    })
}

const count = async (cwd: string, range: string) => Number((await tryRun(cwd, ['rev-list', '--count', range]))?.trim() ?? 0) || 0

/**
 * What the author changed in the PR between two of its commits, leaving out what came from the base
 * branch. Null when a commit can't be found. Falls back to the plain diff between the heads when the
 * base can't be worked out.
 */
export async function interdiff(cwd: string, opts: { from: string; to: string; base: string; prNumber?: number; ignore?: string[] }): Promise<Interdiff | null> {
  const { from, to, base, prNumber, ignore = [] } = opts
  if (!(await ensureCommit(cwd, from, prNumber)) || !(await ensureCommit(cwd, to, prNumber))) return null
  const commits = await count(cwd, `${from}..${to}`)
  const ancestor = (await tryRun(cwd, ['merge-base', '--is-ancestor', from, to])) !== null
  const r = await replay(cwd, from, to, base)
  const left = r?.tree ?? from
  const [ns, num] = await Promise.all([run(cwd, ['diff', '--name-status', '--no-renames', left, to]), run(cwd, ['diff', '--numstat', '--no-renames', left, to])])
  let files = parseNameStatus(ns, num)
  if (r?.conflicts.length) {
    // For files that didn't replay, the replayed tree has the new base's version: use the plain diff instead.
    const plain = parseNameStatus(
      await run(cwd, ['diff', '--name-status', '--no-renames', from, to, '--', ...r.conflicts]),
      await run(cwd, ['diff', '--numstat', '--no-renames', from, to, '--', ...r.conflicts])
    )
    files = [...files.filter((f) => !r.conflicts.includes(f.path)), ...plain]
  }
  const between = (await run(cwd, ['diff', '--name-only', '--no-renames', from, to])).split('\n').filter(Boolean)
  const counted = new Set(files.map((f) => f.path))
  const ignored = files.filter((f) => matchesAny(f.path, ignore)).map((f) => f.path)
  files = files.filter((f) => !ignored.includes(f.path)).sort((a, b) => a.path.localeCompare(b.path))
  const baseCommits = r && r.baseFrom !== r.baseTo ? await count(cwd, `${r.baseFrom}..${r.baseTo}`) : 0
  return {
    from,
    to,
    files,
    commits,
    baseCommits,
    leftOut: between.filter((f) => !counted.has(f)).sort(),
    ignored: ignored.sort(),
    kind: !ancestor ? 'rebase' : baseCommits ? 'base-merge' : 'push',
    exact: !!r && !r.conflicts.length
  }
}

/** The interdiff of one file, as a unified diff the diff view can show. */
export async function interdiffFile(cwd: string, opts: { from: string; to: string; base: string; prNumber?: number; file: string }): Promise<string> {
  const { from, to, base, prNumber, file } = opts
  if (!(await ensureCommit(cwd, from, prNumber)) || !(await ensureCommit(cwd, to, prNumber))) return ''
  const r = await replay(cwd, from, to, base)
  const left = r && !r.conflicts.includes(file) ? r.tree : from
  return run(cwd, ['diff', '--no-renames', left, to, '--', file])
}
