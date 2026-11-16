import { describe, it, expect } from 'vitest'
import { workspaceForIssue, workspaceForPr } from '../src/shared/workspaceFor'
import type { Workspace } from '../src/shared/types'

const ws = (id: string, extra: Partial<Workspace> = {}): Workspace =>
  ({ id, repoId: 'r1', name: id, branch: `b-${id}`, baseRef: 'main', path: `/w/${id}`, title: id, createdAt: 0, ...extra }) as Workspace

describe('workspaceForPr', () => {
  it('finds the workspace by PR number, stack layer or branch', () => {
    const list = [
      ws('num', { prNumber: 12 }),
      ws('stack', { stack: { autoRestack: true, layers: [{ branch: 'feat/a', pr: { number: 20, title: 'A' } }, { branch: 'feat/b' }] } }),
      ws('branch', { branch: 'feat/c' }),
    ]
    expect(workspaceForPr(list, 'r1', { number: 12 })?.id).toBe('num')
    expect(workspaceForPr(list, 'r1', { number: 20 })?.id).toBe('stack')
    expect(workspaceForPr(list, 'r1', { number: 21, branch: 'feat/b' })?.id).toBe('stack')
    expect(workspaceForPr(list, 'r1', { number: 30, branch: 'feat/c' })?.id).toBe('branch')
    expect(workspaceForPr(list, 'r1', { number: 99, branch: 'nope' })).toBeUndefined()
  })

  it('skips archived workspaces, orchestrators and other repos', () => {
    const list = [ws('old', { prNumber: 5, archived: true }), ws('orch', { prNumber: 5, orchestrator: true }), ws('other', { prNumber: 5, repoId: 'r2' })]
    expect(workspaceForPr(list, 'r1', { number: 5 })).toBeUndefined()
  })
})

describe('workspaceForIssue', () => {
  it('finds the workspace started from the issue', () => {
    const list = [ws('a', { issueNumber: 7 }), ws('b', { issueNumber: 8, archived: true })]
    expect(workspaceForIssue(list, 'r1', 7)?.id).toBe('a')
    expect(workspaceForIssue(list, 'r1', 8)).toBeUndefined()
  })
})
