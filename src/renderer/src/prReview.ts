import { useEffect, useState } from 'react'
import type { Workspace } from '@shared/types'
import { defaultMode, moveComments, type PrDiffTarget, type WorkspaceMode } from '@shared/prReview'
import { useStore, reportError, setCodeComments, refreshStats } from './store'

/** Loads at most once per workspace and PR change, however many views ask. */
const loading = new Map<string, number>()

/** The workspace's PR with its author, the signed-in gh user and feedback. The PR button keeps it fresh. */
export function usePrReview(ws: Workspace) {
  const entry = useStore((s) => s.prReview[ws.id])
  const version = useStore((s) => s.prVersion[ws.id] ?? 0)
  useEffect(() => {
    if (loading.get(ws.id) === version) return
    loading.set(ws.id, version)
    void window.api.getPrReview(ws.id).then(
      (r) => {
        const st = useStore.getState()
        st.set({ prReview: { ...st.prReview, [ws.id]: r } })
      },
      () => {}
    )
  }, [ws.id, version])
  return entry ?? null
}

/** Which diff lines can go into a GitHub review. Only loaded while `enabled`. */
export function usePrDiffTarget(ws: Workspace, enabled: boolean) {
  const [target, setTarget] = useState<PrDiffTarget | null>(null)
  const version = useStore((s) => s.prVersion[ws.id] ?? 0)
  const stats = useStore((s) => s.stats[ws.id])
  useEffect(() => {
    if (!enabled) return setTarget(null)
    let live = true
    void window.api.getPrDiffTarget(ws.id).then(
      (t) => live && setTarget(t),
      () => live && setTarget(null)
    )
    return () => {
      live = false
    }
  }, [ws.id, enabled, version, stats])
  return target
}

/** Sends a message to the workspace's main chat (not a review chat) and shows it. */
export async function sendToAgent(ws: Workspace, text: string) {
  const s = useStore.getState()
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const active = chats.find((c) => c.id === s.activeChat[ws.id] && !c.review)
  const target = active ?? chats.filter((c) => !c.review).sort((a, b) => a.createdAt - b.createdAt)[0]
  if (!target) return
  s.setActiveChat(ws.id, target.id)
  try {
    await window.api.sendMessage(target.id, text)
  } catch (e) {
    reportError(e)
  }
}

export type WsMode = WorkspaceMode

/**
 * Whether the person is building in this workspace (their own branch: the agent commits and pushes)
 * or reviewing someone else's PR (line comments go to a GitHub review, the agent only explains).
 * Follows PR ownership until the person switches it, e.g. to push fixes on a coworker's PR.
 */
export function useWorkspaceMode(ws: Workspace): { mode: WsMode; auto: WsMode; set: (m: WsMode) => void } {
  const review = usePrReview(ws)
  const override = useStore((s) => s.wsMode[ws.id])
  const auto = defaultMode(review?.info, review?.pr)
  const set = (m: WsMode) => {
    const st = useStore.getState()
    const next = { ...st.wsMode }
    if (m === auto) delete next[ws.id]
    else next[ws.id] = m
    st.set({ wsMode: next, rightTab: m === 'review' ? 'review' : 'changes' })
    localStorage.setItem('wsMode', JSON.stringify(next))
  }
  return { mode: override ?? auto, auto, set }
}

/** Brings line comments written on older commits to the worktree's `head`, moving or flagging them. */
export async function reanchorComments(wsId: string, head: string) {
  const list = useStore.getState().codeComments[wsId] ?? []
  const old = list.filter((c) => c.commit && c.commit !== head)
  if (!old.length) return
  const diffs: Record<string, Record<string, string>> = {}
  for (const from of new Set(old.map((c) => c.commit!))) {
    const files = [...new Set(old.filter((c) => c.commit === from && c.side === 'new').map((c) => c.file))]
    diffs[from] = files.length ? await window.api.getRangeDiffs(wsId, from, head, files).catch(() => ({})) : {}
  }
  const ids = new Set(old.map((c) => c.id))
  const moved = new Map(moveComments(old, head, diffs).map((c) => [c.id, c]))
  // Comments may have been added or removed while git ran: only touch the ones looked at.
  setCodeComments(wsId, (cur) => cur.map((c) => (ids.has(c.id) && c.commit === list.find((x) => x.id === c.id)?.commit ? (moved.get(c.id) ?? c) : c)))
}

const syncRun = new Map<string, number>()

/** Asks where the worktree stands against the PR's head, or moves it there, and keeps comments in place. */
export async function syncPrHead(ws: Workspace, how: 'check' | 'ff' | 'reset') {
  const run = (syncRun.get(ws.id) ?? 0) + 1
  syncRun.set(ws.id, run)
  const r = await window.api.followPr(ws.id, how)
  const st = useStore.getState()
  const prev = st.prSync[ws.id]
  if (r) await reanchorComments(ws.id, r.head)
  if (r?.state === 'updated') void refreshStats(ws.id)
  // An older call answering late doesn't overwrite a newer one, but an update it made still shows.
  if (syncRun.get(ws.id) !== run && r?.state !== 'updated') return r
  const updated = r?.state === 'updated' ? r.commits : r?.state === 'current' ? prev?.updated : undefined
  useStore.getState().set({ prSync: { ...useStore.getState().prSync, [ws.id]: { sync: r, updated } } })
  return r
}

/**
 * Keeps the worktree on the PR's latest commit. Reviewing, it fast-forwards on its own when the author
 * pushes (not while the agent is working in it); building, it only reports, since the commits are
 * usually your own agent's. Either way the Review banner offers the update when it doesn't happen.
 */
export function useFollowPrHead(ws: Workspace) {
  const review = usePrReview(ws)
  const { mode } = useWorkspaceMode(ws)
  const version = useStore((s) => s.prVersion[ws.id] ?? 0)
  const agentBusy = useStore((s) => s.chats.some((c) => c.workspaceId === ws.id && c.status === 'running'))
  const open = review?.pr.state === 'OPEN'
  const prHead = review?.pr.headRefOid
  useEffect(() => {
    if (!open || !prHead) {
      const st = useStore.getState()
      if (st.prSync[ws.id]) st.set({ prSync: { ...st.prSync, [ws.id]: undefined } })
      return
    }
    void syncPrHead(ws, mode === 'review' && !agentBusy ? 'ff' : 'check').catch(() => {})
  }, [ws.id, open, prHead, mode, agentBusy, version])
}

/** Clears the "updated to the latest" note. */
export function dismissPrUpdated(wsId: string) {
  const st = useStore.getState()
  const cur = st.prSync[wsId]
  if (cur) st.set({ prSync: { ...st.prSync, [wsId]: { ...cur, updated: undefined } } })
}
