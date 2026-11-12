/**
 * The PRs page: open pull requests across GitHub that wait on the person's review, or that they opened.
 * Read through the signed-in gh CLI, like every other GitHub call in the app.
 */

/**
 * Why a PR is in the list. `review`: your review is requested now. `reviewed`: you reviewed it
 * (GitHub drops the request once you do). A PR can have several.
 */
export type PrRole = 'review' | 'reviewed' | 'mine'

/** What changed for you on a PR you review (shared/reviewWatch.ts). */
export interface PrUpdate {
  /** Changed for you since you last looked: bold with a dot, and counted as new. */
  fresh: boolean
  /** Why it matters, e.g. "3 files changed since your review". */
  reasons: { kind: string; label: string }[]
  /** What the last update was when it didn't matter, e.g. "merged main, the PR's own changes are the same". */
  quiet?: string
  /** Your latest review: APPROVED, CHANGES_REQUESTED or COMMENTED. */
  myReview?: string
}

export interface InboxPr {
  /** owner/repo */
  repo: string
  number: number
  title: string
  url: string
  author: string
  isDraft: boolean
  headRefName: string
  isCrossRepository: boolean
  updatedAt: string
  additions: number
  deletions: number
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or null. */
  reviewDecision: string | null
  /** SUCCESS, FAILURE, PENDING, ERROR, EXPECTED, or null when there are no checks. */
  checks: string | null
  roles: PrRole[]
  /** The PR's head commit. */
  headRefOid?: string
  /** The branch it merges into. */
  baseRefName?: string
  /** Review updates for PRs you review; missing when there is nothing to say. */
  update?: PrUpdate
  /** The local project for this repo, when it has been added to Choo Choo. */
  repoId?: string
  /** An open workspace already checked out on this PR's branch. */
  workspaceId?: string
}

export interface PrInbox {
  prs: InboxPr[]
  fetchedAt: number
}

const FIELDS = `... on PullRequest {
        number title url isDraft headRefName headRefOid baseRefName isCrossRepository updatedAt additions deletions reviewDecision
        author { login }
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }`

const SEARCH: Record<PrRole, string> = {
  review: 'is:open is:pr archived:false review-requested:@me',
  reviewed: 'is:open is:pr archived:false reviewed-by:@me -author:@me',
  mine: 'is:open is:pr archived:false author:@me'
}

/**
 * One search per call, newest first. Both lists of 100 with CI status in one query made GitHub
 * time out (HTTP 502 after about 10 s), so they go as two smaller requests. `archived:false`
 * keeps PRs in archived repos out.
 */
export function prInboxQuery(role: PrRole, first: number): string {
  return `query {
  ${role}: search(query: "${SEARCH[role]} sort:updated-desc", type: ISSUE, first: ${first}) { nodes { ${FIELDS} } }
}`
}

interface RawPr {
  number?: number
  title: string
  url: string
  isDraft: boolean
  headRefName: string
  headRefOid?: string
  baseRefName?: string
  isCrossRepository: boolean
  updatedAt: string
  additions: number
  deletions: number
  reviewDecision: string | null
  author: { login: string } | null
  repository: { nameWithOwner: string }
  commits?: { nodes: ({ commit: { statusCheckRollup: { state: string } | null } } | null)[] | null }
}

type Nodes = { nodes: (RawPr | null)[] | null }
type Raw = { data?: { review?: Nodes; reviewed?: Nodes; mine?: Nodes } }

/** Merges the two searches into one list, newest activity first, with each PR once. */
export function parsePrInbox(raw: Raw): InboxPr[] {
  const byKey = new Map<string, InboxPr>()
  const add = (nodes: (RawPr | null)[] | null | undefined, role: PrRole) => {
    for (const n of nodes ?? []) {
      if (!n || typeof n.number !== 'number' || !n.repository) continue
      const key = `${n.repository.nameWithOwner}#${n.number}`
      const seen = byKey.get(key)
      if (seen) {
        if (!seen.roles.includes(role)) seen.roles.push(role)
        continue
      }
      byKey.set(key, {
        repo: n.repository.nameWithOwner,
        number: n.number,
        title: n.title,
        url: n.url,
        author: n.author?.login ?? 'ghost',
        isDraft: n.isDraft,
        headRefName: n.headRefName,
        ...(n.headRefOid ? { headRefOid: n.headRefOid } : {}),
        ...(n.baseRefName ? { baseRefName: n.baseRefName } : {}),
        isCrossRepository: n.isCrossRepository,
        updatedAt: n.updatedAt,
        additions: n.additions ?? 0,
        deletions: n.deletions ?? 0,
        reviewDecision: n.reviewDecision ?? null,
        checks: n.commits?.nodes?.[0]?.commit.statusCheckRollup?.state ?? null,
        roles: [role]
      })
    }
  }
  add(raw.data?.review?.nodes, 'review')
  add(raw.data?.reviewed?.nodes, 'reviewed')
  add(raw.data?.mine?.nodes, 'mine')
  return [...byKey.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export type PrFilter = 'review' | 'updated' | 'mine' | 'all'

/** On the To review list: your review is asked for, or you've reviewed it and it's still open. */
export const isReviewing = (p: Pick<InboxPr, 'roles'>) => p.roles.includes('review') || p.roles.includes('reviewed')

export function matchesFilter(p: InboxPr, filter: PrFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'review') return isReviewing(p)
  if (filter === 'updated') return !!p.update?.fresh
  return p.roles.includes('mine')
}

/** PRs not hidden by the PRs page filter: an entry is an org ("owner") or a repo ("owner/repo"), any case. */
export function visiblePrs(prs: InboxPr[], hidden: string[] | undefined): InboxPr[] {
  if (!hidden?.length) return prs
  const h = new Set(hidden.map((x) => x.toLowerCase()))
  return prs.filter((p) => {
    const repo = p.repo.toLowerCase()
    return !h.has(repo) && !h.has(repo.split('/')[0])
  })
}

/** Orgs and their repos among these PRs, with counts, for the filter menu. Sorted by name. */
export function orgsAndRepos(prs: InboxPr[]): { org: string; count: number; repos: { repo: string; count: number }[] }[] {
  const orgs = new Map<string, Map<string, number>>()
  for (const p of prs) {
    const org = p.repo.split('/')[0]
    const repos = orgs.get(org) ?? new Map<string, number>()
    repos.set(p.repo, (repos.get(p.repo) ?? 0) + 1)
    orgs.set(org, repos)
  }
  return [...orgs]
    .map(([org, repos]) => ({ org, count: [...repos.values()].reduce((a, b) => a + b, 0), repos: [...repos].map(([repo, count]) => ({ repo, count })).sort((a, b) => a.repo.localeCompare(b.repo)) }))
    .sort((a, b) => a.org.localeCompare(b.org))
}

/** Groups by repo. Repos are ordered by their most recently updated PR; PRs keep their order. */
export function groupByRepo(prs: InboxPr[], filter: PrFilter): { repo: string; prs: InboxPr[] }[] {
  const groups = new Map<string, InboxPr[]>()
  for (const p of prs) {
    if (!matchesFilter(p, filter)) continue
    const list = groups.get(p.repo) ?? []
    list.push(p)
    groups.set(p.repo, list)
  }
  return [...groups.entries()].map(([repo, prs]) => ({ repo, prs }))
}

/** The local branch a workspace for this PR uses; matches how the main process checks PRs out. */
export function prBranch(pr: Pick<InboxPr, 'number' | 'headRefName' | 'isCrossRepository'>): string {
  return pr.isCrossRepository ? `pr-${pr.number}` : pr.headRefName
}
