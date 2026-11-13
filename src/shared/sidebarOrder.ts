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

export type ProjectWorkSort = 'newest' | 'oldest' | 'pr' | 'title'

/**
 * Sorts the work under a project thread's repo. `pr` puts the lowest PR number first and work
 * without a PR last; `title` uses the PR title when there is one, as the row shows.
 */
export function sortProjectWork<W extends Pick<Workspace, 'id' | 'title' | 'createdAt' | 'prNumber'>>(
  list: W[],
  sort: ProjectWorkSort,
  prs: Record<string, { number: number; title: string } | null | undefined> = {}
): W[] {
  const newest = (a: W, b: W) => b.createdAt - a.createdAt
  const num = (w: W) => prs[w.id]?.number ?? w.prNumber ?? Infinity
  const title = (w: W) => prs[w.id]?.title ?? w.title
  return [...list].sort((a, b) => {
    if (sort === 'oldest') return a.createdAt - b.createdAt
    if (sort === 'pr') return num(a) === num(b) ? newest(a, b) : num(a) < num(b) ? -1 : 1
    if (sort === 'title') return title(a).localeCompare(title(b), undefined, { numeric: true }) || newest(a, b)
    return newest(a, b)
  })
}
