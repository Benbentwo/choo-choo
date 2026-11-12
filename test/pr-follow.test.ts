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
const head = async (dir: string) => (await g.git(dir, ['rev-parse', 'HEAD'])).trim()

/** `theirs` is the PR author's clone, `mine` the review worktree; the bare repo stands in for GitHub. */
beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), 'choo-follow-'))
  const remote = join(root, 'remote.git')
  const [m, t] = [join(root, 'mine'), join(root, 'theirs')]
  await g.git(root, ['init', '-q', '--bare', '-b', 'main', remote])
  // GitHub serves commits by id; a local bare repo needs telling.
  await g.git(remote, ['config', 'uploadpack.allowAnySHA1InWant', 'true'])
  for (const dir of [t, m]) {
    if (dir === m) await g.git(root, ['clone', '-q', '-b', 'feat', remote, dir])
    else await g.git(root, ['clone', '-q', remote, dir])
    await g.git(dir, ['config', 'user.email', 't@t'])
    await g.git(dir, ['config', 'user.name', 'Test User'])
    if (dir === t) {
      await g.git(t, ['checkout', '-qb', 'feat'])
      await commit(t, 'a.txt', 'one\ntwo\nthree\n')
      await g.git(t, ['push', '-qu', 'origin', 'feat'])
    }
  }
  mine = m
  theirs = t
}, 60_000)

describe('followPrHead', () => {
  it('reports, then fast-forwards to the author\'s new commit and keeps uncommitted edits', async () => {
    const before = await head(mine)
    await commit(theirs, 'b.txt', 'new\n')
    await g.git(theirs, ['push', '-q'])
    const prHead = await head(theirs)
    writeFileSync(join(mine, 'scratch.txt'), 'mine\n')

    const check = await g.followPrHead(mine, 1, prHead, 'check')
    expect(check).toMatchObject({ state: 'behind', commits: 1, local: 0 })
    expect(await head(mine)).toBe(before)

    const r = await g.followPrHead(mine, 1, prHead, 'ff')
    expect(r).toEqual({ state: 'updated', head: prHead, from: before, commits: 1 })
    expect(readFileSync(join(mine, 'b.txt'), 'utf8')).toBe('new\n')
    expect(readFileSync(join(mine, 'scratch.txt'), 'utf8')).toBe('mine\n')
    expect(await g.followPrHead(mine, 1, prHead, 'ff')).toEqual({ state: 'current', head: prHead })
  })

  it('won\'t fast-forward over a force-push, and switches with reset when asked', async () => {
    await g.git(theirs, ['commit', '-q', '--amend', '-m', 'rewritten'])
    await g.git(theirs, ['push', '-qf'])
    const prHead = await head(theirs)

    const r = await g.followPrHead(mine, 1, prHead, 'ff')
    expect(r).toMatchObject({ state: 'diverged', commits: 1, local: 1 })
    const done = await g.followPrHead(mine, 1, prHead, 'reset')
    expect(done).toMatchObject({ state: 'updated', head: prHead })
    expect(await head(mine)).toBe(prHead)
  })
})

describe('rangeDiffs and changedSince', () => {
  it('diffs files between commits and lists what changed since a review', async () => {
    const reviewed = await head(mine)
    await commit(theirs, 'a.txt', 'zero\none\ntwo\nthree\n')
    await g.git(theirs, ['push', '-q'])
    const prHead = await head(theirs)
    await g.followPrHead(mine, 1, prHead, 'ff')

    const d = await g.rangeDiffs(mine, reviewed, prHead, ['a.txt'])
    expect(d['a.txt']).toContain('@@ -0,0 +1 @@')
    const since = await g.changedSince(mine, reviewed, 1)
    expect(since).toEqual({ commits: 1, files: [{ path: 'a.txt', status: 'M', additions: 1, deletions: 0 }] })
    expect(await g.changedSince(mine, '0'.repeat(40), 1)).toBeNull()
  })
})
