import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Status, ETag and body of a `gh api -i` response. */
export function parseGhApi(out: string): { status: number; etag?: string; body: string } {
  const split = out.search(/\r?\n\r?\n/)
  const head = split < 0 ? out : out.slice(0, split)
  const body = split < 0 ? '' : out.slice(split).replace(/^\r?\n\r?\n/, '')
  const status = Number(head.match(/^HTTP\/[\d.]+ (\d{3})/)?.[1] ?? 0)
  const etag = head.match(/^etag:\s*(.+)$/im)?.[1].trim()
  return { status, etag, body }
}

/**
 * A conditional GET through gh. With a matching ETag GitHub answers 304, which doesn't count
 * against the rate limit, so this can run often. `{owner}` and `{repo}` resolve from `cwd`.
 */
async function conditionalGet(cwd: string, path: string, etag: string | undefined, jq: string) {
  const args = ['api', '-i', ...(etag ? ['-H', `If-None-Match: ${etag}`] : []), '--jq', jq, path]
  try {
    const { stdout } = await exec('gh', args, { cwd, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })
    return parseGhApi(stdout)
  } catch (e) {
    // gh exits non-zero on 304 but still prints the headers.
    const out = (e as { stdout?: string }).stdout ?? ''
    const r = parseGhApi(out)
    if (r.status === 304) return r
    throw e
  }
}

interface Watch {
  pullsEtag?: string
  checksEtag?: string
  sha?: string
  lastFull: number
}

export interface WatchTarget {
  id: string
  path: string
  branch: string
}

/** How often to probe each workspace: often while the app is in front, less in the background. */
const FOCUSED_MS = 15_000
const BACKGROUND_MS = 60_000
/** Refresh in full now and then anyway, for changes the probes can't see (fork PRs, statuses). */
const FULL_EVERY_MS = 5 * 60_000

/**
 * Watches each workspace's PR and checks with cheap ETag probes, and calls `onChange` when
 * something changed, so the UI refetches only then instead of every panel polling on a timer.
 */
export function startPrWatch(opts: { targets: () => WatchTarget[]; focused: () => boolean; onChange: (wsId: string) => void }) {
  const watches = new Map<string, Watch>()
  let lastTick = 0
  let busy = false

  const probe = async (t: WatchTarget, w: Watch): Promise<boolean> => {
    let changed = false
    const pulls = await conditionalGet(
      t.path,
      `repos/{owner}/{repo}/pulls?head={owner}:${encodeURIComponent(t.branch)}&state=all&per_page=1`,
      w.pullsEtag,
      '[.[0] | {n: .number, sha: .head.sha}]'
    )
    if (pulls.status === 200) {
      changed = w.pullsEtag !== undefined
      w.pullsEtag = pulls.etag
      try {
        const sha = (JSON.parse(pulls.body) as { sha?: string }[])[0]?.sha
        if (sha !== w.sha) {
          w.sha = sha
          w.checksEtag = undefined
        }
      } catch {
        // Unexpected body: the full refresh below still runs on schedule.
      }
    }
    if (w.sha) {
      const runs = await conditionalGet(t.path, `repos/{owner}/{repo}/commits/${w.sha}/check-runs?per_page=100`, w.checksEtag, '.total_count')
      if (runs.status === 200) {
        if (w.checksEtag !== undefined) changed = true
        w.checksEtag = runs.etag
      }
    }
    return changed
  }

  const tick = async () => {
    if (busy) return
    const now = Date.now()
    if (now - lastTick < (opts.focused() ? FOCUSED_MS : BACKGROUND_MS)) return
    lastTick = now
    busy = true
    try {
      const targets = opts.targets()
      for (const id of watches.keys()) if (!targets.some((t) => t.id === id)) watches.delete(id)
      for (const t of targets) {
        const w = watches.get(t.id) ?? { lastFull: now }
        watches.set(t.id, w)
        let changed = false
        try {
          changed = await probe(t, w)
        } catch {
          // Offline, signed out or not on GitHub: try again next tick.
          continue
        }
        if (changed || now - w.lastFull > FULL_EVERY_MS) {
          w.lastFull = now
          opts.onChange(t.id)
        }
      }
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => void tick(), 5_000)
  return {
    /** Probe now, e.g. when the window comes to the front. */
    poke: () => {
      lastTick = 0
      void tick()
    },
    stop: () => clearInterval(timer)
  }
}
