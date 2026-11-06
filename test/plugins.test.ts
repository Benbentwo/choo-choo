import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('../src/main/claudeBinary', () => ({ claudeExecutable: () => '/nonexistent/claude' }))
import { install, localSkills, toAvailable, toInstalled, uninstall } from '../src/main/plugins'
import { lastJson } from '../src/main/claudeCli'

describe('plugin lists', () => {
  it('reads claude plugin list --json entries', () => {
    expect(toInstalled({ id: 'commit-commands@claude-plugins-official', version: '1.0.1', scope: 'user', enabled: true })).toEqual({
      id: 'commit-commands@claude-plugins-official',
      name: 'commit-commands',
      marketplace: 'claude-plugins-official',
      version: '1.0.1',
      scope: 'user',
      enabled: true,
      manageable: true
    })
    expect(toInstalled({ id: 'design@synced', scope: 'synced', enabled: true }).manageable).toBe(false)
    expect(toAvailable({ pluginId: 'a@m', name: 'a', description: 'd', marketplaceName: 'm', installCount: 3 })).toEqual({ id: 'a@m', name: 'a', description: 'd', marketplace: 'm', installs: 3 })
  })
  it('finds the last JSON line in noisy output', () => {
    expect(lastJson('Cloning…\n{"outcome":"ok"}\n')).toEqual({ outcome: 'ok' })
    expect(lastJson('nothing here')).toBeUndefined()
  })
})

describe('plugin commands', () => {
  it('rejects ids and scopes before running Claude Code', async () => {
    await expect(install('/tmp', {}, 'bad id; rm -rf', 'user')).rejects.toThrow(/Not a plugin id/)
    await expect(install('/tmp', {}, 'a@m', 'local')).rejects.toThrow(/every repo/)
    await expect(install('/tmp', {}, 'a@m', 'user', 'nothex')).rejects.toThrow(/hash/)
    await expect(uninstall('/tmp', {}, 'design@synced', 'synced')).rejects.toThrow(/managed outside/)
  })
})

describe('your skills', () => {
  it('lists skills, commands and agents from ~/.claude and the repo', () => {
    const home = mkdtempSync(join(tmpdir(), 'pl-home-'))
    const repo = mkdtempSync(join(tmpdir(), 'pl-repo-'))
    mkdirSync(join(home, '.claude', 'skills', 'deploy'), { recursive: true })
    writeFileSync(join(home, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Ship it\n---\nSteps')
    mkdirSync(join(repo, '.claude', 'commands', 'db'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'commands', 'db', 'reset.md'), '---\ndescription: Reset the dev database\n---\n')
    mkdirSync(join(repo, '.claude', 'agents'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'agents', 'x.md'), '---\nname: triager\ndescription: Sorts issues\n---\n')
    expect(localSkills(repo, home).map((s) => [s.kind, s.name, s.scope, s.description])).toEqual([
      ['skill', 'deploy', 'user', 'Ship it'],
      ['command', 'db:reset', 'project', 'Reset the dev database'],
      ['agent', 'triager', 'project', 'Sorts issues']
    ])
  })
})
