/**
 * Sidebar rows the person hid with right-click > Hide from sidebar.
 * Stored in `Settings.sidebarHidden` as keys:
 *   orchestrator:<repoId>               a project's Orchestrator row
 *   view:<repoId>:<addonKey>/<viewId>   an add-on row under a project (Plans, ...)
 *   view::<addonKey>/<viewId>           an add-on row at the top of the sidebar
 */
export const orchestratorRowKey = (repoId: string): string => `orchestrator:${repoId}`
export const viewRowKey = (addonKey: string, viewId: string, repoId?: string): string => `view:${repoId ?? ''}:${addonKey}/${viewId}`

export type HiddenRow = {
  key: string
  kind: 'orchestrator' | 'view'
  repoId?: string
  addonKey?: string
  viewId?: string
}

export function parseRowKey(key: string): HiddenRow | null {
  if (key.startsWith('orchestrator:')) {
    const repoId = key.slice('orchestrator:'.length)
    return repoId ? { key, kind: 'orchestrator', repoId } : null
  }
  const m = /^view:([^:]*):(.+)\/([^/]+)$/.exec(key)
  if (!m) return null
  return {
    key,
    kind: 'view',
    repoId: m[1] || undefined,
    addonKey: m[2],
    viewId: m[3]
  }
}

/** The list with `key` added or removed. Returns the same array when nothing changes. */
export function toggleHidden(list: string[] | undefined, key: string, hidden: boolean): string[] {
  const cur = list ?? []
  if (cur.includes(key) === hidden) return cur
  return hidden ? [...cur, key] : cur.filter((k) => k !== key)
}
