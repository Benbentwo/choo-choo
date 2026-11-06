import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CheckRun, GithubRepo, PrInfo } from '@shared/types'

const exec = promisify(execFile)

export async function prForBranch(cwd: string, branch: string): Promise<PrInfo | null> {
  try {
    const { stdout } = await exec('gh', ['pr', 'view', branch, '--json', 'number,url,state,isDraft,title,mergeable'], { cwd })
    return JSON.parse(stdout) as PrInfo
  } catch {
    return null
  }
}

export async function mergePr(cwd: string, number: number) {
  await exec('gh', ['pr', 'merge', String(number), '--squash', '--delete-branch=false'], { cwd })
}


export async function checks(cwd: string, branch: string): Promise<CheckRun[]> {
  try {
    const { stdout } = await exec('gh', ['pr', 'checks', branch, '--json', 'name,state,bucket,link,workflow,description'], { cwd })
    return JSON.parse(stdout) as CheckRun[]
  } catch (e) {
    // gh exits non-zero when checks fail or are pending but still prints JSON.
    const out = (e as { stdout?: string }).stdout
    if (out?.trim().startsWith('[')) return JSON.parse(out) as CheckRun[]
    return []
  }
}

/** Re-runs the failed jobs of the workflow run behind a check link. */
export async function rerunFailed(cwd: string, link: string) {
  const id = link.match(/actions\/runs\/(\d+)/)?.[1]
  if (!id) throw new Error('This check is not a GitHub Actions run')
  await exec('gh', ['run', 'rerun', id, '--failed'], { cwd })
}

/** Every repo the signed-in gh user can reach (own, collaborator, org member), most recently pushed first. */
export async function listMyRepos(): Promise<GithubRepo[]> {
  const { stdout } = await exec(
    'gh',
    ['api', '--paginate', 'user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100', '--jq', '.[] | {nameWithOwner: .full_name, description, private, pushedAt: .pushed_at}'],
    { maxBuffer: 64 * 1024 * 1024 }
  )
  const repos = stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l) as GithubRepo)
  return repos.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''))
}

export async function cloneRepo(nameWithOwner: string, dest: string) {
  await exec('gh', ['repo', 'clone', nameWithOwner, dest], { maxBuffer: 64 * 1024 * 1024 })
}

/** public, private or internal; undefined when gh can't tell (not GitHub, or not signed in). */
export async function repoVisibility(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('gh', ['repo', 'view', '--json', 'visibility', '--jq', '.visibility'], { cwd, timeout: 10_000 })
    return stdout.trim().toLowerCase() || undefined
  } catch {
    return undefined
  }
}
