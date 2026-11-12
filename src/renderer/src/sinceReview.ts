import { useEffect } from 'react'
import type { Workspace } from '@shared/types'
import { isTheirs } from '@shared/prReview'
import { normalizeReviewSettings } from '@shared/reviewUpdates'
import { useStore } from './store'
import { usePrReview, useWorkspaceMode } from './prReview'

/** One load per workspace, review commit and head, however many views ask. */
const loading = new Map<string, string>()

/**
 * Since your review: on someone else's open PR in Review mode, after you've reviewed it and the
 * author pushed, what they changed in the PR's own code (base-branch changes left out), and whether
 * the diff and file list show only that. The toggle is remembered per workspace; until it's touched
 * it follows Settings › Reviews › "Open reviewed PRs on Since your review".
 */
export function useSinceReview(ws: Workspace) {
  const review = usePrReview(ws)
  const { mode } = useWorkspaceMode(ws)
  const head = useStore((s) => s.prSync[ws.id]?.sync?.head)
  const data = useStore((s) => s.sinceReview[ws.id])
  const pref = useStore((s) => s.sinceReviewOn[ws.id])
  const fallback = normalizeReviewSettings(useStore((s) => s.settings.reviews)).openSinceReview
  const info = review?.info
  const since = info?.myReviewCommit
  const eligible = review?.pr.state === 'OPEN' && mode === 'review' && isTheirs(info) && !!since && !!head && since !== head
  const key = eligible ? `${since}:${head}` : ''

  useEffect(() => {
    if (!key) return
    if (loading.get(ws.id) === key) return
    loading.set(ws.id, key)
    void window.api.getInterdiff(ws.id, since!).then(
      (r) => {
        const st = useStore.getState()
        st.set({ sinceReview: { ...st.sinceReview, [ws.id]: r } })
      },
      () => {
        loading.delete(ws.id)
      }
    )
  }, [ws.id, key])

  const current = eligible && data && data.from === since ? data : null
  const on = !!current && (pref ?? fallback)
  const setOn = (v: boolean) => {
    const st = useStore.getState()
    const next = { ...st.sinceReviewOn, [ws.id]: v }
    localStorage.setItem('sinceReviewOn', JSON.stringify(next))
    st.set({ sinceReviewOn: next })
  }
  return { data: current, on, setOn, since, verdict: info?.myReview }
}
