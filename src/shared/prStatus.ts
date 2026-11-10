import type { CheckRun, PrInfo } from './types'

export type ChecksSummary = { total: number; passed: number; failed: CheckRun[]; pending: number }

export function summarizeChecks(checks: CheckRun[]): ChecksSummary {
  const counted = checks.filter((c) => c.bucket !== 'skipping')
  return {
    total: counted.length,
    passed: counted.filter((c) => c.bucket === 'pass').length,
    failed: counted.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel'),
    pending: counted.filter((c) => c.bucket === 'pending').length
  }
}

/** What the PR button should offer next, in priority order: conflicts, failing checks, waiting, merge. */
export type PrAction = 'resolve' | 'fix' | 'waiting' | 'review' | 'merge' | 'open'

export function nextPrAction(pr: PrInfo, c: ChecksSummary): PrAction {
  if (pr.state !== 'OPEN') return 'open'
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return 'resolve'
  if (c.failed.length) return 'fix'
  if (c.pending) return 'waiting'
  if (pr.isDraft) return 'open'
  if (pr.reviewDecision === 'CHANGES_REQUESTED' || pr.reviewDecision === 'REVIEW_REQUIRED') return 'review'
  if (pr.mergeStateStatus && !['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(pr.mergeStateStatus)) return 'open'
  return 'merge'
}

/** The GitHub API path that compares a PR's branch with its base, for `gh api`. Null when the PR lacks the names. */
export function comparePath(pr: PrInfo): string | null {
  if (!pr.baseRefName || !pr.headRefName) return null
  const ref = (r: string) => r.split('/').map(encodeURIComponent).join('/')
  const owner = pr.isCrossRepository && pr.headRepositoryOwner?.login ? `${encodeURIComponent(pr.headRepositoryOwner.login)}:` : ''
  return `repos/{owner}/{repo}/compare/${ref(pr.baseRefName)}...${owner}${ref(pr.headRefName)}`
}

/** Whether to offer "Update branch": the PR is open, behind its base, and merging the base in wouldn't conflict. */
export function canUpdateBranch(pr: PrInfo): boolean {
  if (pr.state !== 'OPEN' || pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return false
  return (pr.behindBy ?? 0) > 0 || pr.mergeStateStatus === 'BEHIND'
}

export function fixChecksPrompt(pr: PrInfo, failed: CheckRun[]): string {
  return [
    `These checks are failing on PR #${pr.number}:`,
    ...failed.map((c) => `- ${c.workflow ? `${c.workflow} / ` : ''}${c.name}${c.link ? ` (${c.link})` : ''}`),
    '',
    'Find out why (for GitHub Actions, `gh run view <run id> --log-failed`), fix the cause, run the same checks locally where you can, then commit and push.'
  ].join('\n')
}

export function resolveConflictsPrompt(pr: PrInfo, base: string): string {
  return `PR #${pr.number} has merge conflicts with ${base}. Fetch origin, merge origin/${base} into this branch, resolve every conflict keeping both sides' intent, make sure it builds and tests pass, then commit and push.`
}
