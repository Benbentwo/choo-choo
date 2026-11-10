import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { StackLayerStatus, Workspace } from '../src/shared/types'
import { githubLinked, githubLinkPlan, mergeThroughLabel, mergeThroughPrs } from '../src/shared/stack'
import * as stack from '../src/main/stack'

describe('GitHub stack helpers', () => {
  it('plans a new GitHub stack, an append, or nothing', () => {
    expect(githubLinkPlan([1, 2, 3], null)).toEqual({ action: 'create', prs: [1, 2, 3] })
    expect(githubLinkPlan([1], null)).toEqual({ action: 'none', prs: [] })
    expect(githubLinkPlan([1, 2, 3], { number: 7, prs: [1, 2] })).toEqual({ action: 'add', prs: [3] })
    expect(githubLinkPlan([1, 2], { number: 7, prs: [1, 2] })).toEqual({ action: 'none', prs: [] })
    // Merged PRs fall off GitHub's stack from the bottom; ours starts at the first open one.
    expect(githubLinkPlan([2, 3], { number: 7, prs: [1, 2, 3] })).toEqual({ action: 'none', prs: [] })
    expect(githubLinkPlan([1, 3], { number: 7, prs: [1, 2] }).action).toBe('mismatch')
    expect(githubLinkPlan([1], { number: 7, prs: [1, 2] }).action).toBe('mismatch')
    expect(githubLinked([1, 2], { number: 7, prs: [1, 2] })).toBe(true)
    expect(githubLinked([1, 2], 'unavailable')).toBe(false)
  })

  const layer = (branch: string, number: number | null, more: Partial<StackLayerStatus> = {}): StackLayerStatus => ({
    branch,
    sha: 'x',
    behind: false,
    commits: 1,
    pushed: true,
    unpushed: false,
    pr: number ? { number, url: '', state: 'OPEN', isDraft: false, title: branch } : null,
    comments: 0,
    checks: { total: 0, failed: 0, pending: 0 },
    ...more
  })

  it('merges every open PR up to the chosen one', () => {
    const layers = [layer('a', 1, { pr: { number: 1, url: '', state: 'MERGED', isDraft: false, title: 'a' } }), layer('b', 2), layer('c', 3), layer('d', 4)]
    expect(mergeThroughPrs(layers, 2)).toEqual({ prs: [2, 3] })
    expect(mergeThroughLabel([2, 3])).toBe('Merge through #3 · 2 PRs')
    expect(mergeThroughLabel([2])).toBe('Merge #2')
    expect(mergeThroughPrs([layer('a', 1), layer('b', null)], 1)).toEqual({ why: 'b has no open PR' })
    expect(mergeThroughPrs([layer('a', 1, { unpushed: true }), layer('b', 2)], 1)).toEqual({ why: 'Push a first' })
    expect(mergeThroughPrs([layer('a', 1), layer('b', 2, { behind: true })], 1)).toEqual({ why: 'Restack first' })
  })
})

// End to end against real git and a stand-in gh (test/fixtures/fake-gh.cjs): link, then merge through the middle PR.
describe('link and merge through', () => {
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  let ws: Workspace
  let stateFile: string
  let origin: string
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8'))
  const setState = (patch: object) => writeFileSync(stateFile, JSON.stringify({ ...state(), ...patch }))

  const setup = (rebase: boolean) => {
    const root = mkdtempSync(join(tmpdir(), 'choo-ghstack-'))
    origin = join(root, 'origin.git')
    run(root, 'init', '-q', '--bare', '-b', 'main', origin)
    const wt = join(root, 'wt')
    run(root, 'clone', '-q', origin, wt)
    run(wt, 'config', 'user.email', 't@t')
    run(wt, 'config', 'user.name', 'T')
    run(wt, 'checkout', '-q', '-b', 'main')
    const commit = (f: string) => {
      writeFileSync(join(wt, f), `${f}\n`)
      run(wt, 'add', '.')
      run(wt, 'commit', '-qm', f)
    }
    commit('base.txt')
    run(wt, 'push', '-q', 'origin', 'main')
    const branches = ['me/f', 'me/f-2', 'me/f-3']
    branches.forEach((b, i) => {
      run(wt, 'checkout', '-q', '-b', b)
      commit(`${i + 1}.txt`)
    })
    run(wt, 'push', '-q', 'origin', ...branches)
    run(wt, 'checkout', '-q', 'me/f-3')

    const bin = join(root, 'bin')
    mkdirSync(bin)
    symlinkSync(resolve(__dirname, 'fixtures/fake-gh.cjs'), join(bin, 'gh'))
    process.env.PATH = `${bin}:${process.env.PATH}`
    stateFile = join(root, 'gh.json')
    process.env.FAKE_GH_STATE = stateFile
    writeFileSync(
      stateFile,
      JSON.stringify({
        ext: false,
        stacksApi: true,
        rebase,
        origin,
        stacks: [],
        prs: { 'me/f': { number: 11, state: 'OPEN' }, 'me/f-2': { number: 12, state: 'OPEN', base: 'me/f' }, 'me/f-3': { number: 13, state: 'OPEN', base: 'me/f-2' } }
      })
    )

    const base = run(wt, 'rev-parse', 'main')
    ws = {
      id: `w-${rebase}`,
      repoId: 'r',
      name: 'x',
      branch: 'me/f-3',
      baseRef: 'origin/main',
      path: wt,
      title: 'Feat',
      createdAt: 0,
      stack: {
        autoRestack: true,
        layers: [
          { branch: 'me/f', parentSha: base },
          { branch: 'me/f-2', parentSha: run(wt, 'rev-parse', 'me/f') },
          { branch: 'me/f-3', parentSha: run(wt, 'rev-parse', 'me/f-2') }
        ]
      }
    } as Workspace
    stack.forgetGhStack()
    stack.init({
      save: () => {},
      changed: () => {},
      sendToChat: () => {},
      isRunning: () => false,
      stopChat: () => {},
      findChat: () => undefined,
      note: () => {},
      defaultBranch: () => 'main'
    })
  }

  for (const rebase of [true, false]) {
    describe(rebase ? 'GitHub rebases the PRs left' : 'GitHub leaves the PRs left alone', () => {
      beforeEach(() => setup(rebase))

      it('links the stack, installs gh-stack, merges #11 and #12 together and keeps #13 on top of main', async () => {
        let st = await stack.status(ws)
        expect(st!.github).toBeNull()
        await expect(stack.mergeThrough(ws, 'me/f-2')).rejects.toThrow(/Link the stack on GitHub/)

        expect(await stack.linkGithub(ws)).toEqual({ number: 1, prs: [11, 12, 13] })
        st = await stack.status(ws)
        expect(st!.github).toEqual({ number: 1, prs: [11, 12, 13] })
        expect(st!.ghStackCli).toBe(false)
        await expect(stack.mergeThrough(ws, 'me/f-2')).rejects.toThrow(/Install gh-stack/)
        await stack.installCli()

        const r = await stack.mergeThrough(ws, 'me/f-2')
        expect(r).toEqual({ merged: [11, 12], queued: false, dropped: ['me/f', 'me/f-2'] })
        expect(readFileSync(`${stateFile}.calls`, 'utf8')).toContain('stack merge 12 --squash --yes')

        // Only #13 is left, built on the new main with just its own commit, and pushed.
        expect(ws.stack!.layers.map((l) => l.branch)).toEqual(['me/f-3'])
        expect(run(ws.path, 'branch', '--show-current')).toBe('me/f-3')
        expect(run(ws.path, 'rev-list', '--count', 'origin/main..me/f-3')).toBe('1')
        expect(run(ws.path, 'rev-parse', 'me/f-3')).toBe(run(origin, 'rev-parse', 'refs/heads/me/f-3'))
        expect(run(ws.path, 'show', 'me/f-3:3.txt')).toBe('3.txt')
        expect(state().prs['me/f-3'].base).toBe('main')
      })
    })
  }

  it('says when GitHub has no stacks for the repo', async () => {
    setup(false)
    setState({ stacksApi: false })
    expect((await stack.status(ws))!.github).toBe('unavailable')
    await expect(stack.linkGithub(ws)).rejects.toThrow(/aren't available/)
  })
})
