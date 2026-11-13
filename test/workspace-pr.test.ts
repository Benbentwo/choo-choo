import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Workspace } from '../src/shared/types'
import { followPrBase, prRef, syncWorkspaceBranch } from '../src/main/workspacePr'
import { diffBase, targetBranch } from '../src/shared/stack'
import { prForBranch } from '../src/main/github'

const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

// A workspace whose agent checks out an existing PR itself (what an orchestrator-started agent does)
// should show that PR, not "Create PR". Real git, and a stand-in gh (test/fixtures/fake-gh.cjs).
describe('workspace follows the branch its agent checked out', () => {
  let root: string
  let wt: string
  const ws = (): Workspace => ({ id: 'w', repoId: 'r', name: 'oslo', branch: 'me/oslo', baseRef: 'main', path: wt, title: 'oslo', createdAt: 0 })

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'choo-wspr-'))
    const repo = join(root, 'repo')
    mkdirSync(repo)
    run(repo, 'init', '-q', '-b', 'main')
    run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
    run(repo, 'branch', 'feature/existing')
    run(repo, 'branch', 'contributor-fix')
    // What `gh pr checkout 77` sets up for a fork PR.
    run(repo, 'config', 'branch.contributor-fix.merge', 'refs/pull/77/head')
    wt = join(root, 'oslo')
    run(repo, 'worktree', 'add', '-q', '-b', 'me/oslo', wt, 'main')

    const bin = join(root, 'bin')
    mkdirSync(bin)
    symlinkSync(resolve(__dirname, 'fixtures/fake-gh.cjs'), join(bin, 'gh'))
    process.env.PATH = `${bin}:${process.env.PATH}`
    const state = join(root, 'gh.json')
    process.env.FAKE_GH_STATE = state
    writeFileSync(state, JSON.stringify({ prs: { 'feature/existing': { number: 42, state: 'OPEN', title: 'Existing work' }, 'someone:fix': { number: 77, state: 'OPEN', title: 'Fork fix' } } }))
  })

  it('leaves a workspace alone while it is on its own branch', async () => {
    const w = ws()
    expect(await syncWorkspaceBranch(w)).toBe(false)
    expect(w.branch).toBe('me/oslo')
    expect(await prForBranch(w.path, prRef(w))).toBeNull()
  })

  it('adopts the PR of a branch the agent switched to', async () => {
    run(wt, 'checkout', '-q', 'feature/existing')
    const w = ws()
    expect(await syncWorkspaceBranch(w)).toBe(true)
    expect(w.branch).toBe('feature/existing')
    expect(w.prNumber).toBeUndefined()
    expect((await prForBranch(w.path, prRef(w)))?.number).toBe(42)
  })

  it('finds a fork PR checked out with gh pr checkout by its number', async () => {
    run(wt, 'checkout', '-q', 'contributor-fix')
    const w = { ...ws(), branch: 'feature/existing' }
    expect(await syncWorkspaceBranch(w)).toBe(true)
    expect(w.prNumber).toBe(77)
    expect(prRef(w)).toBe('77')
    expect((await prForBranch(w.path, prRef(w)))?.title).toBe('Fork fix')
  })

  it('drops a PR number that belonged to the previous branch', async () => {
    run(wt, 'checkout', '-q', 'feature/existing')
    const w = { ...ws(), branch: 'contributor-fix', prNumber: 77 }
    expect(await syncWorkspaceBranch(w)).toBe(true)
    expect(w.prNumber).toBeUndefined()
    expect(prRef(w)).toBe('feature/existing')
  })

  it('compares with the branch an open PR merges into, not the one the workspace started from', async () => {
    const pr = { number: 5, url: '', state: 'OPEN' as const, isDraft: false, title: 't', baseRefName: 'release' }
    const w = ws()
    expect(await followPrBase(w, root + '/repo', pr)).toBe(true)
    expect(w.baseRef).toBe('release') // no origin in this repo, so the local branch
    expect(diffBase(w)).toBe('release')
    expect(await followPrBase(w, root + '/repo', pr)).toBe(false)
    const onOrigin = { ...ws(), baseRef: 'origin/release' }
    expect(await followPrBase(onOrigin, root + '/repo', pr)).toBe(false)
    const merged = ws()
    expect(await followPrBase(merged, root + '/repo', { ...pr, state: 'MERGED' })).toBe(false)
    expect(merged.baseRef).toBe('main')
    const stacked = { ...ws(), stack: { layers: [{ branch: 'me/oslo' }], autoRestack: false } }
    expect(await followPrBase(stacked, root + '/repo', pr)).toBe(false)
  })

  it('compares a stacked branch with the one below it', () => {
    const stack = { layers: [{ branch: 'a' }, { branch: 'b' }], autoRestack: false }
    expect(diffBase({ ...ws(), baseRef: 'origin/main', branch: 'a', stack })).toBe('origin/main')
    expect(diffBase({ ...ws(), baseRef: 'origin/main', branch: 'b', stack })).toBe('a')
    expect(targetBranch({ ...ws(), baseRef: 'origin/develop' })).toBe('develop')
  })

  it('never touches stacks or orchestrators, which manage their own branch', async () => {
    run(wt, 'checkout', '-q', 'contributor-fix')
    const stacked = { ...ws(), stack: { layers: [{ branch: 'me/oslo' }], autoRestack: false } }
    const orch = { ...ws(), orchestrator: true }
    expect(await syncWorkspaceBranch(stacked)).toBe(false)
    expect(await syncWorkspaceBranch(orch)).toBe(false)
    expect(stacked.branch).toBe('me/oslo')
    expect(prRef({ ...stacked, prNumber: 9 })).toBe('me/oslo')
  })
})
