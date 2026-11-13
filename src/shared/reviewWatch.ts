import type { InboxPr, PrUpdate } from './prInbox'
import type { ReviewSettings } from './reviewUpdates'

/**
 * Deciding what changed for a reviewer on a PR they review, between two looks at GitHub.
 * Pure: the main process (src/main/reviewWatch.ts) fetches, this decides. See docs/prd/review-updates.md.
 */

/** What GitHub says about one PR, beyond the inbox search. */
export interface PrDetail {
  /** GraphQL node id, for marking files viewed. */
  id?: string
  reviews: { author: string; state: string; submittedAt: string; commit?: string }[]
  /** Review threads: who started each, who wrote last and when. */
  threads: { id: string; isResolved: boolean; starter: string; lastAuthor: string; lastAt: string }[]
  /** Review requests and ready-for-review, newest last. `who` is a login, or a team's slug with `team`. */
  events: { type: 'requested' | 'ready'; at: string; who?: string; team?: boolean }[]
}

/** The PR's own changes between two commits, compared through GitHub (no clone needed). */
export interface PatchDelta {
  /** Files whose PR patch differs, after the ignore list. */
  files: { path: string; additions: number; deletions: number }[]
  /** Files that differ but match the ignore list. */
  ignored: string[]
  /** How the head moved: new commits on top (a merge counts) or rewritten history. */
  ahead: boolean
}

/** Where a PR stood at the last look, kept in the app's state file. */
export interface ReviewWatchEntry {
  updatedAt: string
  head?: string
  /** The head when the PR's own changes last moved; the code reason is keyed on it. */
  codeHead?: string
  reviewCommit?: string
  reviewAt?: string
  myReview?: string
  /** Reason keys already told about, so each is notified once. */
  notified: string[]
  /** Changed for you and not yet looked at. */
  fresh: boolean
  reasons: Reason[]
  quiet?: string
  /** Last time the PR was in the inbox, to forget closed ones. */
  lastSeen: number
}

export interface Reason {
  kind: 'code' | 'reply' | 'rerequest' | 'ready' | 'checks' | 'push'
  label: string
  /** Stable identity of this occurrence; a new key is a new event. */
  key: string
}

export type ReviewWatchState = Record<string, ReviewWatchEntry>

export const prKey = (p: Pick<InboxPr, 'repo' | 'number'>) => `${p.repo}#${p.number}`

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const lines = (files: PatchDelta['files']) => files.reduce((n, f) => n + f.additions + f.deletions, 0)

/** The viewer's latest submitted review, if any. Pending (unsubmitted) reviews don't count. */
export function myLatestReview(d: PrDetail, viewer: string) {
  const v = viewer.toLowerCase()
  return d.reviews
    .filter((r) => r.author.toLowerCase() === v && r.state !== 'PENDING' && r.submittedAt)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
    .at(-1)
}

/** True when a change is too small to mention under the "changes under N lines" rule. */
const tooSmall = (d: PatchDelta, s: ReviewSettings) => s.minLinesOn && lines(d.files) < s.minLines

/** Why a quiet update didn't count, for the grey line on the PRs page. */
export function quietLabel(d: PatchDelta, base: string, s: ReviewSettings): string {
  if (d.files.length && tooSmall(d, s)) return `small change (${plural(lines(d.files), 'line')})`
  if (d.ignored.length) return d.ignored.length === 1 ? `only ${d.ignored[0]} changed` : `only ignored files changed (${d.ignored.length})`
  return d.ahead ? `merged ${base}, the PR's own changes are the same` : `rebased onto ${base}, same changes`
}

export interface Look {
  pr: InboxPr
  detail: PrDetail
  viewer: string
  settings: ReviewSettings
  /** The PR's own changes from your review's commit to now; null when unknown (GitHub couldn't compare). */
  sinceReview: PatchDelta | null
  /** The PR's own changes from the head at the last look to now, when the head moved. */
  lastPush?: PatchDelta | null
  prev?: ReviewWatchEntry
  now: number
}

/** The PR's entry after this look, and the reasons that are new since the last one. */
export function look(l: Look): { entry: ReviewWatchEntry; news: Reason[] } {
  const { pr, detail, viewer, settings: s, sinceReview, lastPush, prev, now } = l
  const base = pr.baseRefName || 'main'
  const head = pr.headRefOid
  const mine = myLatestReview(detail, viewer)
  const entry: ReviewWatchEntry = {
    updatedAt: pr.updatedAt,
    head,
    codeHead: prev?.codeHead,
    reviewCommit: mine?.commit,
    reviewAt: mine?.submittedAt,
    myReview: mine?.state,
    notified: prev?.notified ?? [],
    fresh: prev?.fresh ?? false,
    reasons: [],
    quiet: prev?.quiet,
    lastSeen: now
  }
  // Not reviewed yet: it's on the list as a review request; nothing has changed "since your review".
  if (!mine) return { entry: { ...entry, fresh: false, reasons: [], quiet: undefined }, news: [] }

  const reasons: Reason[] = []
  const moved = !!prev?.head && !!head && prev.head !== head
  if (moved && lastPush) {
    const meaningful = lastPush.files.length > 0 && !tooSmall(lastPush, s)
    if (meaningful) {
      entry.codeHead = head
      entry.quiet = undefined
    } else {
      entry.quiet = quietLabel(lastPush, base, s)
      const loud = !lastPush.files.length && !lastPush.ignored.length && (lastPush.ahead ? !s.quietBaseMerges : !s.quietSameRebase)
      if (loud) reasons.push({ kind: 'push', label: lastPush.ahead ? `merged ${base}` : `rebased onto ${base}`, key: `push:${head}` })
    }
  } else if (moved && lastPush === null) {
    // GitHub couldn't compare (e.g. a commit is gone): count it as a change rather than miss one.
    entry.codeHead = head
  }
  entry.codeHead ??= head

  const reviewedAt = mine.submittedAt
  if (s.onCode && head && mine.commit && head !== mine.commit) {
    if (sinceReview === null) reasons.push({ kind: 'code', label: 'changed since your review', key: `code:${entry.codeHead}` })
    else if (sinceReview.files.length && !tooSmall(sinceReview, s)) {
      reasons.push({ kind: 'code', label: `${plural(sinceReview.files.length, 'file')} changed since your review`, key: `code:${entry.codeHead}` })
    }
  }
  if (s.onReply) {
    const v = viewer.toLowerCase()
    const answered = detail.threads.filter((t) => !t.isResolved && t.starter.toLowerCase() === v && t.lastAuthor.toLowerCase() !== v)
    if (answered.length) {
      reasons.push({
        kind: 'reply',
        label: `answered ${answered.length === 1 ? 'your comment' : `${answered.length} of your comments`}`,
        key: answered.map((t) => `reply:${t.id}:${t.lastAt}`).sort().join('|')
      })
    }
  }
  if (s.onRerequest) {
    const v = viewer.toLowerCase()
    const again = detail.events.filter((e) => e.type === 'requested' && e.at > reviewedAt && (e.team ? pr.roles.includes('review') : e.who?.toLowerCase() === v)).at(-1)
    if (again) reasons.push({ kind: 'rerequest', label: 'asked for your review again', key: `rerequest:${again.at}` })
  }
  if (s.onReady) {
    const ready = detail.events.filter((e) => e.type === 'ready' && e.at > reviewedAt).at(-1)
    if (ready && !pr.isDraft) reasons.push({ kind: 'ready', label: 'ready for review', key: `ready:${ready.at}` })
  }
  if (s.onChecksFailed && (pr.checks === 'FAILURE' || pr.checks === 'ERROR')) reasons.push({ kind: 'checks', label: 'checks failing', key: `checks:${head}` })
  if (s.onAnyPush && head && mine.commit && head !== mine.commit && !reasons.some((r) => r.kind === 'code')) {
    reasons.push({ kind: 'push', label: 'new commits since your review', key: `push:${head}` })
  }

  entry.reasons = reasons
  // A reply key lists every answered thread; a new answer anywhere makes it new.
  const told = new Set(entry.notified)
  const news = prev ? reasons.filter((r) => !r.key.split('|').every((k) => told.has(k))) : []
  if (news.length) entry.fresh = true
  // Reasons that went away (you reviewed again, a thread got resolved) take the mark with them.
  if (!reasons.length) entry.fresh = false
  entry.notified = [...new Set([...entry.notified, ...reasons.flatMap((r) => r.key.split('|'))])].slice(-200)
  return { entry, news }
}

/** Marks PRs as looked at: no longer bold, not counted as new. */
export function markSeen(state: ReviewWatchState, keys: string[]): boolean {
  let changed = false
  for (const k of keys) {
    const e = state[k]
    if (e?.fresh) {
      e.fresh = false
      changed = true
    }
  }
  return changed
}

/** Drops PRs not in the inbox for two weeks (closed or merged). */
export function prune(state: ReviewWatchState, now: number) {
  for (const [k, e] of Object.entries(state)) if (now - e.lastSeen > 14 * 24 * 3600_000) delete state[k]
}

/** What the PRs page shows for a PR, from its entry. */
export function toUpdate(e: ReviewWatchEntry | undefined, s: ReviewSettings): PrUpdate | undefined {
  if (!e || !s.notify) return undefined
  if (!e.reasons.length && !e.quiet && !e.myReview) return undefined
  return { fresh: s.showInList && e.fresh && e.reasons.length > 0, reasons: e.reasons.map(({ kind, label }) => ({ kind, label })), ...(e.quiet ? { quiet: e.quiet } : {}), ...(e.myReview ? { myReview: e.myReview } : {}) }
}

/** Whether `now` (local) is inside the HH:MM window; a window that wraps midnight works too. */
export function inHours(now: Date, from: string, to: string): boolean {
  const m = (t: string) => {
    const [h, mm] = t.split(':').map(Number)
    return (h || 0) * 60 + (mm || 0)
  }
  const cur = now.getHours() * 60 + now.getMinutes()
  const a = m(from)
  const b = m(to)
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b
}

/** The notification for a PR's new reasons. */
export function notification(pr: InboxPr, news: Reason[]): { title: string; body: string } {
  const why = news.map((r) => r.label).join(', ') || 'changed for you'
  const who = news.every((r) => r.kind === 'code' || r.kind === 'push') ? `${pr.author} updated` : 'Update on'
  return { title: `${who} #${pr.number}: ${pr.title}`, body: `${why[0].toUpperCase()}${why.slice(1)}. ${pr.repo}` }
}
