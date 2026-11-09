import { describe, it, expect } from 'vitest'
import { groupByRepo, parsePrInbox, prBranch, prInboxQuery } from '../src/shared/prInbox'

const node = (repo: string, number: number, updatedAt: string, extra: Record<string, unknown> = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/${repo}/pull/${number}`,
  isDraft: false,
  headRefName: `feature-${number}`,
  isCrossRepository: false,
  updatedAt,
  additions: 3,
  deletions: 1,
  reviewDecision: null,
  author: { login: 'someone' },
  repository: { nameWithOwner: repo },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...extra
})

describe('parsePrInbox', () => {
  it('merges both searches, keeps each PR once with both roles, newest first', () => {
    const prs = parsePrInbox({
      data: {
        review: { nodes: [node('a/one', 1, '2026-11-01T00:00:00Z'), node('b/two', 7, '2026-11-03T00:00:00Z'), null, {} as never] },
        mine: { nodes: [node('b/two', 7, '2026-11-03T00:00:00Z'), node('a/one', 2, '2026-11-02T00:00:00Z', { author: null, commits: { nodes: [] } })] }
      }
    })
    expect(prs.map((p) => `${p.repo}#${p.number}`)).toEqual(['b/two#7', 'a/one#2', 'a/one#1'])
    expect(prs[0].roles).toEqual(['review', 'mine'])
    expect(prs[0].checks).toBe('SUCCESS')
    expect(prs[1]).toMatchObject({ roles: ['mine'], author: 'ghost', checks: null })
  })

  it('handles a missing or empty response', () => {
    expect(parsePrInbox({})).toEqual([])
    expect(parsePrInbox({ data: { review: { nodes: null } } })).toEqual([])
  })
})

describe('groupByRepo', () => {
  const prs = parsePrInbox({
    data: {
      review: { nodes: [node('a/one', 1, '2026-11-01T00:00:00Z'), node('b/two', 7, '2026-11-03T00:00:00Z')] },
      mine: { nodes: [node('a/one', 2, '2026-11-04T00:00:00Z')] }
    }
  })
  it('filters by role and orders repos by their latest PR', () => {
    expect(groupByRepo(prs, 'review').map((g) => [g.repo, g.prs.map((p) => p.number)])).toEqual([
      ['b/two', [7]],
      ['a/one', [1]]
    ])
    expect(groupByRepo(prs, 'mine').map((g) => g.repo)).toEqual(['a/one'])
    expect(groupByRepo(prs, 'all').map((g) => [g.repo, g.prs.map((p) => p.number)])).toEqual([
      ['a/one', [2, 1]],
      ['b/two', [7]]
    ])
  })
})

describe('prBranch', () => {
  it('uses the head branch, or pr-N for forks', () => {
    expect(prBranch({ number: 4, headRefName: 'fix', isCrossRepository: false })).toBe('fix')
    expect(prBranch({ number: 4, headRefName: 'main', isCrossRepository: true })).toBe('pr-4')
  })
})

describe('prInboxQuery', () => {
  it('asks for review requests or own PRs, open and not archived, newest first', () => {
    expect(prInboxQuery('review', 50)).toContain('review: search(query: "is:open is:pr archived:false review-requested:@me sort:updated-desc"')
    expect(prInboxQuery('mine', 20)).toContain('mine: search(query: "is:open is:pr archived:false author:@me sort:updated-desc", type: ISSUE, first: 20)')
  })
})
