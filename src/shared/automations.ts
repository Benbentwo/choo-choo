import type { InboxPr } from './prInbox'

/**
 * Automations: a check that runs on a schedule, on a GitHub event, or when the person presses
 * Run now. Each run is an orchestrator turn that looks at connected tools and opens a workspace
 * per finding. See docs/prd/automations.md.
 */

/** GitHub events the app can notice by polling, without a server. */
export type GithubEvent = 'review_requested' | 'review_update' | 'checks_failed' | 'reviewed' | 'issue_opened' | 'pr_opened'

export type AutomationTrigger =
  /** Every `hours` hours. */
  | { kind: 'hourly'; hours: number }
  /** Every day, or Monday to Friday, at `at` (HH:MM, local time). */
  | { kind: 'daily'; at: string; weekdaysOnly?: boolean }
  /** Once a week on `day` (0 Sunday to 6 Saturday) at `at`. */
  | { kind: 'weekly'; day: number; at: string }
  /** `label` only applies to issue_opened and pr_opened: only items with that label count. */
  | { kind: 'github'; event: GithubEvent; label?: string }
  /** Only when the person presses Run now. */
  | { kind: 'manual' }
  /** Each time the plan's usage window resets after running out (Continue work). */
  | { kind: 'usage_reset' }

/** Where a run's conversation and workspaces go. */
export type AutomationTarget = { kind: 'project'; groupId: string } | { kind: 'repo'; repoId: string }

export interface Automation {
  id: string
  name: string
  /** What to check and what counts as a finding. */
  prompt: string
  trigger: AutomationTrigger
  target: AutomationTarget
  /** At most this many workspaces per run. */
  maxFindings: number
  enabled: boolean
  createdAt: number
  /** When it last started a run. */
  lastRunAt?: number
  /** Next scheduled run, for schedule triggers. */
  nextRunAt?: number
}

export interface AutomationRun {
  id: string
  automationId: string
  /** The chat the run's turn went into. */
  chatId: string
  startedAt: number
  /** Why it ran, in a few words: "Scheduled", "Run now", "PR #12 asks for your review". */
  reason: string
  /** Workspaces it opened, one per finding. */
  findings: { id: string; title: string; workspaceId: string }[]
  /** Findings it was told to skip: already handled, or over the cap. */
  skipped: number
  status: 'running' | 'done' | 'skipped' | 'error'
  /** Why it was skipped or failed. */
  note?: string
}

export const DEFAULT_MAX_FINDINGS = 5
/** Finding ids remembered per automation, so the same thing never gets a second workspace. */
export const LEDGER_LIMIT = 1000
/** Runs kept for the history list, across all automations. */
export const RUNS_LIMIT = 300

export const GITHUB_EVENTS: { id: GithubEvent; label: string; hint: string }[] = [
  { id: 'review_requested', label: 'A PR asks for my review', hint: 'Someone requests your review on an open PR.' },
  {
    id: 'review_update',
    label: "A PR I'm reviewing changed for me",
    hint: 'After you reviewed: the PR\'s own code changed, someone answered your comment, or you were asked again. Merges from main don\'t count. Follows Settings › Reviews.'
  },
  { id: 'checks_failed', label: 'CI fails on my PR', hint: 'Checks go red on a PR you opened.' },
  { id: 'reviewed', label: 'My PR gets a review', hint: 'Someone approves or requests changes on a PR you opened.' },
  { id: 'issue_opened', label: 'A new issue is opened', hint: 'Anyone opens an issue in the repo, optionally only ones with a label.' },
  { id: 'pr_opened', label: 'A new PR is opened', hint: 'Anyone opens a pull request in the repo, optionally only ones with a label.' }
]

/** Events that come from review updates (src/main/reviewWatch.ts) rather than from comparing two inbox polls. */
export const isReviewEvent = (e: GithubEvent) => e === 'review_update'

/** Events read from a repo's issue list rather than from the person's PR inbox. */
export const isRepoEvent = (e: GithubEvent) => e === 'issue_opened' || e === 'pr_opened'

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const isSchedule = (t: AutomationTrigger) => t.kind === 'hourly' || t.kind === 'daily' || t.kind === 'weekly'

function hhmm(at: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim())
  if (!m) return [9, 0]
  return [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))]
}

/** The first scheduled time after `from`, in local time. Undefined for event and manual triggers. */
export function nextRun(t: AutomationTrigger, from: number): number | undefined {
  if (t.kind === 'hourly') return from + Math.max(1, Math.min(24, Math.round(t.hours) || 1)) * 3_600_000
  if (t.kind !== 'daily' && t.kind !== 'weekly') return undefined
  const [h, m] = hhmm(t.at)
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setHours(h, m)
  for (let i = 0; i < 8; i++) {
    const day = d.getDay()
    const ok = t.kind === 'weekly' ? day === t.day : !t.weekdaysOnly || (day !== 0 && day !== 6)
    if (ok && d.getTime() > from) return d.getTime()
    d.setDate(d.getDate() + 1)
    d.setHours(h, m)
  }
  return undefined
}

/** A short label for the When column. */
export function describeTrigger(t: AutomationTrigger): string {
  switch (t.kind) {
    case 'hourly':
      return t.hours === 1 ? 'Every hour' : `Every ${t.hours} hours`
    case 'daily':
      return `${t.weekdaysOnly ? 'Weekdays' : 'Every day'} ${t.at}`
    case 'weekly':
      return `${DAYS[t.day] ?? 'Monday'}s ${t.at}`
    case 'github': {
      const base = GITHUB_EVENTS.find((e) => e.id === t.event)?.label ?? 'GitHub event'
      return t.label && isRepoEvent(t.event) ? `${base} (${t.label})` : base
    }
    case 'manual':
      return 'Only when run by hand'
    case 'usage_reset':
      return 'When my usage window resets'
  }
}

/** One GitHub event the poller noticed, for one PR. */
export interface PrEvent {
  event: GithubEvent
  /** owner/repo */
  repo: string
  number: number
  title: string
  url: string
  /** What happened, for the run's prompt. */
  detail: string
  /** Stable id: the same event never fires twice. */
  key: string
  /** Labels on the issue or PR, for new-issue and new-PR events. */
  labels?: string[]
}

/** What the poller remembers between polls, kept in state.json so a restart doesn't refire. */
export interface GithubWatchState {
  /** PRs asking for review, by owner/repo#n. */
  review: string[]
  /** PR -> head checks state, for PRs the person opened. */
  checks: Record<string, string | null>
  /** PR -> review decision, for PRs the person opened. */
  decision: Record<string, string | null>
  /** Highest issue or PR number seen per repo id, for new-issue and new-PR events. */
  latest?: Record<string, number>
}

/** An issue or PR from a repo's issue list, newest first. */
export interface RepoItem {
  number: number
  title: string
  url: string
  author: string
  labels: string[]
  isPr: boolean
}

/**
 * Items opened since the last look at a repo. With no last look, it only records the newest
 * number, so a new automation doesn't fire for everything already open.
 */
export function diffRepoItems(repo: string, prevLatest: number | undefined, items: RepoItem[]): { events: PrEvent[]; latest: number | undefined } {
  const top = items.reduce((m, i) => Math.max(m, i.number), prevLatest ?? 0)
  if (prevLatest === undefined) return { events: [], latest: items.length ? top : undefined }
  const events = items
    .filter((i) => i.number > prevLatest)
    .sort((a, b) => a.number - b.number)
    .map((i) => ({
      event: (i.isPr ? 'pr_opened' : 'issue_opened') as GithubEvent,
      repo,
      number: i.number,
      title: i.title,
      url: i.url,
      detail: `${i.isPr ? 'PR' : 'issue'} opened by ${i.author}${i.labels.length ? ` [${i.labels.join(', ')}]` : ''}`,
      key: `${i.isPr ? 'pr' : 'issue'}:${repo}#${i.number}`,
      labels: i.labels
    }))
  return { events, latest: top }
}

/** Review updates as automation events, keyed so the same update never starts a second workspace. */
export function reviewUpdateEvents(updates: { pr: InboxPr; reasons: { label: string; key: string }[] }[]): PrEvent[] {
  return updates.map(({ pr, reasons }) => ({
    event: 'review_update',
    repo: pr.repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    detail: `changed for you since your review: ${reasons.map((r) => r.label).join(', ')}`,
    key: `review_update:${pr.repo}#${pr.number}:${reasons.map((r) => r.key).sort().join('|')}`
  }))
}

/** Whether an event matches an automation's label filter (case-insensitive). */
export const labelMatches = (e: PrEvent, label?: string) => !label?.trim() || !!e.labels?.some((l) => l.toLowerCase() === label.trim().toLowerCase())

const prKey = (p: InboxPr) => `${p.repo}#${p.number}`

/**
 * Events between two looks at the PR inbox. With no earlier look, it only records where
 * things stand, so turning on an automation doesn't fire for every PR already open.
 */
export function diffInbox(prev: GithubWatchState | undefined, prs: InboxPr[]): { events: PrEvent[]; next: GithubWatchState } {
  const next: GithubWatchState = { review: [], checks: {}, decision: {}, ...(prev?.latest ? { latest: prev.latest } : {}) }
  const events: PrEvent[] = []
  for (const p of prs) {
    const k = prKey(p)
    const base = { repo: p.repo, number: p.number, title: p.title, url: p.url }
    if (p.roles.includes('review')) {
      next.review.push(k)
      if (prev && !prev.review.includes(k)) events.push({ ...base, event: 'review_requested', detail: `${p.author} asks for your review`, key: `review:${k}:${p.updatedAt}` })
    }
    if (p.roles.includes('mine')) {
      next.checks[k] = p.checks
      next.decision[k] = p.reviewDecision
      const failed = p.checks === 'FAILURE' || p.checks === 'ERROR'
      if (prev && failed && prev.checks[k] !== p.checks) events.push({ ...base, event: 'checks_failed', detail: 'CI checks failed', key: `checks:${k}:${p.updatedAt}` })
      const d = p.reviewDecision
      if (prev && k in prev.decision && (d === 'APPROVED' || d === 'CHANGES_REQUESTED') && prev.decision[k] !== d)
        events.push({ ...base, event: 'reviewed', detail: d === 'APPROVED' ? 'was approved' : 'got a review asking for changes', key: `reviewed:${k}:${d}:${p.updatedAt}` })
    }
  }
  return { events, next }
}

/** The finding id the run should use for a PR event, so a later run sees it was handled. */
export const prFindingId = (e: PrEvent) => e.key

/** The message that starts a run. */
export function runPrompt(a: Automation, reason: string, events: PrEvent[] = []): string {
  return [
    `[Automation "${a.name}" from Choo Choo, not from the person. Reason: ${reason}]`,
    '',
    a.prompt.trim(),
    ...(events.length
      ? ['', 'What triggered this run:', ...events.map((e) => `- ${e.repo}#${e.number} "${e.title}" ${e.detail}. ${e.url} (finding_id: ${prFindingId(e)})`)]
      : []),
    '',
    `Open one workspace per finding with start_workspace, passing a stable finding_id (an issue key, URL or PR number) and a short finding_title. At most ${a.maxFindings} this run; the app skips findings an earlier run already handled. If nothing needs doing, say so in one line and stop. Nobody is watching this run live, so do not ask questions: decide, and say what you decided.`
  ].join('\n')
}

/** Whether a user message is a run's opening message, and its text without the marker line. */
export function stripRunMarker(text: string): { reason?: string; text: string } {
  const m = /^\[Automation "(.*?)" from Choo Choo, not from the person\. Reason: (.*?)\]\s*\n?/.exec(text)
  return m ? { reason: m[2], text: text.slice(m[0].length) } : { text }
}
