import { describe, expect, it } from 'vitest'
import { addQuickFilter, applyQuickFilters, parseQuickFilter, quickFilterLabel, suggestQuickFilters } from '../src/shared/prFilters'
import type { InboxPr } from '../src/shared/prInbox'

const pr = (o: Partial<InboxPr>): InboxPr => ({
  repo: 'acme/web',
  number: 1,
  title: 'A change',
  url: '',
  author: 'alice',
  isDraft: false,
  headRefName: 'b',
  isCrossRepository: false,
  updatedAt: '2026-11-16T00:00:00Z',
  additions: 1,
  deletions: 1,
  reviewDecision: null,
  checks: null,
  roles: ['review'],
  ...o
})
const prs = [
  pr({ number: 1, author: 'alice', repo: 'acme/web', title: 'Faster map tiles' }),
  pr({ number: 2, author: 'bob', repo: 'acme/api', isDraft: true, checks: 'FAILURE' }),
  pr({ number: 3, author: 'Alice', repo: 'acme/api', reviewDecision: 'APPROVED' })
]

describe('parseQuickFilter', () => {
  it('reads authors in several ways', () => {
    for (const t of ['author:bob', '@bob', 'by bob', 'only PRs by bob', 'For now, filter only by bob', "bob's PRs", 'bob', 'BOB'])
      expect(parseQuickFilter(t, prs), t).toEqual({ kind: 'author', value: 'bob' })
  })
  it('keeps an unknown author from an explicit form', () => {
    expect(parseQuickFilter('by carol', prs)).toEqual({ kind: 'author', value: 'carol' })
  })
  it('reads repos and statuses', () => {
    expect(parseQuickFilter('repo:api', prs)).toEqual({ kind: 'repo', value: 'acme/api' })
    expect(parseQuickFilter('in acme/web', prs)).toEqual({ kind: 'repo', value: 'acme/web' })
    expect(parseQuickFilter('web', prs)).toEqual({ kind: 'repo', value: 'acme/web' })
    expect(parseQuickFilter('show me only drafts', prs)).toEqual({ kind: 'status', value: 'draft' })
    expect(parseQuickFilter('is:failing', prs)).toEqual({ kind: 'status', value: 'failing' })
  })
  it('falls back to a title search, and ignores blanks', () => {
    expect(parseQuickFilter('map tiles', prs)).toEqual({ kind: 'text', value: 'map tiles' })
    expect(parseQuickFilter('  ', prs)).toBeNull()
  })
})

describe('applyQuickFilters', () => {
  it('ORs within a kind and ANDs across kinds', () => {
    const n = (fs: Parameters<typeof applyQuickFilters>[1]) => applyQuickFilters(prs, fs).map((p) => p.number)
    expect(n([])).toEqual([1, 2, 3])
    expect(n([{ kind: 'author', value: 'alice' }])).toEqual([1, 3])
    expect(n([{ kind: 'author', value: 'alice' }, { kind: 'author', value: 'bob' }])).toEqual([1, 2, 3])
    expect(n([{ kind: 'author', value: 'alice' }, { kind: 'repo', value: 'acme/api' }])).toEqual([3])
    expect(n([{ kind: 'status', value: 'draft' }])).toEqual([2])
    expect(n([{ kind: 'text', value: 'map' }])).toEqual([1])
  })
})

describe('helpers', () => {
  it('does not add a filter twice', () => {
    const one = addQuickFilter([], { kind: 'author', value: 'bob' })
    expect(addQuickFilter(one, { kind: 'author', value: 'BOB' })).toBe(one)
  })
  it('labels and suggests', () => {
    expect(quickFilterLabel({ kind: 'author', value: 'bob' })).toBe('by bob')
    expect(quickFilterLabel({ kind: 'status', value: 'failing' })).toBe('Checks failing')
    expect(suggestQuickFilters('ap', prs)).toEqual([
      { kind: 'repo', value: 'acme/api' },
      { kind: 'status', value: 'approved' }
    ])
  })
})
