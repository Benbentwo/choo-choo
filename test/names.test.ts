import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CITIES, namesInUse, pickCityName } from '../src/main/names'
import * as g from '../src/main/git'

async function repo() {
  const root = mkdtempSync(join(tmpdir(), 'choo-names-'))
  const r = join(root, 'repo')
  mkdirSync(r)
  await g.git(r, ['init', '-q', '-b', 'main'])
  await g.git(r, ['config', 'user.email', 't@t'])
  await g.git(r, ['config', 'user.name', 'T'])
  writeFileSync(join(r, 'a.txt'), 'a\n')
  await g.git(r, ['add', '.'])
  await g.git(r, ['commit', '-qm', 'init'])
  return { root, r }
}

describe('workspace names', () => {
  it('has hundreds of unique names safe for folders and branches', () => {
    expect(CITIES.length).toBeGreaterThan(400)
    expect(new Set(CITIES).size).toBe(CITIES.length)
    for (const c of CITIES) expect(c).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })

  it('avoids taken names, then falls back to numbered ones', () => {
    expect(pickCityName(new Set(['paris']), () => 0)).toBe(CITIES.filter((c) => c !== 'paris')[0])
    const all = new Set(CITIES)
    expect(pickCityName(all, () => 0)).toBe(`${CITIES[0]}-2`)
  })

  it('counts leftover branches and folders as taken', async () => {
    const { root, r } = await repo()
    await g.git(r, ['branch', 'me/paris'])
    await g.git(r, ['branch', 'other/rome'])
    const dir = join(root, 'workspaces')
    mkdirSync(join(dir, 'oslo'), { recursive: true })
    const taken = await namesInUse(r, dir, ['lima'], 'me')
    expect([...taken].sort()).toEqual(['lima', 'oslo', 'paris'])
  })

  it('only calls a branch safe to delete when no commits would be lost', async () => {
    const { root, r } = await repo()
    await g.git(r, ['branch', 'me/merged'])
    expect(await g.branchIsSafeToDelete(r, 'me/merged', 'main')).toBe(true)
    expect(await g.branchIsSafeToDelete(r, 'me/missing', 'main')).toBe(true)
    await g.git(r, ['checkout', '-q', '-b', 'me/work'])
    writeFileSync(join(r, 'b.txt'), 'b\n')
    await g.git(r, ['add', '.'])
    await g.git(r, ['commit', '-qm', 'work'])
    await g.git(r, ['checkout', '-q', 'main'])
    expect(await g.branchIsSafeToDelete(r, 'me/work', 'main')).toBe(false)
    // A local upstream isn't pushed.
    await g.git(r, ['branch', 'mirror', 'me/work'])
    await g.git(r, ['branch', '--set-upstream-to=mirror', 'me/work'])
    expect(await g.branchIsSafeToDelete(r, 'me/work', 'main')).toBe(false)
    // Pushed, with nothing unpushed.
    const remote = join(root, 'remote.git')
    await g.git(root, ['init', '-q', '--bare', remote])
    await g.git(r, ['remote', 'add', 'origin', remote])
    await g.git(r, ['push', '-q', '-u', 'origin', 'me/work'])
    expect(await g.branchIsSafeToDelete(r, 'me/work', 'main')).toBe(true)
    await g.git(r, ['checkout', '-q', 'me/work'])
    writeFileSync(join(r, 'c.txt'), 'c\n')
    await g.git(r, ['add', '.'])
    await g.git(r, ['commit', '-qm', 'unpushed'])
    await g.git(r, ['checkout', '-q', 'main'])
    expect(await g.branchIsSafeToDelete(r, 'me/work', 'main')).toBe(false)
    expect(await g.deleteBranch(r, 'me/work')).toBe(true)
    expect(await g.localBranchExists(r, 'me/work')).toBe(false)
  })
})
