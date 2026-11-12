import { useState } from 'react'
import type { PrComment, Workspace } from '@shared/types'
import { leftOutLabel } from '@shared/reviewUpdates'
import { useSinceReview } from '../sinceReview'
import { addressedPrompt, isTheirs, myOpenThreads, threadStatus, type ThreadStatus } from '@shared/prReview'
import { useStore, openDoc, reportError } from '../store'
import { dismissPrUpdated, sendToAgent, syncPrHead, usePrReview, useWorkspaceMode } from '../prReview'
import { IconBot, IconX } from '../icons'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Above the right panel's tabs: the PR moved on GitHub and the worktree hasn't, or it just caught up.
 * Reviewing, catching up is automatic; this shows when it couldn't be, and in Build mode.
 */
export function PrSyncBanner({ ws }: { ws: Workspace }) {
  const entry = useStore((s) => s.prSync[ws.id])
  const [busy, setBusy] = useState(false)
  const sync = entry?.sync
  const run = async (how: 'ff' | 'reset') => {
    setBusy(true)
    try {
      const r = await syncPrHead(ws, how)
      if (r && r.state !== 'updated' && r.state !== 'current' && r.reason) reportError(new Error(r.reason))
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  const box = 'mx-3 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px]'
  const btn = 'shrink-0 rounded-md px-2 py-0.5 font-medium disabled:opacity-40'
  if (sync?.state === 'behind') {
    return (
      <div className={`${box} border-sky-400/40 bg-sky-400/10`}>
        <div className="min-w-0 flex-1">
          <div>{sync.commits ? `The PR has ${plural(sync.commits, 'new commit')} that this worktree doesn't.` : 'The PR has moved on GitHub.'}</div>
          <div className="text-[12px] text-muted">{sync.reason ?? 'Your drafts move with the code; any whose lines changed are marked for you to check.'}</div>
        </div>
        <button className={`${btn} bg-sky-400 text-[#0f1420]`} disabled={busy} onClick={() => void run('ff')}>
          {busy ? 'Updating…' : 'Update'}
        </button>
      </div>
    )
  }
  if (sync?.state === 'diverged') {
    const reset = () => {
      const msg = `Move this worktree to the PR's latest commit?\n\n${plural(sync.local, 'commit')} here that ${sync.local === 1 ? "isn't" : "aren't"} on the PR will be left behind (git reflog can still find them). Uncommitted edits stay.`
      if (confirm(msg)) void run('reset')
    }
    return (
      <div className={`${box} border-amber-400/40 bg-amber-400/10`}>
        <div className="min-w-0 flex-1">
          <div>This worktree and the PR have gone separate ways.</div>
          <div className="text-[12px] text-muted">{sync.reason}</div>
        </div>
        <button className={`${btn} border border-amber-400/60 text-amber-400 hover:bg-amber-400/10`} disabled={busy} onClick={reset}>
          {busy ? 'Switching…' : "Use the PR's version"}
        </button>
      </div>
    )
  }
  if (entry?.updated) {
    return (
      <div className={`${box} items-center border-add/40 bg-add/10`}>
        <span className="min-w-0 flex-1">Caught up with the PR: {plural(entry.updated, 'new commit')}.</span>
        <button className="shrink-0 text-muted hover:text-fg" onClick={() => (useStore.getState().set({ rightTab: 'review' }), dismissPrUpdated(ws.id))}>
          What changed
        </button>
        <button title="Dismiss" className="text-faint hover:text-fg" onClick={() => dismissPrUpdated(ws.id)}>
          <IconX width={11} height={11} />
        </button>
      </div>
    )
  }
  return null
}

const STATUS: Record<ThreadStatus, [string, string]> = {
  outdated: ['code changed', 'text-add'],
  replied: ['replied', 'text-sky-400'],
  waiting: ['no reply yet', 'text-faint']
}

/**
 * The Review tab when coming back to a PR: what changed since your last review, and the threads you
 * started that are still open, with where each stands.
 */
export function ReviewFollowUp({ ws }: { ws: Workspace }) {
  const review = usePrReview(ws)
  const { mode } = useWorkspaceMode(ws)
  const open = review?.pr.state === 'OPEN'
  const info = review?.info
  // What the author changed in the PR since your review, with the base branch's changes left out.
  const { data: changed } = useSinceReview(ws)
  const [busy, setBusy] = useState<string | null>(null)

  if (!review || !info || !open || mode !== 'review' || !isTheirs(info)) return null
  const threads = myOpenThreads(info)
  const outdated = threads.filter((t) => t.outdated)
  if (!changed?.commits && !threads.length) return null

  const resolve = async (list: PrComment[], key: string) => {
    setBusy(key)
    try {
      for (const t of list) if (t.threadId) await window.api.resolvePrThread(ws.id, t.threadId)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
    }
  }
  const verdict = info.myReview === 'APPROVED' ? 'you approved' : info.myReview === 'CHANGES_REQUESTED' ? 'you requested changes' : 'your review'
  const btn = 'rounded-md border border-line px-2 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40'

  return (
    <div className="mx-3 mt-3 rounded-lg border border-line bg-bg">
      {changed && changed.commits > 0 && (
        <div className="border-b border-line/60 pb-1">
          <div className="px-3 pt-2 pb-1 font-medium">
            Since {verdict}
            <span className="ml-2 font-normal text-muted">
              {plural(changed.commits, 'commit')}, {changed.files.length ? plural(changed.files.length, 'file') : 'no change to the PR itself'}
            </span>
          </div>
          {leftOutLabel(changed, review.pr.baseRefName || 'main') && <div className="px-3 pb-1 text-[12px] text-faint">{leftOutLabel(changed, review.pr.baseRefName || 'main')}</div>}
          {changed.files.map((f) => (
            <button key={f.path} className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-hover" title={f.path} onClick={() => openDoc(ws.id, { kind: 'diff', path: f.path })}>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{f.path}</span>
              <span className="font-mono text-[11px]">
                {f.additions > 0 && <span className="text-add">+{f.additions}</span>}
                {f.deletions > 0 && <span className="ml-1 text-del">-{f.deletions}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {threads.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            <span className="flex-1 font-medium">
              Your open threads <span className="font-normal text-muted">{threads.length}</span>
            </span>
            <button className={`${btn} flex items-center gap-1`} title="The agent reads the current code and says which comments are addressed. It won't push." onClick={() => void sendToAgent(ws, addressedPrompt(threads, review.pr, info.author))}>
              <IconBot width={12} height={12} /> Which are addressed?
            </button>
            {outdated.length > 0 && (
              <button className={btn} disabled={!!busy} title="Resolve the threads whose code has changed. You can unresolve them on GitHub." onClick={() => void resolve(outdated, 'outdated')}>
                {busy === 'outdated' ? 'Resolving…' : `Resolve ${outdated.length} outdated`}
              </button>
            )}
          </div>
          {threads.map((t) => {
            const [label, color] = STATUS[threadStatus(t, info.author)]
            const last = t.replies?.at(-1)
            return (
              <div key={t.id} className="group border-t border-line/60 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <button className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-faint hover:text-fg" onClick={() => t.path && openDoc(ws.id, { kind: 'diff', path: t.path })}>
                    {t.path}
                    {t.line ? `:${t.line}` : ''}
                  </button>
                  <span className={`text-[11px] ${color}`}>{label}</span>
                  <button className="hidden text-[12px] text-muted group-hover:block hover:text-fg disabled:opacity-40" disabled={!!busy || !t.threadId} onClick={() => void resolve([t], t.id)}>
                    {busy === t.id ? 'Resolving…' : 'Resolve'}
                  </button>
                  <button className="hidden text-[12px] text-muted group-hover:block hover:text-fg" onClick={() => void window.api.openExternal(t.url)}>
                    Open
                  </button>
                </div>
                <div className="line-clamp-2 text-[12.5px]">{t.body}</div>
                {last && (
                  <div className="line-clamp-2 border-l-2 border-line pl-2 text-[12px] text-muted">
                    <span className="font-medium">{last.author}:</span> {last.body}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
