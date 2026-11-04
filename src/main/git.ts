import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DiffStats, FileChange } from '@shared/types'

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
