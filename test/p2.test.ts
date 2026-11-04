import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseScripts, readScripts } from '../src/main/scripts'
import { slugify, fallbackTitle } from '../src/main/naming'
import { listCommands } from '../src/main/commands'
import * as g from '../src/main/git'
import { findTrigger, rank, applyCompletion } from '../src/renderer/src/autocomplete'

describe('scripts', () => {
  it('parses conductor.json', () => {
    expect(parseScripts('{"scripts":{"setup":"npm i","run":"npm run dev","archive":""}}')).toEqual({ setup: 'npm i', run: 'npm run dev', archive: undefined })
  })
  it('prefers choo-choo.json and the worktree copy', () => {
    const wt = mkdtempSync(join(tmpdir(), 'wt-'))
    const root = mkdtempSync(join(tmpdir(), 'root-'))
    writeFileSync(join(root, 'conductor.json'), '{"scripts":{"run":"root"}}')
    expect(readScripts(wt, root)).toEqual({ run: 'root', setup: undefined, archive: undefined, source: 'conductor.json' })
    writeFileSync(join(wt, 'conductor.json'), '{"scripts":{"run":"wt-conductor"}}')
    writeFileSync(join(wt, 'choo-choo.json'), '{"scripts":{"run":"wt-choo"}}')
    expect(readScripts(wt, root).run).toBe('wt-choo')
  })
})

describe('naming', () => {
  it('slugifies prompts', () => {
    expect(slugify('Please add an admin gallery photo upload page!')).toBe('add-admin-gallery-photo-upload')
    expect(fallbackTitle('short')).toBe('short')
  })
})

describe('autocomplete', () => {
  it('finds @mentions anywhere and /commands only at the start', () => {
    expect(findTrigger('look at @src/ma', 15)).toEqual({ kind: '@', query: 'src/ma', start: 8 })
    expect(findTrigger('/rev', 4)).toEqual({ kind: '/', query: 'rev', start: 0 })
    expect(findTrigger('hello /rev', 10)).toBeNull()
    expect(findTrigger('email a@b', 9)).toBeNull()
  })
  it('ranks basename matches first', () => {
    expect(rank(['src/app/main.ts', 'main.go', 'docs/domain.md'], 'main')).toEqual(['main.go', 'src/app/main.ts', 'docs/domain.md'])
  })
  it('applies completions', () => {
    const t = findTrigger('see @ma now', 7)!
    expect(applyCompletion('see @ma now', 7, t, 'main.ts')).toEqual({ text: 'see @main.ts  now', caret: 13 })
  })
})

describe('commands and files', () => {
  it('reads project commands with descriptions', () => {
    const wt = mkdtempSync(join(tmpdir(), 'cmd-'))
    mkdirSync(join(wt, '.claude', 'commands', 'ops'), { recursive: true })
    writeFileSync(join(wt, '.claude', 'commands', 'ship.md'), '---\ndescription: Ship it\n---\nDo the thing')
    writeFileSync(join(wt, '.claude', 'commands', 'ops', 'deploy.md'), 'Deploy to prod')
    const cmds = listCommands(wt, ['custom-reported'])
    expect(cmds).toContainEqual({ name: 'ship', description: 'Ship it' })
    expect(cmds).toContainEqual({ name: 'ops:deploy', description: 'Deploy to prod' })
    expect(cmds.map((c) => c.name)).toContain('compact')
    expect(cmds.map((c) => c.name)).toContain('custom-reported')
  })

  it('lists files and renames unpushed branches', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'files-'))
    await g.git(repo, ['init', '-q', '-b', 'main'])
    await g.git(repo, ['config', 'user.email', 't@t'])
    await g.git(repo, ['config', 'user.name', 't'])
    writeFileSync(join(repo, 'a.txt'), 'a')
    writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n')
    await g.git(repo, ['add', '.'])
    await g.git(repo, ['commit', '-qm', 'i'])
    writeFileSync(join(repo, 'new.txt'), 'n')
    writeFileSync(join(repo, 'ignored.txt'), 'x')
    expect((await g.listFiles(repo)).sort()).toEqual(['.gitignore', 'a.txt', 'new.txt'])
    await g.git(repo, ['checkout', '-qb', 'me/dallas'])
    expect(await g.renameBranch(repo, 'me/dallas', 'me/photo-upload')).toBe(true)
    expect((await g.git(repo, ['branch', '--show-current'])).trim()).toBe('me/photo-upload')
    expect(await g.renameBranch(repo, 'me/photo-upload', 'main')).toBe(false)
  })
})
