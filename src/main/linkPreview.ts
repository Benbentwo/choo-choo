import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  commitPreview,
  fileExcerpt,
  issuePreview,
  parseGithubLink,
  prPreview,
  refPathSplits,
  type GithubLink,
  type LinkPreview,
} from '@shared/githubLink'

const exec = promisify(execFile)

/** Answers stay fresh this long; a hover after that fetches again. */
const TTL = 3 * 60_000
/** Failures (no access, gh signed out) are retried sooner. */
const ERROR_TTL = 30_000
const MAX_ENTRIES = 300
/** A chat full of links asks for every pill's dot at once; each ask is a gh process. */
const MAX_RUNNING = 4

type Entry = { at: number; preview?: LinkPreview; error?: string }
const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<LinkPreview>>()

let running = 0
const waiting: (() => void)[] = []
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_RUNNING) await new Promise<void>((r) => waiting.push(r))
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

async function api<T = unknown>(path: string, raw = false): Promise<T> {
  const args = ['api', ...(raw ? ['-H', 'Accept: application/vnd.github.raw'] : []), path]
  const { stdout } = await exec('gh', args, { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 })
  return (raw ? stdout : JSON.parse(stdout)) as T
}

function friendly(e: unknown): string {
  const err = e as { code?: string; stderr?: string; message?: string }
  if (err.code === 'ENOENT') return 'Install the GitHub CLI (gh) to see previews.'
  const s = err.stderr ?? ''
  if (/auth login|not logged|authentication/i.test(s)) return 'Sign in to GitHub with `gh auth login` to see previews.'
  if (/HTTP 404/.test(s)) return 'Not found, or you don\'t have access.'
  if (/rate limit/i.test(s)) return 'GitHub rate limit reached. Try again soon.'
  return (s.split('\n').find((l) => l.trim()) || err.message || 'Could not load a preview').trim().slice(0, 160)
}

async function fetchPreview(l: GithubLink): Promise<LinkPreview> {
  const repo = `${l.owner}/${l.repo}`
  const r = `repos/${encodeURIComponent(l.owner)}/${encodeURIComponent(l.repo)}`
  switch (l.kind) {
    case 'pr': {
      const pull = await api<{ head?: { sha?: string } }>(`${r}/pulls/${l.number}`)
      // Reviews and checks fill in details; the card still shows without them.
      const [reviews, runs] = await Promise.all([
        api<unknown[]>(`${r}/pulls/${l.number}/reviews?per_page=100`).catch(() => null),
        pull.head?.sha ? api<{ check_runs?: unknown[] }>(`${r}/commits/${pull.head.sha}/check-runs?per_page=100`).then((x) => x.check_runs ?? [], () => null) : null,
      ])
      return prPreview(pull, reviews, runs)
    }
    case 'issue': {
      const issue = await api<{ pull_request?: unknown }>(`${r}/issues/${l.number}`)
      // GitHub redirects /issues/N to the PR when N is one; do the same.
      if (issue.pull_request) return fetchPreview({ ...l, kind: 'pr' })
      return issuePreview(issue, repo)
    }
    case 'commit':
      return commitPreview(await api(`${r}/commits/${l.sha}`), repo)
    case 'file': {
      let last: unknown
      for (const { ref, path } of refPathSplits(l.rest)) {
        if (!path) continue
        try {
          const text = await api<string>(`${r}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, true)
          const ex = fileExcerpt(text, l.start, l.end)
          return { kind: 'file', repo, ref, path, start: ex.start, lines: ex.lines, truncated: ex.truncated, url: l.url }
        } catch (e) {
          last = e
          // A 404 may mean the ref has a slash in it; try the next split.
          if (!/HTTP 404/.test((e as { stderr?: string }).stderr ?? '')) throw e
        }
      }
      throw last ?? new Error('Not found')
    }
    case 'repo': {
      const x = await api<{ full_name: string; description: string | null; stargazers_count: number; language: string | null; open_issues_count: number; pushed_at: string; private: boolean; html_url: string }>(r)
      return { kind: 'repo', repo: x.full_name, description: x.description ?? '', stars: x.stargazers_count, language: x.language, openIssues: x.open_issues_count, updatedAt: x.pushed_at, isPrivate: x.private, url: x.html_url }
    }
  }
}

/** Cache key: the thing a link points at, so `/pull/3`, `/pull/3/files` and `#discussion…` share one entry. */
function keyOf(l: GithubLink): string {
  const base = `${l.owner}/${l.repo}`.toLowerCase()
  switch (l.kind) {
    case 'pr':
    case 'issue':
      return `${base}#${l.number}`
    case 'commit':
      return `${base}@${l.sha}`
    case 'file':
      return `${base}/blob/${l.rest}#${l.start ?? ''}-${l.end ?? ''}`
    case 'repo':
      return base
  }
}

/**
 * The preview card for a GitHub URL, through gh's REST API (GraphQL isn't needed). Answers are
 * cached per link for a few minutes, and asks for the same link while one is running share it.
 * `fresh` skips the cache (the card's refresh).
 */
export async function linkPreview(url: string, fresh = false): Promise<LinkPreview> {
  const link = parseGithubLink(url)
  if (!link) throw new Error('Not a GitHub link')
  const key = keyOf(link)
  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < (hit.error ? ERROR_TTL : TTL)) {
    if (hit.preview) return hit.preview
    throw new Error(hit.error)
  }
  const running = inflight.get(key)
  if (running) return running
  const p = limited(() => fetchPreview(link))
    .then((preview) => {
      remember(key, { at: Date.now(), preview })
      return preview
    })
    .catch((e) => {
      const error = friendly(e)
      remember(key, { at: Date.now(), error })
      throw new Error(error)
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

function remember(key: string, e: Entry) {
  cache.delete(key)
  cache.set(key, e)
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
}

/** For tests. */
export function clearLinkPreviewCache() {
  cache.clear()
  inflight.clear()
}
