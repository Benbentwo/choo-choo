import { useState } from 'react'
import type { Workspace } from '@shared/types'
import { draftProblem, isTheirs, type ReviewEvent } from '@shared/prReview'
import { useStore, openDoc, setCodeComments, destOf, codeCommentsMessage, reviewTarget, reportError, type CodeComment } from '../store'
import { usePrDiffTarget, usePrReview, sendToAgent } from '../prReview'
import { IconBot, IconGithub, IconX } from '../icons'

const EVENTS: { id: ReviewEvent; label: string; theirsOnly?: boolean }[] = [
  { id: 'COMMENT', label: 'Comment' },
  { id: 'APPROVE', label: 'Approve', theirsOnly: true },
  { id: 'REQUEST_CHANGES', label: 'Request changes', theirsOnly: true }
]

const where = (c: CodeComment) => `${c.file.split('/').pop()}:${c.start === c.end ? c.start : `${c.start}-${c.end}`}`

/** The top of the Review tab: the person's GitHub review drafts and the comments queued for the agent. */
export function ReviewDrafts({ ws }: { ws: Workspace }) {
  const all = useStore((s) => s.codeComments[ws.id]) ?? []
  const review = usePrReview(ws)
  const open = review?.pr.state === 'OPEN'
  const theirs = open && isTheirs(review?.info)
  const github = all.filter((c) => destOf(c) === 'github')
  const agent = all.filter((c) => destOf(c) === 'agent')
  const target = usePrDiffTarget(ws, open && github.length > 0)
  const [body, setBody] = useState('')
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [busy, setBusy] = useState(false)
  const [posted, setPosted] = useState<string | null>(null)
  const problems = new Map(github.map((c) => [c.id, draftProblem(c, target)] as const))
  const blocked = github.some((c) => problems.get(c.id))
  const needsText = event !== 'APPROVE' && !github.length && !body.trim()

  const submit = async () => {
    setBusy(true)
    try {
      const r = await window.api.submitPrReview(ws.id, github, body, event)
      setCodeComments(ws.id, (list) => list.filter((c) => destOf(c) !== 'github'))
      setBody('')
      setEvent('COMMENT')
      setPosted(r.url || review?.pr.url || '')
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  const sendAgent = async () => {
    await sendToAgent(ws, codeCommentsMessage(agent, '', reviewTarget(review)))
    setCodeComments(ws.id, (list) => list.filter((c) => destOf(c) !== 'agent'))
  }
  const remove = (id: string) => setCodeComments(ws.id, (list) => list.filter((x) => x.id !== id))
  const item = (c: CodeComment, i: number) => (
    <div key={c.id} className="group flex items-start gap-2 border-t border-line/60 px-3 py-2">
      <span className="mt-0.5 w-4 shrink-0 text-right text-[11px] text-faint">{i + 1}</span>
      <button className="min-w-0 flex-1 text-left" onClick={() => openDoc(ws.id, { kind: 'diff', path: c.file })}>
        <div className="font-mono text-[11px] text-faint">
          {where(c)}
          {c.fromFinding ? ' · from agent finding' : ''}
        </div>
        <div className="line-clamp-2">{c.text}</div>
        {problems.get(c.id) && destOf(c) === 'github' && <div className="mt-0.5 text-[11.5px] text-amber-400">{problems.get(c.id)}</div>}
      </button>
      <button title="Remove comment" className="mt-0.5 hidden text-faint group-hover:block hover:text-fg" onClick={() => remove(c.id)}>
        <IconX width={11} height={11} />
      </button>
    </div>
  )

  const showGithub = open && (theirs || github.length > 0)
  if (!showGithub && !agent.length && !posted) return null
  return (
    <div className="flex flex-col gap-3 px-3 pt-3 pb-1">
      {posted !== null && (
        <div className="flex items-center gap-2 rounded-lg border border-add/40 bg-add/10 px-3 py-2 text-[12.5px]">
          <span className="flex-1">Review posted to GitHub.</span>
          {posted && (
            <button className="text-muted hover:text-fg" onClick={() => void window.api.openExternal(posted)}>
              Open
            </button>
          )}
          <button title="Dismiss" className="text-faint hover:text-fg" onClick={() => setPosted(null)}>
            <IconX width={11} height={11} />
          </button>
        </div>
      )}
      {showGithub && (
        <div className="rounded-lg border border-line bg-bg">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 font-medium">
            <IconGithub /> Your GitHub review
            <span className="ml-auto rounded-full bg-raised px-2 text-[11px] font-normal text-muted">{github.length ? 'drafts, not posted yet' : 'empty'}</span>
          </div>
          {github.length === 0 && <div className="px-3 py-2 text-[12.5px] text-faint">Click a line number in a diff to comment. Comments stay here as drafts until you submit.</div>}
          {github.map(item)}
          <div className="border-t border-line/60 px-3 pt-2">
            <textarea
              rows={2}
              className="w-full resize-none rounded-md border border-line bg-panel px-2 py-1.5 outline-none placeholder:text-faint"
              placeholder="Summary (optional)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 px-3 py-1.5">
            {EVENTS.filter((e) => theirs || !e.theirsOnly).map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                <input type="radio" name={`review-event-${ws.id}`} className="accent-sky-400" checked={event === e.id} onChange={() => setEvent(e.id)} />
                {e.label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 pt-1 pb-3">
            <button
              className="rounded-md bg-sky-400 px-2.5 py-1 text-[12.5px] font-medium text-[#0f1420] disabled:opacity-40"
              disabled={busy || blocked || needsText || (github.length > 0 && !target)}
              title={blocked ? 'Fix or move the comments marked above first' : needsText ? 'Add a comment or a summary' : undefined}
              onClick={() => void submit()}
            >
              {busy ? 'Submitting…' : 'Submit review to GitHub'}
            </button>
            {github.length > 0 && (
              <button className="rounded-md border border-line px-2.5 py-1 text-[12.5px] text-muted hover:bg-hover" onClick={() => setCodeComments(ws.id, (list) => list.filter((c) => destOf(c) !== 'github'))}>
                Discard
              </button>
            )}
          </div>
        </div>
      )}
      {agent.length > 0 && (
        <div className="rounded-lg border border-line bg-bg">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 font-medium">
            <IconBot /> Queued for the agent
            <span className="ml-auto rounded-full bg-violet-400/15 px-2 text-[11px] font-normal text-violet-400">{agent.length}</span>
          </div>
          {agent.map(item)}
          <div className="flex items-center gap-2 px-3 pt-1 pb-3">
            <button className="rounded-md bg-violet-400 px-2.5 py-1 text-[12.5px] font-medium text-[#16121f]" onClick={() => void sendAgent()}>
              Send to agent
            </button>
            <span className="text-[12px] text-faint">{theirs ? 'It answers and suggests changes; it won\'t push.' : 'or press ↵ in the chat'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
