/**
 * GitHub links in chat: which thing a URL points at, the short label its pill shows, and the
 * preview card's data shaped from GitHub's REST answers. The main process fetches (shared/ has no
 * I/O); the renderer draws. See docs/prd/link-previews.md.
 */

export type GithubLink =
  | { kind: 'pr'; owner: string; repo: string; number: number; url: string }
  | { kind: 'issue'; owner: string; repo: string; number: number; url: string }
  | { kind: 'commit'; owner: string; repo: string; sha: string; url: string }
  /** `rest` is everything after /blob/: the ref and path, split later because refs can hold slashes. */
  | { kind: 'file'; owner: string; repo: string; rest: string; start?: number; end?: number; url: string }
  | { kind: 'repo'; owner: string; repo: string; url: string }

/** First path segments on github.com that are pages, not owners. */
const NOT_OWNERS = new Set([
  'about', 'apps', 'blog', 'collections', 'contact', 'customer-stories', 'enterprise', 'events', 'explore', 'features',
  'login', 'logout', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'issues',
  'search', 'security', 'settings', 'site', 'sponsors', 'team', 'topics', 'trending', 'users', 'codespaces', 'copilot',
  'dashboard', 'join', 'readme', 'stars', 'watching', 'account', 'resources', 'solutions', 'signup',
])
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

/** What a link points at on GitHub, or null for anything that isn't a GitHub page we can preview. */
export function parseGithubLink(href: string | undefined | null): GithubLink | null {
  if (!href) return null
  let u: URL
  try {
    u = new URL(href.trim())
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol) || !/^(www\.)?github\.com$/i.test(u.hostname)) return null
  const seg = u.pathname.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  if (seg.length < 2) return null
  const [owner, rawRepo] = seg
  const repo = rawRepo.replace(/\.git$/, '')
  if (NOT_OWNERS.has(owner.toLowerCase()) || !NAME.test(owner) || !NAME.test(repo)) return null
  const url = u.toString()
  const base = { owner, repo, url }
  if (seg.length === 2) return { kind: 'repo', ...base }
  const [, , what, id] = seg
  if ((what === 'pull' || what === 'pulls') && /^\d+$/.test(id ?? '')) return { kind: 'pr', ...base, number: Number(id) }
  if (what === 'issues' && /^\d+$/.test(id ?? '')) return { kind: 'issue', ...base, number: Number(id) }
  if (what === 'commit' && /^[0-9a-f]{7,40}$/i.test(id ?? '')) return { kind: 'commit', ...base, sha: id.toLowerCase() }
  if (what === 'blob' && seg.length >= 5) {
    const m = u.hash.match(/^#L(\d+)(?:C\d+)?(?:-L(\d+)(?:C\d+)?)?$/)
    const start = m ? Number(m[1]) : undefined
    const end = m?.[2] ? Number(m[2]) : undefined
    return { kind: 'file', ...base, rest: seg.slice(3).join('/'), ...(start ? { start } : {}), ...(end ? { end } : {}) }
  }
  return null
}

/** The pill's text: `repo#12`, `repo@abc1234`, `file.ts:10-20` or `owner/repo`. */
export function githubLinkLabel(l: GithubLink): string {
  switch (l.kind) {
    case 'pr':
    case 'issue':
      return `${l.repo}#${l.number}`
    case 'commit':
      return `${l.repo}@${l.sha.slice(0, 7)}`
    case 'file': {
      const name = l.rest.split('/').pop() || l.rest
      return l.start ? `${name}:${l.start}${l.end && l.end !== l.start ? `-${l.end}` : ''}` : name
    }
    case 'repo':
      return `${l.owner}/${l.repo}`
  }
}

/** Whether a link's text is just its URL, so the pill can stand in for it. */
export function isBareLink(text: string, href: string): boolean {
  const strip = (s: string) => s.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '')
  return !!text && strip(text) === strip(href)
}

/** The ways a ref and path can be read from a blob URL's `rest`, shortest ref first. */
export function refPathSplits(rest: string, max = 4): { ref: string; path: string }[] {
  const parts = rest.split('/')
  const out: { ref: string; path: string }[] = []
  for (let i = 1; i < parts.length && i <= max; i++) out.push({ ref: parts.slice(0, i).join('/'), path: parts.slice(i).join('/') })
  return out
}

export type PrPreviewState = 'open' | 'draft' | 'merged' | 'closed'
export type IssuePreviewState = 'open' | 'completed' | 'not_planned' | 'closed'
export type ChecksSummary = { state: 'success' | 'failure' | 'pending'; passed: number; failed: number; pending: number; total: number }

export type LinkPreview =
  | {
      kind: 'pr'
      repo: string
      number: number
      title: string
      state: PrPreviewState
      author: string
      avatar?: string
      updatedAt: string
      additions: number
      deletions: number
      changedFiles: number
      comments: number
      base: string
      head: string
      isCrossRepository: boolean
      checks: ChecksSummary | null
      review: 'approved' | 'changes_requested' | 'review_required' | null
      url: string
    }
  | {
      kind: 'issue'
      repo: string
      number: number
      title: string
      state: IssuePreviewState
      author: string
      avatar?: string
      updatedAt: string
      labels: { name: string; color: string }[]
      assignees: string[]
      comments: number
      url: string
    }
  | { kind: 'commit'; repo: string; sha: string; message: string; author: string; avatar?: string; date: string; additions: number; deletions: number; files: number; url: string }
  | { kind: 'file'; repo: string; ref: string; path: string; start: number; lines: string[]; truncated: boolean; url: string }
  | { kind: 'repo'; repo: string; description: string; stars: number; language: string | null; openIssues: number; updatedAt: string; isPrivate: boolean; url: string }

/** The pill's colored dot: only PRs and issues have a state worth showing. */
export function previewDot(p: LinkPreview | undefined): PrPreviewState | IssuePreviewState | undefined {
  return p?.kind === 'pr' || p?.kind === 'issue' ? p.state : undefined
}


/* The functions below shape GitHub's REST JSON, so they take `any`. */

/** A PR from `GET /repos/{o}/{r}/pulls/{n}`, its reviews and its head commit's check runs. */
export function prPreview(pull: any, reviews: any[] | null, checkRuns: any[] | null): LinkPreview {
  const state: PrPreviewState = pull.merged_at || pull.merged ? 'merged' : pull.state === 'closed' ? 'closed' : pull.draft ? 'draft' : 'open'
  return {
    kind: 'pr',
    repo: pull.base?.repo?.full_name ?? '',
    number: pull.number,
    title: pull.title ?? '',
    state,
    author: pull.user?.login ?? 'ghost',
    ...(pull.user?.avatar_url ? { avatar: pull.user.avatar_url } : {}),
    updatedAt: pull.updated_at ?? '',
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    changedFiles: pull.changed_files ?? 0,
    comments: (pull.comments ?? 0) + (pull.review_comments ?? 0),
    base: pull.base?.ref ?? '',
    head: pull.head?.ref ?? '',
    isCrossRepository: !!pull.head?.repo && pull.head.repo.full_name !== pull.base?.repo?.full_name,
    checks: Array.isArray(checkRuns) ? checksSummary(checkRuns) : null,
    review: reviewState(Array.isArray(reviews) ? reviews : [], (pull.requested_reviewers?.length ?? 0) + (pull.requested_teams?.length ?? 0) > 0),
    url: pull.html_url ?? '',
  }
}

/** Passed, failed and running counts of check runs; null when there are none. Skipped and neutral runs count as passed. */
export function checksSummary(runs: any[]): ChecksSummary | null {
  // A re-run leaves the old run in the list; keep the newest per name.
  const latest = new Map<string, any>()
  for (const r of runs) {
    const prev = latest.get(r.name)
    if (!prev || (r.started_at ?? '') > (prev.started_at ?? '') || (r.id ?? 0) > (prev.id ?? 0)) latest.set(r.name, r)
  }
  let passed = 0
  let failed = 0
  let pending = 0
  for (const r of latest.values()) {
    if (r.status !== 'completed') pending++
    else if (['success', 'neutral', 'skipped'].includes(r.conclusion)) passed++
    else failed++
  }
  const total = passed + failed + pending
  if (!total) return null
  return { state: failed ? 'failure' : pending ? 'pending' : 'success', passed, failed, pending, total }
}

/** Each reviewer's last say decides: any change request wins, then approvals, then outstanding requests. */
export function reviewState(reviews: any[], requested: boolean): 'approved' | 'changes_requested' | 'review_required' | null {
  const last = new Map<string, string>()
  for (const r of reviews) {
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED') last.set(r.user?.login ?? '', r.state)
  }
  const states = [...last.values()]
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested'
  if (states.includes('APPROVED')) return 'approved'
  return requested ? 'review_required' : null
}

export function issuePreview(issue: any, repo: string): LinkPreview {
  const state: IssuePreviewState = issue.state === 'open' ? 'open' : issue.state_reason === 'not_planned' ? 'not_planned' : issue.state_reason === 'completed' ? 'completed' : 'closed'
  return {
    kind: 'issue',
    repo,
    number: issue.number,
    title: issue.title ?? '',
    state,
    author: issue.user?.login ?? 'ghost',
    ...(issue.user?.avatar_url ? { avatar: issue.user.avatar_url } : {}),
    updatedAt: issue.updated_at ?? '',
    labels: (issue.labels ?? []).map((l: any) => (typeof l === 'string' ? { name: l, color: '888888' } : { name: l.name, color: l.color || '888888' })),
    assignees: (issue.assignees ?? []).map((a: any) => a.login),
    comments: issue.comments ?? 0,
    url: issue.html_url ?? '',
  }
}

export function commitPreview(c: any, repo: string): LinkPreview {
  return {
    kind: 'commit',
    repo,
    sha: c.sha ?? '',
    message: c.commit?.message ?? '',
    author: c.author?.login ?? c.commit?.author?.name ?? 'unknown',
    ...(c.author?.avatar_url ? { avatar: c.author.avatar_url } : {}),
    date: c.commit?.author?.date ?? '',
    additions: c.stats?.additions ?? 0,
    deletions: c.stats?.deletions ?? 0,
    files: c.files?.length ?? 0,
    url: c.html_url ?? '',
  }
}


/** The lines a file link points at, at most `max`; the top of the file when it names no lines. */
export function fileExcerpt(text: string, start?: number, end?: number, max = 8): { start: number; lines: string[]; truncated: boolean } {
  const all = text.replace(/\r\n/g, '\n').split('\n')
  if (all.length && all[all.length - 1] === '') all.pop()
  const from = Math.min(Math.max(1, start ?? 1), Math.max(1, all.length))
  const want = Math.max(from, end ?? (start ? from : from + max - 1))
  const to = Math.min(all.length, want, from + max - 1)
  return { start: from, lines: all.slice(from - 1, to), truncated: to < Math.min(all.length, want) || (!start && all.length > to) }
}

/** "3d ago" style age for the card. */
export function shortAge(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!t) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}
