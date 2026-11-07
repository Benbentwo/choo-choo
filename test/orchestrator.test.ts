import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'choo-orch-'))
vi.mock('electron', () => ({ app: { getPath: () => home } }))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => home }))
const orch = await import('../src/main/orchestrator')
const { needsApproval } = await import('../src/main/agent')

const repo = orch.repoScope({ id: 'r1', name: 'my repo', path: '/x', defaultBranch: 'main' })

describe('orchestrator memory', () => {
  it('starts empty, then round-trips', () => {
    expect(orch.readMemory(repo)).toBe('')
    orch.writeMemory(repo, '- Ben prefers small PRs\n')
    expect(orch.readMemory(repo)).toContain('small PRs')
    expect(orch.memoryPath(repo)).toBe(join(home, 'choo-choo', 'memory', 'my_repo.md'))
  })
  it('puts memory in the system prompt', () => {
    const p = orch.systemPrompt(repo, 'remember this')
    expect(p).toContain('remember this')
    expect(orch.systemPrompt(repo, '')).toContain('(empty)')
  })
})

describe('transcript', () => {
  it('summarizes items compactly', () => {
    const t = orch.transcript(
      [
        { id: '1', kind: 'user', text: 'fix it', ts: 0 },
        { id: '2', kind: 'tool', name: 'Edit', input: { file_path: 'a.ts' }, ts: 0 },
        { id: '3', kind: 'assistant', text: 'Done', ts: 0 },
        { id: '4', kind: 'result', ok: true, ts: 0 }
      ],
      10
    )
    expect(t.split('\n')).toEqual(['USER: fix it', 'TOOL Edit: {"file_path":"a.ts"}', 'AGENT: Done', '-- turn finished --'])
  })
})

describe('permissions', () => {
  it('never asks before the orchestrator reads or waits', () => {
    expect(needsApproval('ask', [], 'mcp__choo__wait_for_workspaces')).toBe(false)
    expect(needsApproval('ask', [], 'mcp__choo__start_workspace')).toBe(true)
  })
})

describe('project groups', () => {
  const repos = [
    { id: 'a', name: 'api', path: '/a', defaultBranch: 'main' },
    { id: 'b', name: 'web', path: '/b', defaultBranch: 'main' }
  ]
  const group = { id: 'g1', name: 'Shop', repoIds: ['b', 'gone', 'a'], createdAt: 0 }
  it('keeps the group order and drops removed repos', () => {
    const scope = orch.groupScope(group, repos)
    expect(scope.repos.map((r) => r.name)).toEqual(['web', 'api'])
    expect(scope.group).toBe(true)
  })
  it('keeps group memory apart from repo memory', () => {
    const scope = orch.groupScope(group, repos)
    expect(orch.memoryPath(scope)).toBe(join(home, 'choo-choo', 'memory', 'groups', 'Shop.md'))
    orch.writeMemory(scope, 'shared note')
    expect(orch.readMemory(scope)).toBe('shared note')
    expect(orch.readMemory(orch.repoScope(repos[0]))).toBe('')
  })
  it('lists every repo in the prompt', () => {
    const p = orch.systemPrompt(orch.groupScope(group, repos), '')
    expect(p).toContain('Shop project')
    expect(p).toContain('- web at /b')
    expect(p).toContain('- api at /a')
  })
})

describe('checks summary', () => {
  const run = (name: string, bucket: 'pass' | 'fail' | 'pending') => ({ name, bucket, state: '', link: '', workflow: 'ci', description: '' })
  it('reports the worst state, failures first', () => {
    expect(orch.checksSummary([])).toEqual({ state: 'none', lines: [] })
    expect(orch.checksSummary([run('a', 'pass'), run('b', 'pending')]).state).toBe('pending')
    const s = orch.checksSummary([run('ok', 'pass'), run('bad', 'fail')])
    expect(s.state).toBe('fail')
    expect(s.lines[0]).toBe('FAIL ci / bad')
  })
})

describe('automatic updates', () => {
  it('says it is not from the person and names each workspace', () => {
    const p = orch.autoUpdatePrompt([
      { title: 'Fix login', id: 'w1', state: 'finished' },
      { title: 'Add tests', id: 'w2', state: 'error' }
    ])
    expect(p).toContain('not from the person')
    expect(p).toContain('Fix login (w1) finished.')
    expect(p).toContain('Add tests (w2) hit an error.')
  })
  it('lets pr_status run without asking', () => {
    expect(needsApproval('ask', [], 'mcp__choo__pr_status')).toBe(false)
  })
})
