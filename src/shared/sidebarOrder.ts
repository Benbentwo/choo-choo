import type { Workspace } from './types'

export type WorkspaceSort = 'newest' | 'oldest' | 'name' | 'manual'

/**
 * Sorts sidebar workspaces. `manual` follows the order the person dragged them into; workspaces that
 * were never placed (new ones) go on top, newest first.
 */
export function sortWorkspaces<W extends Pick<Workspace, 'title' | 'createdAt' | 'order'>>(list: W[], sort: WorkspaceSort): W[] {
  const newest = (a: W, b: W) => b.createdAt - a.createdAt
  return [...list].sort((a, b) => {
    if (sort === 'name') return a.title.localeCompare(b.title)
    if (sort === 'oldest') return a.createdAt - b.createdAt
    if (sort === 'manual') {
      if (a.order === undefined || b.order === undefined) return a.order === b.order ? newest(a, b) : a.order === undefined ? -1 : 1
      return a.order - b.order || newest(a, b)
    }
    return newest(a, b)
  })
}

/** Moves `id` next to `target` (before it, or after it when `after`). Returns the new list. */
export function moveId(ids: string[], id: string, target: string, after: boolean): string[] {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return ids
  const rest = ids.filter((x) => x !== id)
  rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, id)
  return rest
}
