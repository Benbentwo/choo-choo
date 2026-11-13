import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as store from './store'
import type { InboxPr, PrInbox } from '@shared/prInbox'
import { activeGlobs, comparePatches, normalizeReviewSettings, type FilePatch, type ReviewSettings } from '@shared/reviewUpdates'
import { inHours, look, markSeen, notification, prKey, prune, toUpdate, type PatchDelta, type PrDetail, type Reason } from '@shared/reviewWatch'

const exec = promisify(execFile)

/**
 * Review updates: looks at the PRs you review every few minutes (Settings › Reviews), works out
 * what changed for you, marks those PRs on the PRs page and sends a notification. GitHub can't call
 * a desktop app, so this polls through gh: one search per list, details only for PRs that moved.
 */

export interface ReviewWatchDeps {
  /** The PRs page list, tied to local projects and workspaces. */
  loadInbox: () => Promise<PrInbox>
  /** Shows an OS notification; clicking it opens the PR. */
  notify: (pr: InboxPr, title: string, body: string) => void
  /** Sends the annotated list to the window. */
  broadcast: (inbox: PrInbox) => void
  /** PRs that changed for you, for automations listening for that. */
  onUpdates?: (updates: { pr: InboxPr; reasons: Reason[] }[]) => void
}

let deps: ReviewWatchDeps | null = null
let timer: NodeJS.Timeout | null = null
let running: Promise<PrInbox> | null = null
let last: PrInbox | null = null
let lastRun = 0

const settings = (): ReviewSettings => normalizeReviewSettings(store.get().settings.reviews)
const watchState = () => (store.get().reviewWatch ??= {})

async function gh(args: string[]): Promise<string> {
  const { stdout } = await exec('gh', args, { maxBuffer: 32 * 1024 * 1024, timeout: 30_000 })
  return stdout
}

const q = (s: string) => JSON.stringify(s)

/** One GraphQL query for several PRs' reviews, threads and request events. */
export function detailQuery(prs: Pick<InboxPr, 'repo' | 'number'>[]): string {
  const parts = prs.map((p, i) => {
    const [owner, name] = p.repo.split('/')
    return `p${i}: repository(owner: ${q(owner)}, name: ${q(name)}) { pullRequest(number: ${p.number}) {
      id
      reviews(last: 40) { nodes { author { login } state submittedAt commit { oid } } }
      reviewThreads(last: 60) { nodes { id isResolved first: comments(first: 1) { nodes { author { login } } } last: comments(last: 1) { nodes { author { login } createdAt } } } }
      timelineItems(last: 30, itemTypes: [REVIEW_REQUESTED_EVENT, READY_FOR_REVIEW_EVENT]) { nodes { __typename
        ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } ... on Team { slug } } }
        ... on ReadyForReviewEvent { createdAt } } }
    } }`
  })
  return `query { viewer { login }\n${parts.join('\n')} }`
}

type Login = { login?: string } | null
interface RawDetail {
  id?: string
  reviews?: { nodes: ({ author: Login; state: string; submittedAt: string | null; commit: { oid: string } | null } | null)[] }
  reviewThreads?: { nodes: ({ id: string; isResolved: boolean; first: { nodes: ({ author: Login } | null)[] }; last: { nodes: ({ author: Login; createdAt: string } | null)[] } } | null)[] }
  timelineItems?: { nodes: ({ __typename: string; createdAt: string; requestedReviewer?: { __typename: string; login?: string; slug?: string } | null } | null)[] }
}

export function parseDetail(raw: RawDetail | null | undefined): PrDetail | null {
  if (!raw) return null
  const login = (a: Login) => a?.login ?? 'ghost'
  return {
    id: raw.id,
    reviews: (raw.reviews?.nodes ?? []).flatMap((r) => (r && r.submittedAt ? [{ author: login(r.author), state: r.state, submittedAt: r.submittedAt, commit: r.commit?.oid }] : [])),
    threads: (raw.reviewThreads?.nodes ?? []).flatMap((t) => {
      const lastC = t?.last.nodes.at(-1)
      return t && lastC ? [{ id: t.id, isResolved: t.isResolved, starter: login(t.first.nodes[0]?.author ?? null), lastAuthor: login(lastC.author), lastAt: lastC.createdAt }] : []
    }),
    events: (raw.timelineItems?.nodes ?? []).flatMap((e): PrDetail['events'] => {
      if (!e) return []
      if (e.__typename === 'ReadyForReviewEvent') return [{ type: 'ready', at: e.createdAt }]
      const r = e.requestedReviewer
      if (!r) return []
      return [r.__typename === 'Team' ? { type: 'requested', at: e.createdAt, who: r.slug, team: true } : { type: 'requested', at: e.createdAt, who: r.login }]
    })
  }
}

async function loadDetails(prs: InboxPr[]): Promise<{ viewer: string; details: Map<string, PrDetail> }> {
  const details = new Map<string, PrDetail>()
  let viewer = ''
  for (let i = 0; i < prs.length; i += 5) {
    const batch = prs.slice(i, i + 5)
    try {
      const out = JSON.parse(await gh(['api', 'graphql', '-f', `query=${detailQuery(batch)}`])) as { data?: Record<string, { pullRequest?: RawDetail } | { login: string }> }
      viewer ||= (out.data?.viewer as { login?: string } | undefined)?.login ?? ''
      batch.forEach((p, j) => {
        const d = parseDetail((out.data?.[`p${j}`] as { pullRequest?: RawDetail } | undefined)?.pullRequest)
        if (d) details.set(prKey(p), d)
      })
    } catch {
      // One bad batch (a repo gone, a timeout) shouldn't stop the rest; they're tried next time.
    }
  }
  return { viewer, details }
}

/** Each file's PR patch as of `sha`: GitHub's three-dot compare against the base branch. */
const patchCache = new Map<string, Promise<FilePatch[] | null>>()
function patchesAt(repo: string, base: string, sha: string): Promise<FilePatch[] | null> {
  const key = `${repo}|${base}|${sha}`
  let p = patchCache.get(key)
  if (!p) {
    p = gh(['api', `repos/${repo}/compare/${encodeURIComponent(base)}...${sha}`, '--jq', '[.files[]? | {path: .filename, patch}]'])
      .then((out) => (JSON.parse(out || '[]') as { path: string; patch: string | null }[]).map((f) => (f.patch == null ? { path: f.path } : { path: f.path, patch: f.patch })))
      .catch(() => {
        patchCache.delete(key)
        return null
      })
    patchCache.set(key, p)
    if (patchCache.size > 300) patchCache.delete(patchCache.keys().next().value as string)
  }
  return p
}

/** The PR's own changes between two of its commits, without a clone. Null when GitHub can't compare. */
export async function patchDelta(repo: string, base: string, from: string, to: string, ignore: string[]): Promise<PatchDelta | null> {
  const [a, b, status] = await Promise.all([
    patchesAt(repo, base, from),
    patchesAt(repo, base, to),
    gh(['api', `repos/${repo}/compare/${from}...${to}`, '--jq', '.status']).then((s) => s.trim(), () => '')
  ])
  if (!a || !b) return null
  const { changed, ignored } = comparePatches(a, b, ignore)
  return { files: changed, ignored, ahead: status === 'ahead' || status === 'identical' }
}

/** Looks at GitHub now and returns the PRs list with review updates on it. Calls during a run share it. */
export function check(): Promise<PrInbox> {
  if (!deps) return Promise.reject(new Error('Review updates are not started'))
  running ??= run(deps).finally(() => {
    running = null
  })
  return running
}

/** Checks unless the last check was under `ms` ago; returns the latest list either way. */
export async function checkSoon(ms = 15_000): Promise<PrInbox | null> {
  if (last && Date.now() - lastRun < ms) return last
  return check().catch(() => last)
}

async function run(d: ReviewWatchDeps): Promise<PrInbox> {
  const inbox = await d.loadInbox()
  lastRun = Date.now()
  const s = settings()
  const state = watchState()
  const now = Date.now()
  const reviewing = inbox.prs.filter((p) => (p.roles.includes('review') || p.roles.includes('reviewed')) && !p.roles.includes('mine'))
  const moved = s.notify ? reviewing.filter((p) => state[prKey(p)]?.updatedAt !== p.updatedAt) : []
  const updates: { pr: InboxPr; reasons: Reason[] }[] = []
  if (moved.length) {
    const { viewer, details } = await loadDetails(moved)
    const ignore = activeGlobs(s)
    for (const pr of moved) {
      const detail = details.get(prKey(pr))
      if (!detail || !viewer || !pr.headRefOid) continue
      const prev = state[prKey(pr)]
      const base = pr.baseRefName || 'main'
      const mine = detail.reviews.filter((r) => r.author.toLowerCase() === viewer.toLowerCase()).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).at(-1)
      const sinceReview = mine?.commit && mine.commit !== pr.headRefOid ? await patchDelta(pr.repo, base, mine.commit, pr.headRefOid, ignore) : { files: [], ignored: [], ahead: true }
      const lastPush = prev?.head && prev.head !== pr.headRefOid ? await patchDelta(pr.repo, base, prev.head, pr.headRefOid, ignore) : undefined
      const { entry, news } = look({ pr, detail, viewer, settings: s, sinceReview, lastPush, prev, now })
      state[prKey(pr)] = entry
      if (news.length) updates.push({ pr, reasons: news })
    }
  }
  for (const p of reviewing) {
    const e = state[prKey(p)]
    if (e) e.lastSeen = now
  }
  prune(state, now)
  store.save()

  for (const p of inbox.prs) {
    const u = toUpdate(state[prKey(p)], s)
    if (u) p.update = u
  }
  if (updates.length) {
    if (s.osNotify && (!s.quietHoursOn || inHours(new Date(), s.from, s.to))) {
      for (const u of updates) {
        const n = notification(u.pr, u.reasons)
        d.notify(u.pr, n.title, n.body)
      }
    }
    d.onUpdates?.(updates)
  }
  last = inbox
  d.broadcast(inbox)
  return inbox
}

/** Marks PRs as looked at (opened, or Mark all seen) and sends the updated list. */
export function seen(keys: string[]) {
  if (!markSeen(watchState(), keys)) return
  store.save()
  if (last && deps) {
    const s = settings()
    for (const p of last.prs) {
      const u = toUpdate(watchState()[prKey(p)], s)
      if (u) p.update = u
      else delete p.update
    }
    deps.broadcast(last)
  }
}

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(
    () => {
      void check()
        .catch(() => {})
        .finally(schedule)
    },
    settings().pollMinutes * 60_000
  )
}

export function start(d: ReviewWatchDeps) {
  deps = d
  // First look soon after start, so the list and marks are fresh without opening the PRs page.
  setTimeout(() => void check().catch(() => {}), 10_000)
  schedule()
}

/** The interval changed in Settings: start counting again from now. */
export function reschedule() {
  if (deps) schedule()
}
