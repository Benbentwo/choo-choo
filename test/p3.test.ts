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
