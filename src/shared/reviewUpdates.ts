/**
 * Review updates: telling a reviewer when a PR they review changed in a way that matters to them,
 * and showing only what changed since their last review. "What changed" is the interdiff: the PR's
 * own changes now against its own changes then, so a merge from the base branch or a clean rebase
 * comes out empty. See docs/prd/review-updates.md.
 */

export interface ReviewSettings {
  /** A macOS notification when a PR newly asks for my review. Off until turned on. */
  onNewRequest: boolean
  /** Tell me when a PR I'm reviewing changes for me. */
  notify: boolean
  /** The PR's own changes moved (non-empty interdiff). */
  onCode: boolean
  /** Someone answered a thread I started. */
  onReply: boolean
  /** My review was requested again after I reviewed. */
  onRerequest: boolean
  /** A draft was marked ready for review. */
  onReady: boolean
  /** Checks went from passing or pending to failing. */
  onChecksFailed: boolean
  /** Any push at all, even one that changes nothing in the PR. */
  onAnyPush: boolean
  /** Keep quiet about merges from the base branch. */
  quietBaseMerges: boolean
  /** Keep quiet about rebases that leave the PR's changes the same. */
  quietSameRebase: boolean
  /** Keep quiet about files matching these globs (lockfiles, generated code). */
  ignoreOn: boolean
  ignoreGlobs: string[]
  /** Keep quiet about changes smaller than this many added plus removed lines. */
  minLinesOn: boolean
  minLines: number
  /** Bold with a dot on the PRs page, and "new" on the sidebar. */
  showInList: boolean
  /** A macOS notification. */
  osNotify: boolean
  /** Only send OS notifications between these times (HH:MM, local). */
  quietHoursOn: boolean
  from: string
  to: string
  /** Open PRs you already reviewed on "Since your review". */
  openSinceReview: boolean
  /** Keep the diff's "viewed" ticks in step with GitHub's. */
  syncViewed: boolean
  /** How often to check GitHub, in minutes. 1, 2 and 5 are offered; any whole number from 1 to 120 can be typed. */
  pollMinutes: number
}

export const DEFAULT_IGNORE_GLOBS = ['*.lock', 'package-lock.json', 'pnpm-lock.yaml', 'go.sum', '**/generated/**', '*.snap']

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  onNewRequest: false,
  notify: true,
  onCode: true,
  onReply: true,
  onRerequest: true,
  onReady: true,
  onChecksFailed: false,
  onAnyPush: false,
  quietBaseMerges: true,
  quietSameRebase: true,
  ignoreOn: true,
  ignoreGlobs: DEFAULT_IGNORE_GLOBS,
  minLinesOn: false,
  minLines: 5,
  showInList: true,
  osNotify: true,
  quietHoursOn: false,
  from: '09:00',
  to: '18:00',
  openSinceReview: true,
  syncViewed: true,
  pollMinutes: 2
}

export function normalizeReviewSettings(r: Partial<ReviewSettings> | undefined): ReviewSettings {
  const out = { ...DEFAULT_REVIEW_SETTINGS, ...r }
  out.pollMinutes = clampMinutes(out.pollMinutes)
  out.minLines = Math.max(1, Math.round(Number(out.minLines) || DEFAULT_REVIEW_SETTINGS.minLines))
  if (!Array.isArray(out.ignoreGlobs)) out.ignoreGlobs = DEFAULT_IGNORE_GLOBS
  return out
}

export function clampMinutes(n: unknown): number {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.min(120, Math.max(1, v)) : DEFAULT_REVIEW_SETTINGS.pollMinutes
}

/** Splits what someone typed into the ignore box: commas or new lines, blanks dropped. */
export function parseGlobs(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))]
}

/**
 * A glob as a RegExp, gitignore-style: `*` stays within a folder, `**` crosses folders, `?` is one
 * character, and a pattern with no slash matches the file name in any folder.
 */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim().replace(/^\.\//, '')
  const anchored = g.includes('/')
  if (g.startsWith('/')) g = g.slice(1)
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**/` is zero or more folders; a trailing `**` is everything below.
        if (g[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(anchored ? `^${re}$` : `(?:^|/)${re}$`)
}

export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => g.trim() && globToRegExp(g).test(path))
}

/** The globs in force, or none when the setting is off. */
export function activeGlobs(s: Pick<ReviewSettings, 'ignoreOn' | 'ignoreGlobs'>): string[] {
  return s.ignoreOn ? s.ignoreGlobs : []
}

/** What changed in the PR's own code between two of its commits. */
export interface Interdiff {
  from: string
  to: string
  /** Files the author changed, with lines added and removed in the interdiff. */
  files: { path: string; status: 'A' | 'M' | 'D' | 'R'; additions: number; deletions: number }[]
  /** Commits between the two heads (any kind). */
  commits: number
  /** Commits that came in from the base branch (a merge from main, or the new base of a rebase). */
  baseCommits: number
  /** Files that differ between the two heads only because the base branch moved. */
  leftOut: string[]
  /** Files that matched the ignore globs and are not counted. */
  ignored: string[]
  /** How the head moved: plain new commits, a merge from the base, or rewritten history. */
  kind: 'push' | 'base-merge' | 'rebase'
  /**
   * False when some files couldn't be replayed onto the new base (they conflict with it). For those
   * the plain diff between the two heads is used, which may include changes from the base.
   */
  exact: boolean
}

/** One file's patch, as git or GitHub gives it. */
export interface FilePatch {
  path: string
  /** Unified diff text; missing when GitHub left it out (binary or too large). */
  patch?: string
}

/** The changed lines of a patch, without line numbers or context, for comparing two versions of a PR. */
export function patchBody(patch: string): string[] {
  const out: string[] = []
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+') || line.startsWith('-')) out.push(line.replace(/\s+$/, ''))
  }
  return out
}

/**
 * Files whose PR patch differs between two versions of the PR. Used when there is no local clone:
 * GitHub's compare API gives each version's patch per file. A patch GitHub left out counts as changed
 * when the file is in both lists, since we can't tell.
 */
export function comparePatches(before: FilePatch[], after: FilePatch[], ignore: string[] = []): { changed: { path: string; additions: number; deletions: number }[]; ignored: string[] } {
  const old = new Map(before.map((f) => [f.path, f]))
  const now = new Map(after.map((f) => [f.path, f]))
  const changed: { path: string; additions: number; deletions: number }[] = []
  const ignored: string[] = []
  for (const path of new Set([...old.keys(), ...now.keys()])) {
    const a = old.get(path)
    const b = now.get(path)
    const pa = a?.patch === undefined ? undefined : patchBody(a.patch)
    const pb = b?.patch === undefined ? undefined : patchBody(b.patch)
    let same: boolean
    if (!a || !b) same = false
    else if (pa === undefined || pb === undefined) same = false
    else same = pa.length === pb.length && pa.every((l, i) => l === pb[i])
    if (same) continue
    if (matchesAny(path, ignore)) {
      ignored.push(path)
      continue
    }
    const [additions, deletions] = lineDelta(pa ?? [], pb ?? [])
    changed.push({ path, additions, deletions })
  }
  return { changed: changed.sort((x, y) => x.path.localeCompare(y.path)), ignored: ignored.sort() }
}

/** Rough size of the change between two patch bodies: lines only in the new one, lines only in the old one. */
function lineDelta(a: string[], b: string[]): [number, number] {
  const count = (xs: string[]) => {
    const m = new Map<string, number>()
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
    return m
  }
  const ca = count(a)
  const cb = count(b)
  let add = 0
  let del = 0
  for (const [k, n] of cb) add += Math.max(0, n - (ca.get(k) ?? 0))
  for (const [k, n] of ca) del += Math.max(0, n - (cb.get(k) ?? 0))
  return [add, del]
}

/** Lines added plus removed across a list of file changes. */
export const linesChanged = (files: { additions: number; deletions: number }[]) => files.reduce((n, f) => n + f.additions + f.deletions, 0)

/** "3 files changed since your review", or null when nothing did. */
export function filesSinceLabel(n: number): string | null {
  return n ? `${n} file${n === 1 ? '' : 's'} changed since your review` : null
}

/** "1 merge from main (41 files)" style summary of what the interdiff left out. */
export function leftOutLabel(d: Pick<Interdiff, 'kind' | 'baseCommits' | 'leftOut' | 'ignored'>, base: string): string | null {
  const parts: string[] = []
  if (d.leftOut.length || d.baseCommits) {
    const what = d.kind === 'rebase' ? `a rebase onto ${base}` : `changes from ${base}`
    parts.push(d.leftOut.length ? `${what} (${d.leftOut.length} file${d.leftOut.length === 1 ? '' : 's'})` : what)
  }
  if (d.ignored.length) parts.push(d.ignored.length === 1 ? d.ignored[0] : `${d.ignored.length} ignored files`)
  return parts.length ? `Left out: ${parts.join(' and ')}.` : null
}
