import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  checksSummary,
  fileExcerpt,
  githubLinkLabel,
  isBareLink,
  issuePreview,
  parseGithubLink,
  prPreview,
  refPathSplits,
  reviewState,
  shortAge,
} from '../src/shared/githubLink'

describe('parseGithubLink', () => {
  it('reads PRs, issues, commits, files and repos', () => {
    expect(parseGithubLink('https://github.com/acme/widgets/pull/42')).toMatchObject({ kind: 'pr', owner: 'acme', repo: 'widgets', number: 42 })
    expect(parseGithubLink('https://github.com/acme/widgets/pull/42/files#diff-abc')).toMatchObject({ kind: 'pr', number: 42 })
    expect(parseGithubLink('https://github.com/acme/widgets/issues/7#issuecomment-1')).toMatchObject({ kind: 'issue', number: 7 })
    expect(parseGithubLink('https://github.com/acme/widgets/commit/ABCDEF1234')).toMatchObject({ kind: 'commit', sha: 'abcdef1234' })
    expect(parseGithubLink('https://github.com/acme/widgets/blob/main/src/a.ts#L10-L20')).toMatchObject({ kind: 'file', rest: 'main/src/a.ts', start: 10, end: 20 })
    expect(parseGithubLink('https://github.com/acme/widgets/blob/feat/x/src/a.ts#L3')).toMatchObject({ kind: 'file', rest: 'feat/x/src/a.ts', start: 3 })
    expect(parseGithubLink('https://github.com/acme/widgets')).toMatchObject({ kind: 'repo' })
    expect(parseGithubLink('https://github.com/acme/widgets.git')).toMatchObject({ kind: 'repo', repo: 'widgets' })
  })

  it('ignores other sites and GitHub pages that are not repos', () => {
    expect(parseGithubLink('https://gitlab.com/acme/widgets/pull/1')).toBeNull()
    expect(parseGithubLink('https://github.com/settings/profile')).toBeNull()
    expect(parseGithubLink('https://github.com/orgs/acme/people')).toBeNull()
    expect(parseGithubLink('https://github.com/acme')).toBeNull()
    expect(parseGithubLink('https://github.com/acme/widgets/actions/runs/1')).toBeNull()
    expect(parseGithubLink('src/a.ts')).toBeNull()
    expect(parseGithubLink('javascript:alert(1)')).toBeNull()
    expect(parseGithubLink(undefined)).toBeNull()
  })
})

describe('githubLinkLabel', () => {
  it('makes short pill text', () => {
    expect(githubLinkLabel(parseGithubLink('https://github.com/acme/widgets/pull/42')!)).toBe('widgets#42')
    expect(githubLinkLabel(parseGithubLink('https://github.com/acme/widgets/commit/abcdef1234')!)).toBe('widgets@abcdef1')
    expect(githubLinkLabel(parseGithubLink('https://github.com/acme/widgets/blob/main/src/a.ts#L10-L20')!)).toBe('a.ts:10-20')
    expect(githubLinkLabel(parseGithubLink('https://github.com/acme/widgets/blob/main/src/a.ts')!)).toBe('a.ts')
    expect(githubLinkLabel(parseGithubLink('https://github.com/acme/widgets')!)).toBe('acme/widgets')
  })
})

describe('isBareLink', () => {
  it('is true only when the text is the URL', () => {
    expect(isBareLink('https://github.com/acme/widgets/pull/42', 'https://github.com/acme/widgets/pull/42')).toBe(true)
    expect(isBareLink('github.com/acme/widgets/pull/42/', 'https://github.com/acme/widgets/pull/42')).toBe(true)
    expect(isBareLink('the fix', 'https://github.com/acme/widgets/pull/42')).toBe(false)
  })
})

describe('refPathSplits', () => {
  it('tries the shortest ref first', () => {
    expect(refPathSplits('feat/x/src/a.ts')).toEqual([
      { ref: 'feat', path: 'x/src/a.ts' },
      { ref: 'feat/x', path: 'src/a.ts' },
      { ref: 'feat/x/src', path: 'a.ts' },
    ])
  })
})

describe('checksSummary', () => {
  it('counts the latest run per name', () => {
    const runs = [
      { id: 1, name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-01-01T00:00:00Z' },
      { id: 2, name: 'test', status: 'completed', conclusion: 'success', started_at: '2026-01-01T01:00:00Z' },
      { id: 3, name: 'lint', status: 'completed', conclusion: 'skipped', started_at: '2026-01-01T00:00:00Z' },
    ]
    expect(checksSummary(runs)).toEqual({ state: 'success', passed: 2, failed: 0, pending: 0, total: 2 })
    expect(checksSummary([...runs, { id: 4, name: 'build', status: 'in_progress', conclusion: null }])?.state).toBe('pending')
    expect(checksSummary([{ id: 5, name: 'x', status: 'completed', conclusion: 'timed_out' }])?.state).toBe('failure')
    expect(checksSummary([])).toBeNull()
  })
})

describe('reviewState', () => {
  it('lets each reviewer\'s last word count', () => {
    expect(reviewState([{ user: { login: 'a' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'a' }, state: 'APPROVED' }], false)).toBe('approved')
    expect(reviewState([{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'b' }, state: 'CHANGES_REQUESTED' }], false)).toBe('changes_requested')
    expect(reviewState([{ user: { login: 'a' }, state: 'COMMENTED' }], true)).toBe('review_required')
    expect(reviewState([], false)).toBeNull()
  })
})

describe('prPreview and issuePreview', () => {
  const pull = {
    number: 42,
    title: 'Add widgets',
    state: 'closed',
    merged_at: '2026-01-02T00:00:00Z',
    draft: false,
    user: { login: 'octo', avatar_url: 'https://avatars.example/u/1' },
    updated_at: '2026-01-02T00:00:00Z',
    additions: 10,
    deletions: 2,
    changed_files: 3,
    comments: 1,
    review_comments: 2,
    base: { ref: 'main', repo: { full_name: 'acme/widgets' } },
    head: { ref: 'feat/widgets', repo: { full_name: 'acme/widgets' } },
    requested_reviewers: [],
    html_url: 'https://github.com/acme/widgets/pull/42',
  }
  it('shapes a PR', () => {
    const p = prPreview(pull, [], null)
    expect(p).toMatchObject({ kind: 'pr', repo: 'acme/widgets', state: 'merged', comments: 3, isCrossRepository: false, checks: null, review: null })
    expect(prPreview({ ...pull, merged_at: null, state: 'open', draft: true }, null, null)).toMatchObject({ state: 'draft' })
    expect(prPreview({ ...pull, head: { ref: 'x', repo: { full_name: 'fork/widgets' } } }, null, null)).toMatchObject({ isCrossRepository: true })
  })
  it('shapes an issue', () => {
    const i = issuePreview({ number: 7, title: 'Bug', state: 'closed', state_reason: 'not_planned', labels: [{ name: 'bug', color: 'd73a4a' }], assignees: [{ login: 'a' }], user: { login: 'b' } }, 'acme/widgets')
    expect(i).toMatchObject({ kind: 'issue', state: 'not_planned', labels: [{ name: 'bug', color: 'd73a4a' }], assignees: ['a'] })
  })
})

describe('fileExcerpt', () => {
  const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  it('takes the linked lines, capped', () => {
    expect(fileExcerpt(text, 5, 7)).toEqual({ start: 5, lines: ['line 5', 'line 6', 'line 7'], truncated: false })
    expect(fileExcerpt(text, 5)).toEqual({ start: 5, lines: ['line 5'], truncated: false })
    expect(fileExcerpt(text, 1, 20).lines).toHaveLength(8)
    expect(fileExcerpt(text, 1, 20).truncated).toBe(true)
  })
  it('shows the top of the file when no lines are named', () => {
    expect(fileExcerpt(text)).toMatchObject({ start: 1, truncated: true })
    expect(fileExcerpt('a\nb')).toEqual({ start: 1, lines: ['a', 'b'], truncated: false })
  })
})

describe('shortAge', () => {
  it('rounds to the biggest unit', () => {
    const now = Date.parse('2026-01-10T00:00:00Z')
    expect(shortAge('2026-01-09T23:59:30Z', now)).toBe('just now')
    expect(shortAge('2026-01-09T22:00:00Z', now)).toBe('2h ago')
    expect(shortAge('2026-01-07T00:00:00Z', now)).toBe('3d ago')
    expect(shortAge('', now)).toBe('')
  })
})

// The main-process fetcher, with gh stubbed.
const calls: string[][] = []
let answers: Record<string, string> = {}
vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (e: unknown, r?: { stdout: string; stderr: string }) => void) => {
    calls.push(args)
    const path = args[args.length - 1]
    const hit = Object.entries(answers).find(([k]) => path.startsWith(k))
    if (hit) cb(null, { stdout: hit[1], stderr: '' })
    else cb(Object.assign(new Error('gh failed'), { stderr: 'gh: Not Found (HTTP 404)' }))
  },
}))

describe('linkPreview', () => {
  beforeEach(async () => {
    calls.length = 0
    answers = {}
    ;(await import('../src/main/linkPreview')).clearLinkPreviewCache()
  })

  it('fetches a PR with its reviews and checks, and caches it', async () => {
    const { linkPreview } = await import('../src/main/linkPreview')
    answers = {
      'repos/acme/widgets/pulls/42/reviews': JSON.stringify([{ user: { login: 'r' }, state: 'APPROVED' }]),
      'repos/acme/widgets/pulls/42': JSON.stringify({ number: 42, title: 'T', state: 'open', head: { sha: 'abc', ref: 'f', repo: { full_name: 'acme/widgets' } }, base: { ref: 'main', repo: { full_name: 'acme/widgets' } } }),
      'repos/acme/widgets/commits/abc/check-runs': JSON.stringify({ check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }] }),
    }
    const p = await linkPreview('https://github.com/acme/widgets/pull/42')
    expect(p).toMatchObject({ kind: 'pr', review: 'approved', checks: { state: 'success', passed: 1 } })
    const n = calls.length
    await linkPreview('https://github.com/acme/widgets/pull/42/files')
    expect(calls.length).toBe(n)
    await linkPreview('https://github.com/acme/widgets/pull/42', true)
    expect(calls.length).toBeGreaterThan(n)
  })

  it('follows an issue link that is really a PR', async () => {
    const { linkPreview } = await import('../src/main/linkPreview')
    answers = {
      'repos/acme/widgets/issues/5': JSON.stringify({ number: 5, pull_request: {} }),
      'repos/acme/widgets/pulls/5': JSON.stringify({ number: 5, title: 'P', state: 'open', base: { repo: { full_name: 'acme/widgets' } } }),
    }
    expect(await linkPreview('https://github.com/acme/widgets/issues/5')).toMatchObject({ kind: 'pr', number: 5 })
  })

  it('tries longer refs for a file in a branch with slashes', async () => {
    const { linkPreview } = await import('../src/main/linkPreview')
    answers = { 'repos/acme/widgets/contents/src/a.ts?ref=feat%2Fx': 'one\ntwo\nthree\n' }
    const p = await linkPreview('https://github.com/acme/widgets/blob/feat/x/src/a.ts#L2-L3')
    expect(p).toMatchObject({ kind: 'file', ref: 'feat/x', path: 'src/a.ts', start: 2, lines: ['two', 'three'] })
  })

  it('reports a missing item plainly', async () => {
    const { linkPreview } = await import('../src/main/linkPreview')
    await expect(linkPreview('https://github.com/acme/widgets/issues/999')).rejects.toThrow(/Not found/)
  })
})
