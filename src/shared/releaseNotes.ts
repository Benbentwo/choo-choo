import { compareVersions, parseVersion, type UpdateChannel } from './updates'

/**
 * "What's new" for an app update: the release notes of every version between the one you run and the
 * one you're about to get, cut down to what a person using the app cares about. See docs/prd/update-checks.md.
 */

/** A GitHub release as the REST API returns it, only the fields we read. */
export interface GithubRelease {
  tag_name?: string
  name?: string | null
  body?: string | null
  html_url?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string | null
}

export interface NoteSection {
  /** Empty for changes the notes didn't put under a heading. */
  title: string
  items: string[]
}

export interface ReleaseNote {
  version: string
  prerelease: boolean
  url?: string
  publishedAt?: number
  sections: NoteSection[]
}

/** Sections people using the app don't need: how to download, docs-only changes. */
const SKIP_SECTIONS = /^(download|docs?|documentation)$/i
/** Headings that just hold the list; their items count as untitled. */
const PLAIN_SECTIONS = /^(what'?s changed|changes)$/i
/** Lines that are about the repo, not the app. */
const SKIP_LINES = [
  /^\*\*full changelog/i,
  /^full changelog/i,
  /^beta build of\b/i,
  /^turn on settings\b/i,
  /^small fixes and polish$/i
]
/** Changes that don't change the app for anyone using it. Dependency bumps of the bundled Claude Code are the exception. */
const SKIP_ITEMS = [/^(deps?|ci|chore|build|test)s?(\(.+?\))?:/i, /\bbump(s|ed)?\b(?!.*claude)/i, /^readme\b/i, /^docs?:/i]

/** Friendlier names for Release Drafter's section titles. */
const RENAME: Record<string, string> = {
  'new features': 'New',
  features: 'New',
  fixes: 'Fixes',
  'bug fixes': 'Fixes',
  maintenance: 'Other changes',
  'breaking changes': 'Breaking changes'
}

/** "- Add a thing (#12) @someone" -> "Add a thing". Keeps the words, drops the bookkeeping. */
export function cleanItem(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\s+@\[?[\w[\]-]+\]?(\([^)]*\))?\s*$/, '') // trailing @author, or Release Drafter's @[bot](url)
    .replace(/\s*\((?:#\d+(?:,\s*)?)+\)\s*$/, '') // trailing (#12)
    .replace(/\s+in\s+https:\/\/github\.com\/\S+\/pull\/\d+\s*$/, '') // GitHub's generated notes
    .replace(/\s+by\s+@[\w-]+(?=\s|$)/, '')
    .replace(/\\([<*_&])/g, '$1') // Release Drafter escapes these
    .trim()
}

/** Parses one release body into sections of plain items. */
export function parseNotes(body: string | null | undefined): { sections: NoteSection[] } {
  const sections: NoteSection[] = []
  let current: NoteSection | null = { title: '', items: [] }
  sections.push(current)
  for (const raw of (body ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    const heading = line.match(/^#{1,4}\s+(.+?)\s*#*$/)
    if (heading) {
      const title = heading[1].replace(/[*_`]/g, '').trim()
      if (SKIP_SECTIONS.test(title)) current = null
      else if (PLAIN_SECTIONS.test(title)) current = sections[0]
      else {
        current = { title: RENAME[title.toLowerCase()] ?? title, items: [] }
        sections.push(current)
      }
      continue
    }
    if (!current || !line || SKIP_LINES.some((r) => r.test(line))) continue
    // Prose lines (a beta's single summary line) count as an item too.
    // A bump of the Agent SDK is a new bundled Claude Code, which people do care about.
    const item = /claude-agent-sdk/.test(line) && /\bbump/i.test(line) ? 'Updated the bundled Claude Code' : cleanItem(line)
    if (!item || SKIP_ITEMS.some((r) => r.test(item)) || SKIP_LINES.some((r) => r.test(item))) continue
    current.items.push(item)
  }
  return { sections: sections.filter((s) => s.items.length) }
}

/**
 * The notes for every release after `current` up to and including `target`, newest first.
 * Stable people only see stable releases. Beta people see betas too, except betas older than a stable
 * release in the range: that stable release already lists what they shipped. A change listed under a
 * newer version is left out of older ones.
 */
export function notesBetween(releases: GithubRelease[], current: string, target: string, channel: UpdateChannel): ReleaseNote[] {
  const inRange = releases
    .filter((r) => !r.draft && (channel === 'beta' || !r.prerelease))
    .map((r) => ({ r, v: parseVersion(r.tag_name) }))
    .filter((x): x is { r: GithubRelease; v: string } => !!x.v && compareVersions(x.v, current) > 0 && compareVersions(x.v, target) <= 0)
    .sort((a, b) => compareVersions(b.v, a.v))
  const newestStable = inRange.find((x) => !x.r.prerelease && !x.v.includes('-'))
  const shown = newestStable ? inRange.filter((x) => !(x.r.prerelease || x.v.includes('-')) || compareVersions(x.v, newestStable.v) > 0) : inRange
  // Newest first, so a change that shows up again (a beta's PR in the next beta) stays with the newest.
  const seen = new Set<string>()
  const out: ReleaseNote[] = []
  for (const { r, v } of shown) {
    const kept = parseNotes(r.body)
      .sections.map((s) => ({
        title: s.title,
        items: s.items.filter((item) => {
          const key = item.toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      }))
      .filter((s) => s.items.length)
    out.push({
      version: v,
      prerelease: !!r.prerelease || v.includes('-'),
      url: r.html_url,
      publishedAt: r.published_at ? Date.parse(r.published_at) : undefined,
      sections: kept
    })
  }
  return out
}

/** How many changes the notes list, for a button label like "What's new (12)". */
export const changeCount = (notes: ReleaseNote[]) => notes.reduce((n, r) => n + r.sections.reduce((m, s) => m + s.items.length, 0), 0)
