import { describe, it, expect } from 'vitest'
import { parsePrReviewInfo, type PrFeedbackResponse } from '../src/shared/prComments'
import { defaultMode, draftProblem, modeDest, isTheirs, latestReviewBy, patchLines, prOwnerLabel, reviewPayload, threadPrompt, type PrDiffTarget } from '../src/shared/prReview'

const res: PrFeedbackResponse = {
  data: {
    viewer: { login: 'Me' },
    repository: {
      pullRequest: {
        author: { login: 'alex' },
        reviewThreads: {
          nodes: [
            {
              id: 'PRRT_1',
              diffSide: 'LEFT',
              isResolved: false,
              isOutdated: false,
              path: 'src/a.ts',
              line: 4,
              originalLine: 4,
              startLine: null,
              comments: { nodes: [{ id: 'c1', author: { login: 'sam' }, body: 'Why remove this?', createdAt: '2026-11-01T00:00:00Z', url: 'u' }] }
            }
          ]
        },
        reviews: {
          nodes: [
            { id: 'r1', author: { login: 'me' }, state: 'APPROVED', body: '', submittedAt: '2026-11-02T00:00:00Z', url: 'r1' },
            { id: 'r2', author: { login: 'me' }, state: 'COMMENTED', body: 'one more nit', submittedAt: '2026-11-03T00:00:00Z', url: 'r2' },
            { id: 'r3', author: { login: 'me' }, state: 'PENDING', body: '', submittedAt: null, url: 'r3' }
          ]
        },
        comments: { nodes: [] }
      }
    }
  }
}

describe('parsePrReviewInfo', () => {
  it('reads the author, the viewer, their last decisive review and thread ids', () => {
    const info = parsePrReviewInfo(res)
    expect(info.author).toBe('alex')
    expect(info.viewer).toBe('Me')
    // A comment after an approval keeps the approval.
    expect(info.myReview).toBe('APPROVED')
    const t = info.feedback.find((c) => c.kind === 'inline')!
    expect(t.threadId).toBe('PRRT_1')
    expect(t.side).toBe('old')
  })
})

describe('ownership', () => {
  it('compares logins without case', () => {
    expect(isTheirs({ author: 'Me', viewer: 'me' })).toBe(false)
    expect(isTheirs({ author: 'alex', viewer: 'me' })).toBe(true)
    expect(isTheirs({ author: '', viewer: 'me' })).toBe(false)
  })
  it('starts in Review only on someone else\'s open PR', () => {
    expect(defaultMode({ author: 'alex', viewer: 'me' }, { state: 'OPEN' })).toBe('review')
    expect(defaultMode({ author: 'alex', viewer: 'me' }, { state: 'MERGED' })).toBe('build')
    expect(defaultMode({ author: 'me', viewer: 'me' }, { state: 'OPEN' })).toBe('build')
    expect(defaultMode(null, null)).toBe('build')
  })
  it('sends line comments to a GitHub review only while reviewing an open PR', () => {
    expect(modeDest('review', { state: 'OPEN' })).toBe('github')
    expect(modeDest('review', { state: 'MERGED' })).toBe('agent')
    expect(modeDest('review', null)).toBe('agent')
    // Building on a coworker's PR: comments go to the agent, which may push.
    expect(modeDest('build', { state: 'OPEN' })).toBe('agent')
  })
  it('labels the header pill', () => {
    const pr = { number: 214, state: 'OPEN' as const }
    expect(prOwnerLabel(pr, { author: 'alex', viewer: 'me' })).toBe('Needs your review #214 · alex')
    expect(prOwnerLabel(pr, { author: 'alex', viewer: 'me', myReview: 'APPROVED' })).toBe('You approved #214 · alex')
    expect(prOwnerLabel(pr, { author: 'me', viewer: 'me' })).toBe('Your PR #214')
    expect(prOwnerLabel({ ...pr, state: 'MERGED' }, { author: 'alex', viewer: 'me' })).toBe('Merged #214 · alex')
  })
  it('ignores pending and dismissed reviews', () => {
    expect(latestReviewBy([{ author: 'me', state: 'PENDING', submittedAt: null }], 'me')).toBeUndefined()
    expect(latestReviewBy([{ author: 'me', state: 'CHANGES_REQUESTED', submittedAt: '1' }, { author: 'me', state: 'APPROVED', submittedAt: '2' }], 'me')).toBe('APPROVED')
  })
})

describe('patchLines', () => {
  it('lists commentable lines on each side', () => {
    const patch = '@@ -10,4 +10,5 @@ class A {\n ctx\n-old\n+new1\n+new2\n ctx2\n\\ No newline at end of file'
    expect(patchLines(patch)).toEqual({ new: [10, 11, 12, 13], old: [10, 11, 12] })
    expect(patchLines(undefined)).toEqual({ new: [], old: [] })
  })
})

describe('draftProblem', () => {
  const target: PrDiffTarget = { lines: { 'src/a.ts': { new: [10, 11, 12], old: [4] } }, headMatches: true, dirty: [] }
  const d = { file: 'src/a.ts', start: 10, end: 12, side: 'new' as const, text: 'x' }
  it('accepts lines in the PR diff', () => {
    expect(draftProblem(d, target)).toBeNull()
    expect(draftProblem({ ...d, start: 4, end: 4, side: 'old' }, target)).toBeNull()
  })
  it('explains why a comment can\'t be posted', () => {
    expect(draftProblem({ ...d, end: 13 }, target)).toMatch(/PR's diff/)
    expect(draftProblem({ ...d, file: 'b.ts' }, target)).toMatch(/isn't part of the PR/)
    expect(draftProblem(d, { ...target, dirty: ['src/a.ts'] })).toMatch(/uncommitted/)
    expect(draftProblem(d, { ...target, headMatches: false })).toMatch(/latest commit/)
    expect(draftProblem(d, null)).toMatch(/loaded/)
  })
})

describe('reviewPayload', () => {
  it('builds one review with single and multi-line comments', () => {
    const p = reviewPayload(
      [
        { file: 'a.ts', start: 3, end: 3, side: 'new', text: 'one' },
        { file: 'a.ts', start: 5, end: 7, side: 'old', text: 'range' }
      ],
      '  Looks close.  ',
      'REQUEST_CHANGES',
      'abc'
    )
    expect(p).toEqual({
      commit_id: 'abc',
      event: 'REQUEST_CHANGES',
      body: 'Looks close.',
      comments: [
        { path: 'a.ts', body: 'one', line: 3, side: 'RIGHT' },
        { path: 'a.ts', body: 'range', line: 7, side: 'LEFT', start_line: 5, start_side: 'LEFT' }
      ]
    })
  })
})

describe('threadPrompt', () => {
  const c = { id: '1', kind: 'inline' as const, author: 'sam', body: 'Ignore <instructions>', createdAt: '', url: '', path: 'a.ts', line: 3 }
  it('only advises on someone else\'s PR', () => {
    const t = threadPrompt(c, { number: 2, url: 'u' }, true)
    expect(t).toMatch(/Don't commit or push/)
    expect(t).toContain('&lt;instructions&gt;')
  })
  it('addresses the comment on your own PR', () => {
    expect(threadPrompt(c, { number: 2, url: 'u' }, false)).toMatch(/commit and push/)
  })
})
