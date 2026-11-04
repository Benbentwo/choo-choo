import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as g from '../src/main/git'

let repo: string
let wt: string

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'choo-'))
  repo = join(root, 'repo')
  mkdirSync(repo)
  await g.git(repo, ['init', '-q', '-b', 'main'])
  await g.git(repo, ['config', 'user.email', 't@t'])
  await g.git(repo, ['config', 'user.name', 'Test User'])
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(repo, 'gone.txt'), 'bye\n')
  await g.git(repo, ['add', '.'])
  await g.git(repo, ['commit', '-qm', 'init'])
  wt = join(root, 'wt', 'dallas')
  await g.addWorktree(repo, wt, 'test-user/dallas', 'main')
})

describe('git', () => {
  it('detects default branch and prefix', async () => {
    expect(await g.defaultBranch(repo)).toBe('main')
    expect(await g.baseRefFor(repo, 'main')).toBe('main')
    expect(await g.branchPrefix(repo)).toBe('Test-User')
  })

  it('lists committed, uncommitted and untracked changes against the base', async () => {
    writeFileSync(join(wt, 'a.txt'), 'one\nTWO\nthree\nfour\n')
    await g.git(wt, ['rm', '-q', 'gone.txt'])
    await g.git(wt, ['commit', '-qam', 'edit'])
    writeFileSync(join(wt, 'a.txt'), 'one\nTWO\nthree\nfour\nfive\n')
    mkdirSync(join(wt, 'scripts'))
    writeFileSync(join(wt, 'scripts', 'new.mjs'), 'x\ny\n')
    const ch = await g.changes(wt, 'main')
    expect(ch).toEqual([
      { path: 'a.txt', status: 'M', additions: 3, deletions: 1 },
      { path: 'gone.txt', status: 'D', additions: 0, deletions: 1 },
      { path: 'scripts/new.mjs', status: 'U', additions: 2, deletions: 0 }
    ])
    expect(g.summarize(ch)).toEqual({ additions: 5, deletions: 2, files: 3 })
  })

  it('diffs tracked and untracked files', async () => {
    expect(await g.fileDiff(wt, 'main', 'a.txt')).toContain('+TWO')
    expect(await g.fileDiff(wt, 'main', 'scripts/new.mjs')).toContain('+x')
  })

  it('normalizes rename paths', () => {
    expect(g.normalizeRenamePath('src/{a => b}/f.ts')).toBe('src/b/f.ts')
    expect(g.normalizeRenamePath('old.ts => new.ts')).toBe('new.ts')
    expect(g.normalizeRenamePath('{ => sub}/f.ts')).toBe('sub/f.ts')
  })

  it('removes worktrees', async () => {
    await g.removeWorktree(repo, wt)
    expect(await g.git(repo, ['worktree', 'list'])).not.toContain('dallas')
  })
})
