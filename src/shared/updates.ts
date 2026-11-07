/** Where an app update comes from and how it gets installed. */
export type AppUpdateMethod = 'auto' | 'brew' | 'download'

export interface AppUpdateStatus {
  current: string
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

/** Compares two versions: negative if a is older, positive if newer, 0 if equal. Pre-releases sort before their release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = (parseVersion(v) ?? '0.0.0').split('-', 2) as [string, string | undefined]
    return { nums: core.split('.').map(Number), pre }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i]
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre < y.pre ? -1 : 1
}

export const isNewer = (latest: string | undefined, current: string | undefined) => !!latest && !!current && compareVersions(latest, current) > 0
