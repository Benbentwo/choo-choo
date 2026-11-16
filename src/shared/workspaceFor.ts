import type { Workspace } from './types'

/**
 * The open workspace that already holds a PR or an issue, so "Open in Choo Choo" (link cards, the
 * PRs page) goes there instead of starting a second one. A workspace holds a PR when it was opened
 * from it or adopted it (`prNumber`), when its branch is the PR's branch, or when the PR is a layer
 * of its stack. It holds an issue when it was started from that issue.
 */
export function workspaceForPr(
  workspaces: Workspace[],
  repoId: string,
  pr: { number: number; branch?: string }
): Workspace | undefined {
  const live = workspaces.filter((w) => w.repoId === repoId && !w.archived && !w.orchestrator)
  return (
    live.find((w) => !w.stack && w.prNumber === pr.number) ??
    live.find((w) => w.stack?.layers.some((l) => l.pr?.number === pr.number || (!!pr.branch && l.branch === pr.branch))) ??
    (pr.branch ? live.find((w) => w.branch === pr.branch) : undefined)
  )
}

export function workspaceForIssue(workspaces: Workspace[], repoId: string, issue: number): Workspace | undefined {
  return workspaces.find((w) => w.repoId === repoId && !w.archived && !w.orchestrator && w.issueNumber === issue)
}
