import { describe, it, expect } from 'vitest'
import { canUpdateBranch, comparePath, nextPrAction, summarizeChecks } from '../src/shared/prStatus'
import type { CheckRun, PrInfo } from '../src/shared/types'

const pr = (p: Partial<PrInfo> = {}): PrInfo => ({ number: 1, url: '', state: 'OPEN', isDraft: false, title: 't', ...p })
const run = (bucket: CheckRun['bucket']): CheckRun => ({ name: bucket, state: '', bucket, link: '', workflow: '', description: '' })

describe('nextPrAction', () => {
  it('puts conflicts first, then failing checks, then waiting, then merge', () => {
    expect(nextPrAction(pr({ mergeable: 'CONFLICTING' }), summarizeChecks([run('fail')]))).toBe('resolve')
    expect(nextPrAction(pr(), summarizeChecks([run('pass'), run('fail')]))).toBe('fix')
    expect(nextPrAction(pr(), summarizeChecks([run('pass'), run('pending')]))).toBe('waiting')
    expect(nextPrAction(pr({ mergeStateStatus: 'CLEAN' }), summarizeChecks([run('pass'), run('skipping')]))).toBe('merge')
  })
  it('waits for a required review and leaves drafts alone', () => {
    expect(nextPrAction(pr({ reviewDecision: 'REVIEW_REQUIRED' }), summarizeChecks([run('pass')]))).toBe('review')
    expect(nextPrAction(pr({ isDraft: true }), summarizeChecks([run('pass')]))).toBe('open')
    expect(nextPrAction(pr({ mergeStateStatus: 'BLOCKED' }), summarizeChecks([]))).toBe('open')
  })
})

describe('updating a branch', () => {
  it('offers the update only when an open PR is behind and has no conflicts', () => {
    expect(canUpdateBranch(pr({ behindBy: 3 }))).toBe(true)
    expect(canUpdateBranch(pr({ mergeStateStatus: 'BEHIND' }))).toBe(true)
    expect(canUpdateBranch(pr({ behindBy: 0 }))).toBe(false)
    expect(canUpdateBranch(pr())).toBe(false)
    expect(canUpdateBranch(pr({ behindBy: 3, mergeable: 'CONFLICTING' }))).toBe(false)
    expect(canUpdateBranch(pr({ behindBy: 3, state: 'MERGED' }))).toBe(false)
  })
  it('compares the base with the head, naming the fork owner for PRs from forks', () => {
    expect(comparePath(pr({ baseRefName: 'main', headRefName: 'ben/fix #1' }))).toBe('repos/{owner}/{repo}/compare/main...ben/fix%20%231')
    expect(comparePath(pr({ baseRefName: 'main', headRefName: 'fix', isCrossRepository: true, headRepositoryOwner: { login: 'octo' } }))).toBe('repos/{owner}/{repo}/compare/main...octo:fix')
    expect(comparePath(pr({ headRefName: 'fix' }))).toBeNull()
  })
})
