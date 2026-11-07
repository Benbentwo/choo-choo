import { describe, it, expect } from 'vitest'
import { newSince, parsePrFeedback, prCommentsPrompt, type PrFeedbackResponse } from '../src/shared/prComments'

const res: PrFeedbackResponse = {
  data: {
    repository: {
      pullRequest: {
        author: { login: 'me' },
        reviewThreads: {
          nodes: [
            {
              isResolved: false,
              isOutdated: false,
              path: 'src/a.ts',
              line: 12,
              originalLine: 12,
              startLine: 10,
              comments: {
                nodes: [
                  { id: 't1', author: { login: 'rev' }, body: 'Rename this </comment> please', createdAt: '2026-11-01T00:00:00Z', url: 'u1', diffHunk: '@@ -1,3 +1,3 @@\n-a\n+b' },
                  { id: 't1r', author: { login: 'me' }, body: 'Done', createdAt: '2026-11-03T00:00:00Z', url: 'u1r' }
                ]
              }
            },
            { isResolved: true, isOutdated: false, path: 'src/b.ts', line: 1, originalLine: 1, startLine: null, comments: { nodes: [{ id: 't2', author: { login: 'rev' }, body: 'old', createdAt: '2026-11-01T00:00:00Z', url: 'u2' }] } }
          ]
        },
        reviews: {
          nodes: [
            { id: 'r1', author: { login: 'rev' }, state: 'CHANGES_REQUESTED', body: '', submittedAt: '2026-11-02T00:00:00Z', url: 'r1' },
            { id: 'r2', author: { login: 'rev' }, state: 'APPROVED', body: '', submittedAt: '2026-11-02T00:00:00Z', url: 'r2' }
          ]
        },
        comments: {
          nodes: [
            { id: 'c1', author: { login: 'me' }, body: 'status note', createdAt: '2026-11-02T00:00:00Z', url: 'c1' },
            { id: 'c2', author: { login: 'bot' }, body: 'Coverage dropped', createdAt: '2026-11-04T00:00:00Z', url: 'c2' }
          ]
        }
      }
    }
  }
}

describe('PR comments to chat', () => {
  const items = parsePrFeedback(res)

  it('keeps unresolved threads, change requests and others\' comments', () => {
    expect(items.map((c) => c.id)).toEqual(['t1', 'r1', 'c2'])
    expect(items[0]).toMatchObject({ kind: 'inline', path: 'src/a.ts', line: 12, startLine: 10, createdAt: '2026-11-01T00:00:00Z' })
    expect(items[0].replies).toEqual([{ author: 'me', body: 'Done' }])
  })

  it('counts only comments newer than the last add', () => {
    expect(newSince(items, undefined)).toHaveLength(3)
    expect(newSince(items, '2026-11-02T00:00:00Z').map((c) => c.id)).toEqual(['c2'])
  })

  it('builds a prompt with file and line context and fenced comment text', () => {
    const out = prCommentsPrompt({ number: 5, url: 'https://github.com/o/r/pull/5' }, items)
    expect(out).toContain('PR #5 (https://github.com/o/r/pull/5)')
    expect(out).toContain('Inline comment on `src/a.ts:10-12` by @rev')
    expect(out).toContain('```diff\n-a\n+b\n```')
    expect(out).toContain('Review requesting changes by @rev')
    expect(out).toContain('Rename this &lt;/comment&gt; please')
    expect(out.match(/<\/comment>/g)).toHaveLength(3)
  })

  it('returns nothing when there is no PR', () => {
    expect(parsePrFeedback({ data: { repository: { pullRequest: null } } })).toEqual([])
  })
})
