import { describe, expect, it } from 'vitest'
import { NO_FILTERS, activeCount, applyPrFilters, buttonLabel, REVIEW, toggleValue, valuesWithCounts, type PrFilters } from '../src/shared/prFilters'
import type { InboxPr } from '../src/shared/prInbox'

const now = Date.parse('2026-11-16T12:00:00Z')
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString()
const pr = (o: Partial<InboxPr>): InboxPr => ({
  repo: 'acme/web',
  number: 1,
  title: 'A change',
  url: '',
  author: 'alice',
  isDraft: false,
  headRefName: 'b',
  isCrossRepository: false,
  updatedAt: hoursAgo(1),
  additions: 1,
  deletions: 1,
  reviewDecision: null,
  checks: null,
  roles: ['review'],
  ...o
})
const prs = [
  pr({ number: 1, author: 'alice', repo: 'acme/web', checks: 'SUCCESS' }),
  pr({ number: 2, author: 'bob', repo: 'acme/api', isDraft: true, checks: 'FAILURE', updatedAt: hoursAgo(100) }),
  pr({ number: 3, author: 'alice', repo: 'acme/api', reviewDecision: 'APPROVED', updatedAt: hoursAgo(400), roles: ['reviewed'] })
]
const run = (f: Partial<PrFilters>) => applyPrFilters(prs, { ...NO_FILTERS, ...f }, now).map((p) => p.number)

describe('applyPrFilters', () => {
  it('passes everything with no filters', () => {
    expect(run({})).toEqual([1, 2, 3])
  })
  it('ORs within a dropdown and ANDs across dropdowns', () => {
    expect(run({ authors: ['alice'] })).toEqual([1, 3])
    expect(run({ authors: ['alice', 'bob'] })).toEqual([1, 2, 3])
    expect(run({ authors: ['alice'], repos: ['acme/api'] })).toEqual([3])
  })
  it('filters by review state, status and update time', () => {
    expect(run({ review: ['unapproved'] })).toEqual([1, 2])
    expect(run({ review: ['reviewed'] })).toEqual([3])
    expect(run({ status: ['draft'] })).toEqual([2])
    expect(run({ status: ['failing', 'passing'] })).toEqual([1, 2])
    expect(run({ updated: '24h' })).toEqual([1])
    expect(run({ updated: '7d' })).toEqual([1, 2])
    expect(run({ updated: 'stale' })).toEqual([3])
  })
})

describe('helpers', () => {
  it('counts, toggles and labels', () => {
    expect(activeCount({ ...NO_FILTERS, authors: ['a', 'b'], updated: '3d' })).toBe(3)
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b'])
    expect(valuesWithCounts(prs, (p) => p.author)).toEqual([
      { value: 'alice', count: 2 },
      { value: 'bob', count: 1 }
    ])
    expect(buttonLabel('Author', [])).toBe('Author')
    expect(buttonLabel('Author', ['alice'])).toBe('Author: alice')
    expect(buttonLabel('Review', ['unapproved'], REVIEW)).toBe('Review: Not approved yet')
    expect(buttonLabel('Repo', ['a', 'b'])).toBe('Repo: 2')
  })
})
