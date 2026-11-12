import { describe, it, expect } from 'vitest'
import { inHours, look, markSeen, notification, toUpdate, type PrDetail, type PatchDelta, type ReviewWatchEntry } from '../src/shared/reviewWatch'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '../src/shared/reviewUpdates'
import { parseDetail, detailQuery } from '../src/main/reviewWatch'
import { groupByRepo, matchesFilter, parsePrInbox, type InboxPr } from '../src/shared/prInbox'

const pr = (over: Partial<InboxPr> = {}): InboxPr => ({
  repo: 'example-org/web-app',
  number: 61,
  title: 'Sidebar: drag workspaces',
  url: 'https://github.com/example-org/web-app/pull/61',
  author: 'dana',
  isDraft: false,
  headRefName: 'drag',
  headRefOid: 'h2',
  baseRefName: 'main',
  isCrossRepository: false,
  updatedAt: '2026-11-12T10:00:00Z',
  additions: 10,
  deletions: 2,
  reviewDecision: null,
  checks: 'SUCCESS',
  roles: ['reviewed'],
  ...over
})

const detail = (over: Partial<PrDetail> = {}): PrDetail => ({
  reviews: [{ author: 'me', state: 'CHANGES_REQUESTED', submittedAt: '2026-11-10T09:00:00Z', commit: 'h1' }],
  threads: [],
  events: [],
  ...over
})

const delta = (files: PatchDelta['files'] = [], over: Partial<PatchDelta> = {}): PatchDelta => ({ files, ignored: [], ahead: true, ...over })
const s = (over: Partial<ReviewSettings> = {}): ReviewSettings => ({ ...DEFAULT_REVIEW_SETTINGS, ...over })
const f = (path: string, additions = 3, deletions = 1) => ({ path, additions, deletions })

/** The entry after a first look at h1 (when you reviewed), with nothing new. */
const seenAt = (head: string, over: Partial<ReviewWatchEntry> = {}): ReviewWatchEntry => ({
  updatedAt: 'x',
  head,
  codeHead: head,
  reviewCommit: 'h1',
  notified: [],
  fresh: false,
  reasons: [],
  lastSeen: 0,
  ...over
})

describe('look', () => {
  it('a first look records where things stand without notifying', () => {
    const r = look({ pr: pr(), detail: detail(), viewer: 'me', settings: s(), sinceReview: delta([f('a.ts')]), now: 1 })
    expect(r.news).toEqual([])
    expect(r.entry.reasons.map((x) => x.label)).toEqual(['1 file changed since your review'])
    expect(r.entry.fresh).toBe(false)
  })

  it('a push with new code is news and marks the PR', () => {
    const r = look({ pr: pr(), detail: detail(), viewer: 'me', settings: s(), sinceReview: delta([f('a.ts'), f('b.ts')]), lastPush: delta([f('b.ts')]), prev: seenAt('h1'), now: 1 })
    expect(r.news.map((x) => x.label)).toEqual(['2 files changed since your review'])
    expect(r.entry.fresh).toBe(true)
    expect(r.entry.codeHead).toBe('h2')
  })

  it('a merge from main stays quiet and says why', () => {
    const prev = seenAt('h2', { codeHead: 'h2', notified: ['code:h2'], reasons: [{ kind: 'code', label: 'x', key: 'code:h2' }] })
    const r = look({ pr: pr({ headRefOid: 'h3' }), detail: detail(), viewer: 'me', settings: s(), sinceReview: delta([f('a.ts')]), lastPush: delta([], { ahead: true }), prev, now: 1 })
    expect(r.news).toEqual([])
    expect(r.entry.codeHead).toBe('h2')
    expect(r.entry.quiet).toBe("merged main, the PR's own changes are the same")
    // The earlier code reason still stands; its key didn't change, so it isn't news.
    expect(r.entry.reasons.map((x) => x.key)).toEqual(['code:h2'])
  })

  it('a clean rebase stays quiet; turning the rule off makes it news', () => {
    const quiet = look({ pr: pr({ headRefOid: 'h3' }), detail: detail(), viewer: 'me', settings: s(), sinceReview: delta(), lastPush: delta([], { ahead: false }), prev: seenAt('h1'), now: 1 })
    expect(quiet.news).toEqual([])
    expect(quiet.entry.quiet).toBe('rebased onto main, same changes')
    const loud = look({ pr: pr({ headRefOid: 'h3' }), detail: detail(), viewer: 'me', settings: s({ quietSameRebase: false }), sinceReview: delta(), lastPush: delta([], { ahead: false }), prev: seenAt('h1'), now: 1 })
    expect(loud.news.map((x) => x.label)).toEqual(['rebased onto main'])
  })

  it('only ignored files or a small change stay quiet', () => {
    const ignored = look({ pr: pr(), detail: detail(), viewer: 'me', settings: s(), sinceReview: delta([], { ignored: ['package-lock.json'] }), lastPush: delta([], { ignored: ['package-lock.json'] }), prev: seenAt('h1'), now: 1 })
    expect(ignored.news).toEqual([])
    expect(ignored.entry.quiet).toBe('only package-lock.json changed')
    const small = look({ pr: pr(), detail: detail(), viewer: 'me', settings: s({ minLinesOn: true, minLines: 5 }), sinceReview: delta([f('a.ts', 1, 1)]), lastPush: delta([f('a.ts', 1, 1)]), prev: seenAt('h1'), now: 1 })
    expect(small.news).toEqual([])
    expect(small.entry.quiet).toBe('small change (2 lines)')
  })

  it('answers on your threads, once each', () => {
    const d = detail({
      threads: [
        { id: 't1', isResolved: false, starter: 'me', lastAuthor: 'dana', lastAt: '2026-11-12T09:00:00Z' },
        { id: 't2', isResolved: false, starter: 'me', lastAuthor: 'me', lastAt: '2026-11-11T09:00:00Z' },
        { id: 't3', isResolved: true, starter: 'me', lastAuthor: 'dana', lastAt: '2026-11-12T09:00:00Z' },
        { id: 't4', isResolved: false, starter: 'sam', lastAuthor: 'dana', lastAt: '2026-11-12T09:00:00Z' }
      ]
    })
    const r = look({ pr: pr({ headRefOid: 'h1' }), detail: d, viewer: 'me', settings: s(), sinceReview: delta(), prev: seenAt('h1'), now: 1 })
    expect(r.news.map((x) => x.label)).toEqual(['answered your comment'])
    const again = look({ pr: pr({ headRefOid: 'h1' }), detail: d, viewer: 'me', settings: s(), sinceReview: delta(), prev: r.entry, now: 2 })
    expect(again.news).toEqual([])
  })

  it('asked again after your review, directly or through a team you are requested by', () => {
    const d = detail({ events: [{ type: 'requested', at: '2026-11-09T00:00:00Z', who: 'me' }, { type: 'requested', at: '2026-11-11T00:00:00Z', who: 'me' }] })
    const r = look({ pr: pr({ headRefOid: 'h1', roles: ['review'] }), detail: d, viewer: 'me', settings: s(), sinceReview: delta(), prev: seenAt('h1'), now: 1 })
    expect(r.news.map((x) => x.label)).toEqual(['asked for your review again'])
    const team = detail({ events: [{ type: 'requested', at: '2026-11-11T00:00:00Z', who: 'web', team: true }] })
    expect(look({ pr: pr({ headRefOid: 'h1', roles: ['reviewed'] }), detail: team, viewer: 'me', settings: s(), sinceReview: delta(), prev: seenAt('h1'), now: 1 }).news).toEqual([])
    expect(look({ pr: pr({ headRefOid: 'h1', roles: ['review'] }), detail: team, viewer: 'me', settings: s(), sinceReview: delta(), prev: seenAt('h1'), now: 1 }).news).toHaveLength(1)
  })

  it('ready for review, failing checks and any push follow their switches', () => {
    const d = detail({ events: [{ type: 'ready', at: '2026-11-11T00:00:00Z' }] })
    const base = { pr: pr({ checks: 'FAILURE' }), detail: d, viewer: 'me', sinceReview: delta(), lastPush: delta(), prev: seenAt('h1'), now: 1 }
    expect(look({ ...base, settings: s() }).news.map((x) => x.kind)).toEqual(['ready'])
    expect(look({ ...base, settings: s({ onChecksFailed: true, onAnyPush: true }) }).news.map((x) => x.kind)).toEqual(['ready', 'checks', 'push'])
    expect(look({ ...base, settings: s({ onReady: false }) }).news).toEqual([])
  })

  it('reviewing again clears the mark', () => {
    const prev = seenAt('h2', { fresh: true, reasons: [{ kind: 'code', label: 'x', key: 'code:h2' }], notified: ['code:h2'] })
    const d = detail({ reviews: [...detail().reviews, { author: 'me', state: 'APPROVED', submittedAt: '2026-11-12T11:00:00Z', commit: 'h2' }] })
    const r = look({ pr: pr(), detail: d, viewer: 'me', settings: s(), sinceReview: delta(), prev, now: 1 })
    expect(r.entry.fresh).toBe(false)
    expect(r.entry.myReview).toBe('APPROVED')
  })

  it('PRs you haven\'t reviewed have nothing to say', () => {
    const r = look({ pr: pr({ roles: ['review'] }), detail: detail({ reviews: [] }), viewer: 'me', settings: s(), sinceReview: null, prev: seenAt('h1'), now: 1 })
    expect(r.entry.reasons).toEqual([])
    expect(toUpdate(r.entry, s())).toBeUndefined()
  })

  it('GitHub unable to compare still counts as changed', () => {
    const r = look({ pr: pr(), detail: detail(), viewer: 'me', settings: s(), sinceReview: null, lastPush: null, prev: seenAt('h1'), now: 1 })
    expect(r.news.map((x) => x.label)).toEqual(['changed since your review'])
  })
})

describe('seen, list and notifications', () => {
  it('markSeen clears the mark and toUpdate respects the switches', () => {
    const e = seenAt('h2', { fresh: true, reasons: [{ kind: 'code', label: '2 files changed since your review', key: 'code:h2' }], myReview: 'COMMENTED' })
    expect(toUpdate(e, s())).toEqual({ fresh: true, reasons: [{ kind: 'code', label: '2 files changed since your review' }], myReview: 'COMMENTED' })
    expect(toUpdate(e, s({ showInList: false }))?.fresh).toBe(false)
    expect(toUpdate(e, s({ notify: false }))).toBeUndefined()
    const state = { k: e }
    expect(markSeen(state, ['k'])).toBe(true)
    expect(state.k.fresh).toBe(false)
    expect(markSeen(state, ['k'])).toBe(false)
  })

  it('quiet hours, including across midnight', () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m)
    expect(inHours(at(10), '09:00', '18:00')).toBe(true)
    expect(inHours(at(18), '09:00', '18:00')).toBe(false)
    expect(inHours(at(23), '22:00', '06:00')).toBe(true)
    expect(inHours(at(7), '22:00', '06:00')).toBe(false)
  })

  it('notification text', () => {
    expect(notification(pr(), [{ kind: 'code', label: '3 files changed since your review', key: 'k' }])).toEqual({
      title: 'dana updated #61: Sidebar: drag workspaces',
      body: '3 files changed since your review. example-org/web-app'
    })
    expect(notification(pr(), [{ kind: 'reply', label: 'answered your comment', key: 'k' }]).title).toBe('Update on #61: Sidebar: drag workspaces')
  })

  it('To review includes PRs you reviewed; Updated for you only fresh ones', () => {
    const prs = [pr({ number: 1, roles: ['review'] }), pr({ number: 2, roles: ['reviewed'], update: { fresh: true, reasons: [] } }), pr({ number: 3, roles: ['mine'] })]
    expect(groupByRepo(prs, 'review')[0].prs.map((p) => p.number)).toEqual([1, 2])
    expect(prs.filter((p) => matchesFilter(p, 'updated')).map((p) => p.number)).toEqual([2])
  })

  it('parses the reviewed search and head commit', () => {
    const node = { number: 7, title: 't', url: 'u', isDraft: false, headRefName: 'b', headRefOid: 'abc', baseRefName: 'main', isCrossRepository: false, updatedAt: '2026-11-12T00:00:00Z', additions: 1, deletions: 0, reviewDecision: null, author: { login: 'a' }, repository: { nameWithOwner: 'o/r' } }
    const prs = parsePrInbox({ data: { review: { nodes: [] }, reviewed: { nodes: [node] }, mine: { nodes: [] } } })
    expect(prs[0]).toMatchObject({ roles: ['reviewed'], headRefOid: 'abc', baseRefName: 'main' })
  })
})

describe('GitHub details', () => {
  it('builds one query for several PRs', () => {
    const qy = detailQuery([{ repo: 'o/r', number: 1 }, { repo: 'o/s', number: 2 }])
    expect(qy).toContain('p0: repository(owner: "o", name: "r") { pullRequest(number: 1)')
    expect(qy).toContain('p1: repository(owner: "o", name: "s") { pullRequest(number: 2)')
    expect(qy).toContain('viewer { login }')
  })

  it('parses reviews, threads and events', () => {
    const d = parseDetail({
      id: 'PR_1',
      reviews: { nodes: [{ author: { login: 'me' }, state: 'COMMENTED', submittedAt: '2026-11-10T00:00:00Z', commit: { oid: 'h1' } }, { author: { login: 'me' }, state: 'PENDING', submittedAt: null, commit: null }] },
      reviewThreads: { nodes: [{ id: 't1', isResolved: false, first: { nodes: [{ author: { login: 'me' } }] }, last: { nodes: [{ author: { login: 'dana' }, createdAt: '2026-11-11T00:00:00Z' }] } }] },
      timelineItems: {
        nodes: [
          { __typename: 'ReviewRequestedEvent', createdAt: '2026-11-11T00:00:00Z', requestedReviewer: { __typename: 'User', login: 'me' } },
          { __typename: 'ReviewRequestedEvent', createdAt: '2026-11-11T01:00:00Z', requestedReviewer: { __typename: 'Team', slug: 'web' } },
          { __typename: 'ReadyForReviewEvent', createdAt: '2026-11-11T02:00:00Z' }
        ]
      }
    })
    expect(d).toEqual({
      id: 'PR_1',
      reviews: [{ author: 'me', state: 'COMMENTED', submittedAt: '2026-11-10T00:00:00Z', commit: 'h1' }],
      threads: [{ id: 't1', isResolved: false, starter: 'me', lastAuthor: 'dana', lastAt: '2026-11-11T00:00:00Z' }],
      events: [
        { type: 'requested', at: '2026-11-11T00:00:00Z', who: 'me' },
        { type: 'requested', at: '2026-11-11T01:00:00Z', who: 'web', team: true },
        { type: 'ready', at: '2026-11-11T02:00:00Z' }
      ]
    })
  })
})
