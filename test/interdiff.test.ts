import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { git } from '../src/main/git'
import { interdiff, interdiffFile } from '../src/main/interdiff'
import { comparePatches, globToRegExp, leftOutLabel, matchesAny, parseGlobs, patchBody, normalizeReviewSettings } from '../src/shared/reviewUpdates'

let author: string
let reviewer: string

const write = (dir: string, file: string, text: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), text)
}
const commit = async (dir: string, files: Record<string, string>, msg = 'change') => {
  for (const [f, t] of Object.entries(files)) write(dir, f, t)
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-qm', msg])
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}
const lines = (n: number, tag = '') => Array.from({ length: n }, (_, i) => `line ${i + 1}${tag}`).join('\n') + '\n'

/** A bare repo stands in for GitHub; `author` pushes main and the PR branch, `reviewer` only fetches. */
beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), 'choo-interdiff-'))
  const remote = join(root, 'remote.git')
  author = join(root, 'author')
  reviewer = join(root, 'reviewer')
  await git(root, ['init', '-q', '--bare', '-b', 'main', remote])
  await git(remote, ['config', 'uploadpack.allowAnySHA1InWant', 'true'])
  await git(root, ['clone', '-q', remote, author])
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 'T']]) await git(author, ['config', k, v])
  await commit(author, { 'app.ts': lines(40), 'lib.ts': lines(40), 'other.ts': lines(10) }, 'base')
  await git(author, ['push', '-q', 'origin', 'main'])
  await git(author, ['checkout', '-qb', 'feat'])
  await git(root, ['clone', '-q', remote, reviewer])
}, 60_000)

const push = async () => {
  await git(author, ['push', '-qf', 'origin', 'feat', 'main'])
}
/** Someone else lands work on main. */
const landOnMain = async (files: Record<string, string>) => {
  await git(author, ['checkout', '-q', 'main'])
  const sha = await commit(author, files, 'main moves')
  await git(author, ['checkout', '-q', 'feat'])
  return sha
}

describe('interdiff', () => {
  it('a merge from main counts for nothing', async () => {
    const reviewed = await commit(author, { 'app.ts': lines(40).replace('line 3\n', 'line 3 changed\n') })
    await landOnMain({ 'other.ts': lines(10, ' main'), 'lib.ts': lines(40).replace('line 30\n', 'line 30 main\n'), 'new-on-main.ts': 'x\n' })
    await git(author, ['merge', '-q', '--no-edit', 'main'])
    const now = (await git(author, ['rev-parse', 'HEAD'])).trim()
    await push()
    const d = await interdiff(reviewer, { from: reviewed, to: now, base: 'main' })
    expect(d).toMatchObject({ files: [], kind: 'base-merge', exact: true, baseCommits: 1 })
    expect(d!.leftOut).toEqual(['lib.ts', 'new-on-main.ts', 'other.ts'])
    expect(leftOutLabel(d!, 'main')).toBe('Left out: changes from main (3 files).')
  })

  it('a rebase that keeps the same changes counts for nothing', async () => {
    const reviewed = await commit(author, { 'app.ts': lines(40).replace('line 3\n', 'line 3 changed\n') })
    await push() // reviewed on GitHub, then rewritten
    await landOnMain({ 'lib.ts': lines(40).replace('line 30\n', 'line 30 main\n') })
    await git(author, ['rebase', '-q', 'main'])
    const now = (await git(author, ['rev-parse', 'HEAD'])).trim()
    await push()
    const d = await interdiff(reviewer, { from: reviewed, to: now, base: 'main' })
    expect(d).toMatchObject({ files: [], kind: 'rebase', exact: true, leftOut: ['lib.ts'] })
  })

  it('shows only the author\'s new change after a merge from main in the same file', async () => {
    const reviewed = await commit(author, { 'app.ts': lines(40).replace('line 3\n', 'line 3 changed\n') })
    await landOnMain({ 'app.ts': lines(40).replace('line 35\n', 'line 35 from main\n') })
    await git(author, ['merge', '-q', '--no-edit', 'main'])
    write(author, 'app.ts', lines(40).replace('line 3\n', 'line 3 changed\n').replace('line 35\n', 'line 35 from main\n').replace('line 10\n', 'line 10 by author\n'))
    const now = await commit(author, {}, 'author fix')
    await push()
    const d = await interdiff(reviewer, { from: reviewed, to: now, base: 'main' })
    expect(d!.files).toEqual([{ path: 'app.ts', status: 'M', additions: 1, deletions: 1 }])
    const patch = await interdiffFile(reviewer, { from: reviewed, to: now, base: 'main', file: 'app.ts' })
    expect(patch).toContain('+line 10 by author')
    expect(patch).not.toContain('from main')
  })

  it('leaves out ignored files and counts new files', async () => {
    const reviewed = await commit(author, { 'app.ts': lines(40).replace('line 3\n', 'line 3 changed\n') })
    const now = await commit(author, { 'package-lock.json': '{}\n', 'src/generated/api.ts': 'x\n', 'test/app.test.ts': 'it()\n' })
    await push()
    const d = await interdiff(reviewer, { from: reviewed, to: now, base: 'main', ignore: ['package-lock.json', '**/generated/**'] })
    expect(d!.files.map((f) => f.path)).toEqual(['test/app.test.ts'])
    expect(d!.files[0].status).toBe('A')
    expect(d!.ignored).toEqual(['package-lock.json', 'src/generated/api.ts'])
    expect(d!.kind).toBe('push')
  })

  it('falls back to the plain diff for a file that clashes with the new base', async () => {
    const reviewed = await commit(author, { 'app.ts': lines(40).replace('line 3\n', 'line 3 by author\n') })
    await landOnMain({ 'app.ts': lines(40).replace('line 3\n', 'line 3 by main\n') })
    await git(author, ['merge', '-q', '--no-edit', '-X', 'ours', 'main'])
    const now = (await git(author, ['rev-parse', 'HEAD'])).trim()
    await push()
    const d = await interdiff(reviewer, { from: reviewed, to: now, base: 'main' })
    expect(d!.exact).toBe(false)
  })

  it('is null when a commit can\'t be found', async () => {
    expect(await interdiff(reviewer, { from: 'deadbeef'.repeat(5), to: 'deadbeef'.repeat(5), base: 'main' })).toBeNull()
  })
})

describe('patch comparison without a clone', () => {
  const p = (body: string, at = 1) => `@@ -${at},3 +${at},3 @@\n ctx\n${body}\n ctx`
  it('ignores line-number shifts and context', () => {
    const before = [{ path: 'a.ts', patch: p('-old\n+new', 10) }, { path: 'b.ts', patch: p('+x') }]
    const after = [{ path: 'a.ts', patch: p('-old\n+new', 52).replace(/ ctx/g, ' other') }, { path: 'b.ts', patch: p('+x\n+y') }, { path: 'yarn.lock', patch: p('+z') }]
    const r = comparePatches(before, after, ['*.lock'])
    expect(r.changed).toEqual([{ path: 'b.ts', additions: 1, deletions: 0 }])
    expect(r.ignored).toEqual(['yarn.lock'])
  })
  it('counts a patch GitHub left out as changed', () => {
    expect(comparePatches([{ path: 'big.bin' }], [{ path: 'big.bin' }]).changed).toHaveLength(1)
  })
  it('patchBody keeps only changed lines', () => {
    expect(patchBody('--- a/x\n+++ b/x\n@@ -1 +1 @@\n ctx\n-a  \n+b')).toEqual(['-a', '+b'])
  })
})

describe('globs', () => {
  it('match like gitignore', () => {
    expect(matchesAny('web/package-lock.json', ['package-lock.json'])).toBe(true)
    expect(matchesAny('Cargo.lock', ['*.lock'])).toBe(true)
    expect(matchesAny('src/generated/a/b.ts', ['**/generated/**'])).toBe(true)
    expect(matchesAny('generated/b.ts', ['**/generated/**'])).toBe(true)
    expect(matchesAny('src/gen.ts', ['**/generated/**'])).toBe(false)
    expect(globToRegExp('docs/*.md').test('docs/a.md')).toBe(true)
    expect(globToRegExp('docs/*.md').test('x/docs/a.md')).toBe(false)
    expect(globToRegExp('docs/*.md').test('docs/sub/a.md')).toBe(false)
  })
  it('parse from a comma or line separated box', () => {
    expect(parseGlobs('*.lock, go.sum\n\n**/dist/**,*.lock')).toEqual(['*.lock', 'go.sum', '**/dist/**'])
  })
  it('settings fill in and clamp the custom interval', () => {
    expect(normalizeReviewSettings({ pollMinutes: 0 }).pollMinutes).toBe(1)
    expect(normalizeReviewSettings({ pollMinutes: 500 }).pollMinutes).toBe(120)
    expect(normalizeReviewSettings({ pollMinutes: 7 }).pollMinutes).toBe(7)
    expect(normalizeReviewSettings(undefined).onCode).toBe(true)
  })
})
