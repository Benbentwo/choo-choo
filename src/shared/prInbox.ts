/**
 * The PRs page: open pull requests across GitHub that wait on the person's review, or that they opened.
 * Read through the signed-in gh CLI, like every other GitHub call in the app.
 */

/** Why a PR is in the list. A PR can be both (someone re-requested a review of your own PR is rare, but possible). */
export type PrRole = 'review' | 'mine'

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
        number title url isDraft headRefName isCrossRepository updatedAt additions deletions reviewDecision
        author { login }
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }`

/** Both searches in one call. `archived:false` keeps PRs in archived repos out. */
export const PR_INBOX_QUERY = `query {
  review: search(query: "is:open is:pr archived:false review-requested:@me", type: ISSUE, first: 100) { nodes { ${FIELDS} } }
  mine: search(query: "is:open is:pr archived:false author:@me", type: ISSUE, first: 100) { nodes { ${FIELDS} } }
}`

interface RawPr {
  number?: number
  title: string
  url: string
  isDraft: boolean
  headRefName: string
  isCrossRepository: boolean
  updatedAt: string
  additions: number
  deletions: number
  reviewDecision: string | null
  author: { login: string } | null
  repository: { nameWithOwner: string }
  commits?: { nodes: ({ commit: { statusCheckRollup: { state: string } | null } } | null)[] | null }
}

type Raw = { data?: { review?: { nodes: (RawPr | null)[] | null }; mine?: { nodes: (RawPr | null)[] | null } } }

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
  add(raw.data?.mine?.nodes, 'mine')
  return [...byKey.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export type PrFilter = 'review' | 'mine' | 'all'

/** Groups by repo. Repos are ordered by their most recently updated PR; PRs keep their order. */
export function groupByRepo(prs: InboxPr[], filter: PrFilter): { repo: string; prs: InboxPr[] }[] {
  const groups = new Map<string, InboxPr[]>()
  for (const p of prs) {
    if (filter !== 'all' && !p.roles.includes(filter)) continue
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
