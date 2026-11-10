import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as g from '../src/main/git'

let mine: string
let theirs: string

const commit = async (dir: string, file: string, text: string) => {
  writeFileSync(join(dir, file), text)
  await g.git(dir, ['add', '.'])
  await g.git(dir, ['commit', '-qm', `${file}: ${text.trim()}`])
}

/** A remote with a `feat` branch, checked out in two clones: `mine` is the worktree, `theirs` stands in for GitHub. */
beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), 'choo-pull-'))
  const remote = join(root, 'remote.git')
  const [m, t] = [join(root, 'mine'), join(root, 'theirs')]
  await g.git(root, ['init', '-q', '--bare', '-b', 'main', remote])
  for (const dir of [m, t]) {
    await g.git(root, ['clone', '-q', remote, dir])
    await g.git(dir, ['config', 'user.email', 't@t'])
    await g.git(dir, ['config', 'user.name', 'Test User'])
  }
  await g.git(m, ['checkout', '-qb', 'feat'])
  await commit(m, 'a.txt', 'one\n')
  await g.git(m, ['push', '-qu', 'origin', 'feat'])
  await g.git(t, ['fetch', '-q'])
  await g.git(t, ['checkout', '-q', 'feat'])
  await commit(t, 'b.txt', 'from the base\n')
  await g.git(t, ['push', '-q'])
  mine = m
  theirs = t
  // Around twenty git processes: slow when the machine is busy.
}, 60_000)

describe('pullBranch', () => {
  it('fast-forwards the worktree and keeps uncommitted edits', async () => {
    writeFileSync(join(mine, 'a.txt'), 'edited\n')
    await g.pullBranch(mine, 'feat')
    expect(readFileSync(join(mine, 'b.txt'), 'utf8')).toBe('from the base\n')
    expect(readFileSync(join(mine, 'a.txt'), 'utf8')).toBe('edited\n')
  })
  it('merges when there are unpushed commits', async () => {
    await commit(mine, 'c.txt', 'local\n')
    await g.pullBranch(mine, 'feat')
    expect(readFileSync(join(mine, 'b.txt'), 'utf8')).toBe('from the base\n')
    expect(readFileSync(join(mine, 'c.txt'), 'utf8')).toBe('local\n')
  })
  it('backs out of a conflicting merge and says why', async () => {
    await commit(mine, 'b.txt', 'mine\n')
    const head = (await g.git(mine, ['rev-parse', 'HEAD'])).trim()
    await expect(g.pullBranch(mine, 'feat')).rejects.toThrow()
    expect((await g.git(mine, ['rev-parse', 'HEAD'])).trim()).toBe(head)
    expect((await g.git(mine, ['status', '--porcelain'])).trim()).toBe('')
  })
  it('moves the ref when another branch is checked out', async () => {
    await g.git(mine, ['checkout', '-qb', 'other'])
    await g.pullBranch(mine, 'feat')
    expect((await g.git(mine, ['rev-parse', 'feat'])).trim()).toBe((await g.git(theirs, ['rev-parse', 'feat'])).trim())
  })
})
