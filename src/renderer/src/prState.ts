import { useEffect, useState } from 'react'
import type { PrInfo, Repo, Workspace } from '@shared/types'
import { useStore } from './store'

/** The last PR seen for each workspace, with the PR version it was read at. */
const cache = new Map<string, { version: number; pr: PrInfo | null }>()

/** Every sidebar row asks at once on launch; each ask is a `gh` process, so only a few run together. */
const MAX = 3
let active = 0
const waiting: (() => void)[] = []
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX) await new Promise<void>((r) => waiting.push(r))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiting.shift()?.()
  }
}

/**
 * The PR of a workspace's branch for its sidebar row: null when there is none, undefined until known.
 * Reloads when the PR watcher sees a change. Skips workspaces that can't have a PR.
 */
export function usePrState(ws: Workspace, repo: Repo | undefined): PrInfo | null | undefined {
  const version = useStore((s) => s.prVersion[ws.id] ?? 0)
  const [pr, setPr] = useState(() => cache.get(ws.id)?.pr)
  const can = !!repo?.githubOwner && !ws.orchestrator && !ws.archived && ws.branch !== repo.defaultBranch
  useEffect(() => {
    if (!can) return setPr(undefined)
    const cached = cache.get(ws.id)
    setPr(cached?.pr)
    if (cached?.version === version) return
    let live = true
    void limited(() => window.api.getPrState(ws.id)).then(
      (p) => {
        cache.set(ws.id, { version, pr: p })
        if (live) setPr(p)
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [ws.id, ws.branch, version, can])
  return pr
}

/** Right-click menu entries for a workspace row whose branch has a PR: copy its link, open it. */
export function prMenuItems(pr: PrInfo | null | undefined): ({ label: string; onClick: () => void } | { kind: 'sep' })[] {
  if (!pr?.url) return []
  return [
    { label: `Copy link to #${pr.number}`, onClick: () => void navigator.clipboard.writeText(pr.url) },
    { label: `Open #${pr.number} on GitHub`, onClick: () => void window.api.openExternal(pr.url) },
    { kind: 'sep' }
  ]
}
