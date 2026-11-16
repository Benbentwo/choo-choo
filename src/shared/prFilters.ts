import type { InboxPr } from './prInbox'

/**
 * Temporary filters on the PRs page ("only PRs by alice for now"). They live in memory: they stay
 * while you switch pages and come back, and go away with Reset or a restart. The saved org and repo
 * hiding is Settings.prsHidden (shared/prInbox.ts visiblePrs).
 */
export type QuickFilterKind = 'author' | 'repo' | 'status' | 'text'
export interface QuickFilter {
  kind: QuickFilterKind
  value: string
}

export const STATUSES: { id: string; label: string; test: (p: InboxPr) => boolean }[] = [
  { id: 'draft', label: 'Draft', test: (p) => p.isDraft },
  { id: 'ready', label: 'Ready for review', test: (p) => !p.isDraft },
  { id: 'approved', label: 'Approved', test: (p) => p.reviewDecision === 'APPROVED' },
  { id: 'changes', label: 'Changes requested', test: (p) => p.reviewDecision === 'CHANGES_REQUESTED' },
  { id: 'failing', label: 'Checks failing', test: (p) => p.checks === 'FAILURE' || p.checks === 'ERROR' },
  { id: 'passing', label: 'Checks passing', test: (p) => p.checks === 'SUCCESS' }
]

const STATUS_WORDS: Record<string, string> = {
  draft: 'draft',
  drafts: 'draft',
  ready: 'ready',
  approved: 'approved',
  changes: 'changes',
  'changes requested': 'changes',
  failing: 'failing',
  failed: 'failing',
  red: 'failing',
  'checks failing': 'failing',
  passing: 'passing',
  green: 'passing',
  'checks passing': 'passing'
}

export function quickFilterLabel(f: QuickFilter): string {
  if (f.kind === 'author') return `by ${f.value}`
  if (f.kind === 'repo') return `in ${f.value}`
  if (f.kind === 'status') return STATUSES.find((s) => s.id === f.value)?.label ?? f.value
  return `“${f.value}”`
}

/**
 * Reads what the person typed into one filter. Understands `author:alice`, `@alice`, `by alice`,
 * "only PRs by alice", `repo:web`, `in owner/repo`, and status words (draft, approved, failing…).
 * Repo and author names are matched against the loaded PRs when given, so "alice" alone finds an
 * author and "web" alone finds a repo. Anything else searches titles.
 */
export function parseQuickFilter(input: string, prs: InboxPr[] = []): QuickFilter | null {
  let t = input.trim().replace(/\s+/g, ' ')
  if (!t) return null
  // Drop leading filler: "for now, filter only by alice" -> "by alice", "show me only drafts" -> "drafts".
  for (let prev = ''; prev !== t; ) {
    prev = t
    t = t.replace(/^(?:for now,?|filter(?: to)?|only|just|show(?: me)?|the|prs?|pull requests?)\s+/i, '')
  }
  const lower = t.toLowerCase()
  if (STATUS_WORDS[lower]) return { kind: 'status', value: STATUS_WORDS[lower] }
  const tagged = /^(author|by|user|from|repo|in|is|status):\s*(.+)$/i.exec(t)
  if (tagged) {
    const [, tag, v] = tagged
    const k = tag.toLowerCase()
    if (k === 'repo' || k === 'in') return { kind: 'repo', value: matchRepo(v, prs) ?? v }
    if (k === 'is' || k === 'status') return STATUS_WORDS[v.toLowerCase()] ? { kind: 'status', value: STATUS_WORDS[v.toLowerCase()] } : null
    return { kind: 'author', value: matchAuthor(v.replace(/^@/, ''), prs) ?? v.replace(/^@/, '') }
  }
  const by = /^(?:by|from|authored by|opened by)\s+@?(\S+)$/i.exec(t) ?? /^@(\S+)$/.exec(t) ?? /^(\S+)'s(?:\s+(?:prs?|pull requests?))?$/i.exec(t)
  if (by) return { kind: 'author', value: matchAuthor(by[1], prs) ?? by[1] }
  const inRepo = /^in\s+(\S+)$/i.exec(t)
  if (inRepo) return { kind: 'repo', value: matchRepo(inRepo[1], prs) ?? inRepo[1] }
  if (!t.includes(' ')) {
    const a = matchAuthor(t, prs)
    if (a) return { kind: 'author', value: a }
    const r = matchRepo(t, prs)
    if (r) return { kind: 'repo', value: r }
  }
  return { kind: 'text', value: t }
}

function matchAuthor(name: string, prs: InboxPr[]): string | undefined {
  const n = name.toLowerCase()
  return prs.find((p) => p.author.toLowerCase() === n)?.author
}

/** A full owner/repo, or the repo part alone when it names exactly one loaded repo. */
function matchRepo(name: string, prs: InboxPr[]): string | undefined {
  const n = name.toLowerCase()
  const repos = [...new Set(prs.map((p) => p.repo))]
  return repos.find((r) => r.toLowerCase() === n) ?? (repos.filter((r) => r.split('/')[1]?.toLowerCase() === n).length === 1 ? repos.find((r) => r.split('/')[1]?.toLowerCase() === n) : undefined)
}

function matches(p: InboxPr, f: QuickFilter): boolean {
  const v = f.value.toLowerCase()
  if (f.kind === 'author') return p.author.toLowerCase() === v
  if (f.kind === 'repo') return p.repo.toLowerCase() === v || p.repo.split('/')[1]?.toLowerCase() === v
  if (f.kind === 'status') return STATUSES.find((s) => s.id === f.value)?.test(p) ?? true
  return `${p.title} #${p.number} ${p.author} ${p.repo} ${p.headRefName}`.toLowerCase().includes(v)
}

/** Filters of the same kind widen the list (by alice or by bob); different kinds narrow it. */
export function applyQuickFilters(prs: InboxPr[], filters: QuickFilter[]): InboxPr[] {
  if (!filters.length) return prs
  const byKind = new Map<QuickFilterKind, QuickFilter[]>()
  for (const f of filters) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f])
  return prs.filter((p) => [...byKind.entries()].every(([kind, fs]) => (kind === 'text' ? fs.every((f) => matches(p, f)) : fs.some((f) => matches(p, f)))))
}

/** Adds a filter unless the same one is already on. */
export function addQuickFilter(filters: QuickFilter[], f: QuickFilter): QuickFilter[] {
  return filters.some((x) => x.kind === f.kind && x.value.toLowerCase() === f.value.toLowerCase()) ? filters : [...filters, f]
}

/** Suggestions for what's typed so far: matching authors, repos and statuses from the loaded PRs. */
export function suggestQuickFilters(input: string, prs: InboxPr[], limit = 8): QuickFilter[] {
  const q = input.trim().toLowerCase().replace(/^(author|by|repo|in|is|status):\s*/, '').replace(/^@/, '')
  const authors = [...new Set(prs.map((p) => p.author))].sort((a, b) => a.localeCompare(b))
  const repos = [...new Set(prs.map((p) => p.repo))].sort((a, b) => a.localeCompare(b))
  const out: QuickFilter[] = [
    ...authors.filter((a) => a.toLowerCase().includes(q)).map((value) => ({ kind: 'author' as const, value })),
    ...repos.filter((r) => r.toLowerCase().includes(q)).map((value) => ({ kind: 'repo' as const, value })),
    ...STATUSES.filter((s) => s.label.toLowerCase().includes(q) || s.id.includes(q)).map((s) => ({ kind: 'status' as const, value: s.id }))
  ]
  return out.slice(0, limit)
}
