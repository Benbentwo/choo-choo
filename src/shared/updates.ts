/** Where an app update comes from and how it gets installed. */
export type AppUpdateMethod = 'auto' | 'brew' | 'download'

/** stable: published releases only. beta: also the prerelease built from every merge to main. */
export type UpdateChannel = 'stable' | 'beta'

export interface AppUpdateStatus {
  current: string
  channel: UpdateChannel
  latest?: string
  /** auto: a signed build updates itself. brew: `brew upgrade` swaps it. download: you install it from the release page. */
  method: AppUpdateMethod
  state: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'installing' | 'error' | 'unavailable'
  error?: string
  /** The release page. */
  url?: string
  checkedAt?: number
}

export interface ClaudeUpdateStatus {
  /** Which Claude Code agents run: the copy bundled with the app or your installed `claude`. */
  source: 'bundled' | 'installed'
  path?: string
  current?: string
  latest?: string
  /** Your installed `claude`, when one is found, so the UI can offer to switch to it. */
  installedPath?: string
  state: 'idle' | 'checking' | 'up-to-date' | 'available' | 'updating' | 'error'
  error?: string
  checkedAt?: number
}

export interface UpdateStatus {
  app: AppUpdateStatus
  claude: ClaudeUpdateStatus
}

/** The first x.y.z in some text, like `2.1.318 (Claude Code)` or `v0.2.0`. */
export function parseVersion(text: string | undefined | null): string | undefined {
  return text?.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0]
}

/** Compares two versions: negative if a is older, positive if newer, 0 if equal. Pre-releases sort before their release, by semver rules. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const full = parseVersion(v) ?? '0.0.0'
    const dash = full.indexOf('-')
    const core = dash < 0 ? full : full.slice(0, dash)
    return { nums: core.split('.').map(Number), pre: dash < 0 ? undefined : full.slice(dash + 1) }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i]
  if (x.pre === y.pre) return 0
  if (x.pre === undefined) return 1
  if (y.pre === undefined) return -1
  // Dot-separated parts: numbers compare as numbers and sort before words; more parts wins a tie.
  const xs = x.pre.split('.')
  const ys = y.pre.split('.')
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === undefined) return -1
    if (ys[i] === undefined) return 1
    if (xs[i] === ys[i]) continue
    const xn = /^\d+$/.test(xs[i])
    const yn = /^\d+$/.test(ys[i])
    if (xn && yn) return Number(xs[i]) - Number(ys[i])
    if (xn !== yn) return xn ? -1 : 1
    return xs[i] < ys[i] ? -1 : 1
  }
  return 0
}

/** The newest version in a list, or undefined when it's empty. */
export function newestVersion(versions: (string | undefined)[]): string | undefined {
  return versions.filter((v): v is string => !!v).reduce<string | undefined>((best, v) => (!best || compareVersions(v, best) > 0 ? v : best), undefined)
}

export const isNewer = (latest: string | undefined, current: string | undefined) => !!latest && !!current && compareVersions(latest, current) > 0
