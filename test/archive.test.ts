import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as g from '../src/main/git'

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'choo-arch-'))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  await g.git(repo, ['init', '-q', '-b', 'main'])
  await g.git(repo, ['config', 'user.email', 't@t'])
  await g.git(repo, ['config', 'user.name', 'T'])
  writeFileSync(join(repo, 'a.txt'), 'hello world\nsecond line\n')
  await g.git(repo, ['add', '.'])
  await g.git(repo, ['commit', '-qm', 'init'])
  const wt = join(root, 'workspaces', 'repo', 'paris')
  await g.addWorktree(repo, wt, 't/paris', 'main')
  return { root, repo, wt }
}

describe('archive', () => {
  it('moves a worktree to the archive and back, keeping uncommitted and untracked files', async () => {
    const { root, repo, wt } = await setup()
    writeFileSync(join(wt, 'a.txt'), 'changed\n')
    writeFileSync(join(wt, 'new.txt'), 'untracked\n')
    const archived = join(root, 'archive', 'repo', 'paris-1234')
    mkdirSync(join(archived, '..'), { recursive: true })
    await g.moveWorktree(repo, wt, archived)
    expect(existsSync(wt)).toBe(false)
    await g.moveWorktree(repo, archived, wt)
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('changed\n')
    expect(readFileSync(join(wt, 'new.txt'), 'utf8')).toBe('untracked\n')
    expect((await g.git(wt, ['branch', '--show-current'])).trim()).toBe('t/paris')
  })

  it('searches tracked and untracked files', async () => {
    const { wt } = await setup()
    writeFileSync(join(wt, 'notes.md'), 'nothing\nHello again\n')
    const hits = await g.grep(wt, 'hello')
    expect(hits).toEqual([
      { path: 'a.txt', line: 1, text: 'hello world' },
      { path: 'notes.md', line: 2, text: 'Hello again' }
    ])
    expect(await g.grep(wt, 'zzz-not-there')).toEqual([])
  })
})
