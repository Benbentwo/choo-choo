import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'choo-orch-'))
vi.mock('electron', () => ({ app: { getPath: () => home } }))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => home }))
const orch = await import('../src/main/orchestrator')
const { needsApproval } = await import('../src/main/agent')

const repo = { id: 'r1', name: 'my repo', path: '/x', defaultBranch: 'main' }

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
