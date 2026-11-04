import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as g from '../src/main/git'
import { buildTree } from '../src/renderer/src/components/RightTabs'

describe('checkpoints', () => {
  it('snapshots and restores tracked, modified and untracked files', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'snap-'))
    await g.git(repo, ['init', '-q', '-b', 'main'])
    await g.git(repo, ['config', 'user.email', 't@t'])
    await g.git(repo, ['config', 'user.name', 't'])
    writeFileSync(join(repo, 'a.txt'), 'v1\n')
    await g.git(repo, ['add', '.'])
    await g.git(repo, ['commit', '-qm', 'i'])
    writeFileSync(join(repo, 'a.txt'), 'v2\n')
    writeFileSync(join(repo, 'draft.txt'), 'draft\n')
    const snap = await g.snapshot(repo)
    expect(snap).not.toBeNull()
    // Snapshot must not disturb the index.
    expect(await g.git(repo, ['diff', '--cached', '--name-only'])).toBe('')

    // The agent then changes things, including a commit and new files.
    writeFileSync(join(repo, 'a.txt'), 'v3\n')
    writeFileSync(join(repo, 'later.txt'), 'later\n')
    await g.git(repo, ['add', '.'])
    await g.git(repo, ['commit', '-qm', 'agent'])

    await g.restore(repo, snap!)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2\n')
    expect(readFileSync(join(repo, 'draft.txt'), 'utf8')).toBe('draft\n')
    expect(existsSync(join(repo, 'later.txt'))).toBe(false)
    expect((await g.git(repo, ['rev-parse', 'HEAD'])).trim()).toBe(snap!.head)
    expect(await g.git(repo, ['diff', '--cached', '--name-only'])).toBe('')
  })
})

describe('misc', () => {
  it('derives repo names from URLs', () => {
    expect(g.repoNameFromUrl('https://github.com/Benbentwo/choo-choo.git')).toBe('choo-choo')
    expect(g.repoNameFromUrl('git@github.com:Benbentwo/weddingsite')).toBe('weddingsite')
  })
  it('builds a file tree', () => {
    const t = buildTree(['a/b.ts', 'a/c/d.ts', 'e.md'])
    expect([...t.children!.keys()]).toEqual(['a', 'e.md'])
    expect([...t.children!.get('a')!.children!.keys()]).toEqual(['b.ts', 'c'])
  })
})

describe('restore', () => {
  it('re-adds a worktree for an archived branch with its commits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'restore-'))
    const repo = join(root, 'repo')
    await g.git(root, ['init', '-q', '-b', 'main', repo])
    await g.git(repo, ['config', 'user.email', 't@t'])
    await g.git(repo, ['config', 'user.name', 't'])
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    await g.git(repo, ['add', '.'])
    await g.git(repo, ['commit', '-qm', 'i'])
    const wt = join(root, 'wt', 'oslo')
    await g.addWorktree(repo, wt, 'me/oslo', 'main')
    writeFileSync(join(wt, 'b.txt'), 'b\n')
    await g.git(wt, ['add', '.'])
    await g.git(wt, ['commit', '-qm', 'work'])
    await g.removeWorktree(repo, wt)
    expect(existsSync(wt)).toBe(false)
    await g.addWorktreeForBranch(repo, wt, 'me/oslo')
    expect(readFileSync(join(wt, 'b.txt'), 'utf8')).toBe('b\n')
  })
})
