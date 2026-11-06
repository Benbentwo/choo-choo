import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CheckRun, GithubRepo, PrInfo, SourceOption } from '@shared/types'

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

type Listed = { number: number; title: string; author?: { login: string }; headRefName?: string }

export async function listPrs(cwd: string, query: string): Promise<SourceOption[]> {
  const args = ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,author,headRefName']
  if (query) args.push('--search', query)
  const { stdout } = await exec('gh', args, { cwd })
  return (JSON.parse(stdout) as Listed[]).map((p) => ({ source: { kind: 'pr', number: p.number }, title: `#${p.number} ${p.title}`, detail: `${p.author?.login ?? ''} · ${p.headRefName}` }))
}

export async function listIssues(cwd: string, query: string): Promise<SourceOption[]> {
  const args = ['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,author']
  if (query) args.push('--search', query)
  const { stdout } = await exec('gh', args, { cwd })
  return (JSON.parse(stdout) as Listed[]).map((i) => ({ source: { kind: 'issue', number: i.number }, title: `#${i.number} ${i.title}`, detail: i.author?.login ?? '' }))
}

export async function prHead(cwd: string, number: number) {
  const { stdout } = await exec('gh', ['pr', 'view', String(number), '--json', 'headRefName,isCrossRepository,title'], { cwd })
  return JSON.parse(stdout) as { headRefName: string; isCrossRepository: boolean; title: string }
}

export async function issueText(cwd: string, number: number) {
  const { stdout } = await exec('gh', ['issue', 'view', String(number), '--json', 'title,body,url'], { cwd })
  return JSON.parse(stdout) as { title: string; body: string; url: string }
}
