import type { InboxPr } from './prInbox'

/**
 * Temporary filters on the PRs page: small dropdowns for the few fields that matter. They live in
 * memory, so they stay while you switch pages and come back, and go away with Reset or a restart.
 * Which orgs and repos to watch on this computer is a setting (Settings.prsHidden), not one of these.
 */
export interface PrFilters {
  repos: string[]
  authors: string[]
  review: string[]
  status: string[]
  /** One of UPDATED ids, or null for any time. */
  updated: string | null
}

export const NO_FILTERS: PrFilters = { repos: [], authors: [], review: [], status: [], updated: null }

export interface Option {
  id: string
  label: string
  test: (p: InboxPr, now: number) => boolean
}

export const REVIEW: Option[] = [
  { id: 'unapproved', label: 'Not approved yet', test: (p) => p.reviewDecision !== 'APPROVED' },
  { id: 'approved', label: 'Approved', test: (p) => p.reviewDecision === 'APPROVED' },
  { id: 'changes', label: 'Changes requested', test: (p) => p.reviewDecision === 'CHANGES_REQUESTED' },
  { id: 'reviewed', label: 'You reviewed', test: (p) => !!p.update?.myReview || p.roles.includes('reviewed') },
  { id: 'not-reviewed', label: "You haven't reviewed", test: (p) => !p.update?.myReview && !p.roles.includes('reviewed') }
]

export const STATUS: Option[] = [
  { id: 'ready', label: 'Ready for review', test: (p) => !p.isDraft },
  { id: 'draft', label: 'Draft', test: (p) => p.isDraft },
  { id: 'failing', label: 'Checks failing', test: (p) => p.checks === 'FAILURE' || p.checks === 'ERROR' },
  { id: 'running', label: 'Checks running', test: (p) => p.checks === 'PENDING' || p.checks === 'EXPECTED' },
  { id: 'passing', label: 'Checks passing', test: (p) => p.checks === 'SUCCESS' }
]

const H = 3600_000
const age = (p: InboxPr, now: number) => now - Date.parse(p.updatedAt)
export const UPDATED: Option[] = [
  { id: '24h', label: 'Last 24 hours', test: (p, now) => age(p, now) <= 24 * H },
  { id: '3d', label: 'Last 3 days', test: (p, now) => age(p, now) <= 72 * H },
  { id: '7d', label: 'Last week', test: (p, now) => age(p, now) <= 168 * H },
  { id: '30d', label: 'Last 30 days', test: (p, now) => age(p, now) <= 720 * H },
  { id: 'stale', label: 'Over a week ago', test: (p, now) => age(p, now) > 168 * H }
]

export function activeCount(f: PrFilters): number {
  return f.repos.length + f.authors.length + f.review.length + f.status.length + (f.updated ? 1 : 0)
}

/** Choices within one dropdown widen the list (alice or bob); different dropdowns narrow it. */
export function applyPrFilters(prs: InboxPr[], f: PrFilters, now = Date.now()): InboxPr[] {
  if (!activeCount(f)) return prs
  const any = (ids: string[], opts: Option[], p: InboxPr) => !ids.length || opts.some((o) => ids.includes(o.id) && o.test(p, now))
  const updated = f.updated ? UPDATED.find((o) => o.id === f.updated) : undefined
  return prs.filter(
    (p) =>
      (!f.repos.length || f.repos.includes(p.repo)) &&
      (!f.authors.length || f.authors.includes(p.author)) &&
      any(f.review, REVIEW, p) &&
      any(f.status, STATUS, p) &&
      (!updated || updated.test(p, now))
  )
}

/** Values to offer in the Repo and Author dropdowns, with counts, most PRs first. */
export function valuesWithCounts(prs: InboxPr[], pick: (p: InboxPr) => string): { value: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const p of prs) counts.set(pick(p), (counts.get(pick(p)) ?? 0) + 1)
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

/** Adds or removes one value of a multi-choice filter. */
export function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

/** Short text for a dropdown button: "Author", "Author: alice", "Author: 2". */
export function buttonLabel(name: string, values: string[], opts?: Option[]): string {
  if (!values.length) return name
  if (values.length > 1) return `${name}: ${values.length}`
  const v = values[0]
  const label = opts?.find((o) => o.id === v)?.label ?? v
  return `${name}: ${label}`
}
