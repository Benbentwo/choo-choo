import { existsSync } from 'node:fs'
import type { Workspace } from '@shared/types'
import * as git from './git'

/**
 * Catches the workspace up with the branch really checked out in its worktree. Agents often switch
 * branches themselves (`gh pr checkout 12`, `git switch feature`), for example when the orchestrator
 * hands them an existing PR, and the PR button looks the PR up by the workspace's branch.
 * Returns true when the branch changed. Stacks and orchestrators manage their own branch.
 */
export async function syncWorkspaceBranch(ws: Workspace): Promise<boolean> {
  if (ws.orchestrator || ws.stack || ws.archived || !existsSync(ws.path)) return false
  const branch = await git.currentBranch(ws.path)
  if (!branch || branch === ws.branch) return false
  ws.branch = branch
  const pr = await git.pullNumberOf(ws.path, branch)
  if (pr) ws.prNumber = pr
  else delete ws.prNumber
  return true
}

/** What to hand `gh pr view` / `gh pr checks`: the PR number when known, else the branch name. */
export function prRef(ws: Workspace): string {
  return !ws.stack && ws.prNumber ? String(ws.prNumber) : ws.branch
}
