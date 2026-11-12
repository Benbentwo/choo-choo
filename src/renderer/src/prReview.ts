import { useEffect, useState } from 'react'
import type { Workspace } from '@shared/types'
import { defaultMode, type PrDiffTarget, type WorkspaceMode } from '@shared/prReview'
import { useStore, reportError } from './store'

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
