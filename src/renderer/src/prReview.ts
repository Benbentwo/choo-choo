import { useEffect, useState } from 'react'
import type { Workspace } from '@shared/types'
import type { PrDiffTarget } from '@shared/prReview'
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
