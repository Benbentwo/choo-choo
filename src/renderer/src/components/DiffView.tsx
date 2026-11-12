import { useEffect, useMemo, useRef, useState } from 'react'
import type { PrComment, Workspace } from '@shared/types'
import { useStore, setCodeComments, destOf, reportError, type CodeComment } from '../store'
import { IconBot, IconGithub, IconX } from '../icons'
import { useReview } from '../review'
import { pairedSegs } from '../wordDiff'
import { usePrDiffTarget, usePrReview, sendToAgent, useWorkspaceMode } from '../prReview'
import { SEVERITY_STYLE, sendFix } from './RightTabs'
import type { ReviewFinding } from '@shared/types'
import { draftProblem, modeDest, threadPrompt, type CommentDest } from '@shared/prReview'

interface Line {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
  text: string
  oldNo?: number
  newNo?: number
}

export function parseDiff(diff: string): Line[] {
  const out: Line[] = []
  let o = 0
  let n = 0
  let inHunk = false
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/)
      o = m ? Number(m[1]) : 0
      n = m ? Number(m[2]) : 0
      inHunk = true
      out.push({ kind: 'hunk', text: raw })
    } else if (!inHunk) {
      continue // file headers
    } else if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), newNo: n++ })
    } else if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), oldNo: o++ })
    } else if (raw.startsWith('\\')) {
      out.push({ kind: 'meta', text: raw })
    } else if (raw.length > 0 || out.length) {
      out.push({ kind: 'ctx', text: raw.slice(1), oldNo: o++, newNo: n++ })
    }
  }
  while (out.length && out[out.length - 1].kind === 'ctx' && out[out.length - 1].text === '') out.pop()
  return out
}

export const DEST_LABEL: Record<CommentDest, string> = { github: 'GitHub review', agent: 'Agent' }
const DEST_STYLE: Record<CommentDest, string> = { github: 'bg-sky-400/15 text-sky-400', agent: 'bg-violet-400/15 text-violet-400' }
const DEST_BUTTON: Record<CommentDest, string> = { github: 'bg-sky-400 text-[#0f1420]', agent: 'bg-violet-400 text-[#16121f]' }
const other = (d: CommentDest): CommentDest => (d === 'github' ? 'agent' : 'github')

export function DestTag({ dest, label }: { dest: CommentDest; label?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] leading-[18px] ${DEST_STYLE[dest]}`}>
      {dest === 'github' ? <IconGithub width={11} height={11} /> : <IconBot width={11} height={11} />}
      {label ?? (dest === 'github' ? 'In your GitHub review' : 'Queued for the agent')}
    </span>
  )
}

export function DiffView({ ws, file, line }: { ws: Workspace; file: string; line?: number }) {
  const [diff, setDiff] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const stats = useStore((s) => s.stats[ws.id])
  const { findings } = useReview(ws.id)
  const mine = (findings ?? []).filter((f) => f.file === file)
  const queued = useStore((s) => s.codeComments[ws.id]) ?? []
  const queuedHere = queued.filter((c) => c.file === file)
  const review = usePrReview(ws)
  const open = review?.pr.state === 'OPEN'
  const { mode } = useWorkspaceMode(ws)
  // Reviewing: comments default to your GitHub review and the agent only advises. Follows the header's Build/Review switch.
  const theirs = open && mode === 'review'
  const fallback = modeDest(mode, review?.pr)
  const target = usePrDiffTarget(ws, open)
  const threads = open ? (review?.info.feedback ?? []).filter((c) => c.kind === 'inline' && c.path === file) : []
  // Selected rows (indexes into lines) for a new comment: click or drag the line numbers, shift-click to extend.
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [dest, setDest] = useState<CommentDest>(fallback)
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  useEffect(() => {
    setSel(null)
    setDraft('')
  }, [ws.id, file])
  // A new selection starts on the default for this PR: GitHub on someone else's, the agent on yours.
  useEffect(() => setDest(fallback), [sel?.a, fallback])
  useEffect(() => {
    const up = () => setDragging(false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  useEffect(() => {
    setDiff(null)
    void window.api.getFileDiff(ws.id, file).then(setDiff, (e) => setDiff(`error: ${e}`))
  }, [ws.id, file, stats])

  // Opened at a line (from a review finding): bring that row into view once the diff is in.
  useEffect(() => {
    if (!line || diff === null) return
    box.current?.querySelector(`[data-new-line="${line}"]`)?.scrollIntoView({ block: 'center' })
  }, [line, diff, file])

  const lines = useMemo(() => (diff === null ? [] : parseDiff(diff)), [diff])
  // The words that changed within an edited line, as GitHub shades them.
  const words = useMemo(() => pairedSegs(lines), [lines])
  if (diff === null) return <div className="flex-1 p-6 text-faint">Loading diff…</div>
  const shownLines = new Set(lines.map((l) => l.newNo).filter((n): n is number => n != null))
  const unplaced = mine.filter((f) => !f.line || !shownLines.has(f.line))
  // Thread lines are the PR head's. Outdated threads point at code that's gone, and a worktree behind the
  // PR has other line numbers, so those go above the diff instead of on a line that isn't theirs.
  const placeable = threads.filter((t) => !t.outdated && (target?.headMatches ?? true))
  const threadAt = (l: Line) => placeable.filter((t) => (t.side === 'old' ? l.kind === 'del' && l.oldNo === t.line : l.kind !== 'del' && l.newNo === t.line))
  const placedThreads = new Set(lines.flatMap((l) => threadAt(l)))
  const unplacedThreads = threads.filter((t) => !placedThreads.has(t) && !t.outdated)
  const outdatedThreads = threads.filter((t) => t.outdated)
  const numbered = (i: number) => lines[i] && (lines[i].kind === 'add' || lines[i].kind === 'del' || lines[i].kind === 'ctx')
  const lo = sel ? Math.min(sel.a, sel.b) : -1
  const hi = sel ? Math.max(sel.a, sel.b) : -1
  const pick = (i: number, e: React.MouseEvent) => {
    if (!numbered(i)) return
    e.preventDefault()
    if (e.shiftKey && sel) setSel({ a: sel.a, b: i })
    else setSel({ a: i, b: i })
    setDragging(true)
  }
  const extend = (i: number) => {
    if (dragging && sel && numbered(i)) setSel({ a: sel.a, b: i })
  }
  /** The comment the selection would make, without its text. */
  const selection = (): Omit<CodeComment, 'id' | 'text'> | null => {
    if (!sel) return null
    const picked = lines.slice(lo, hi + 1).filter((l) => l.kind !== 'hunk' && l.kind !== 'meta')
    const side: CodeComment['side'] = picked.every((l) => l.kind === 'del') ? 'old' : 'new'
    const nums = picked.map((l) => (side === 'old' ? l.oldNo : l.kind === 'del' ? undefined : l.newNo)).filter((n): n is number => n != null)
    if (!nums.length) return null
    const code = picked.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '} ${l.text}`).join('\n')
    return { file, start: Math.min(...nums), end: Math.max(...nums), side, code }
  }
  const pending = selection()
  const githubProblem = pending && open ? draftProblem({ ...pending, text: '' }, target) : open ? null : 'This workspace has no open PR.'
  const addComment = (to: CommentDest) => {
    const text = draft.trim()
    if (!pending || !text) return
    if (to === 'github' && githubProblem) return
    setCodeComments(ws.id, (list) => [...list, { id: crypto.randomUUID(), ...pending, text, dest: to, commit: target?.head }])
    setSel(null)
    setDraft('')
  }
  const addFinding = (f: ReviewFinding) => {
    if (!f.line) return
    const l = lines.find((x) => x.kind !== 'del' && x.newNo === f.line)
    const text = f.fix ? `${f.message}\n\n${f.fix}` : f.message
    setCodeComments(ws.id, (list) => [...list, { id: crypto.randomUUID(), file, start: f.line!, end: f.line!, side: 'new', code: l ? `${l.kind === 'add' ? '+' : ' '} ${l.text}` : '', text, dest: 'github', fromFinding: true, commit: target?.head }])
  }
  const findingAdded = (f: ReviewFinding) => queuedHere.some((c) => c.fromFinding && c.start === f.line && c.text.startsWith(f.message))
  /** Queued comments that end on this row. */
  const queuedAt = (l: Line) => queuedHere.filter((c) => (c.side === 'old' ? l.kind === 'del' && l.oldNo === c.end : l.kind !== 'del' && l.newNo === c.end))
  const btn = 'rounded-md border border-line px-2 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40'
  const Comment = ({ f }: { f: ReviewFinding }) => {
    const problem = f.line ? draftProblem({ file, start: f.line, end: f.line, side: 'new', text: '' }, target) : 'This finding has no line.'
    const added = findingAdded(f)
    const toReview = (
      <button className={theirs ? `rounded-md px-2 py-0.5 text-[12px] font-medium disabled:opacity-40 ${DEST_BUTTON.github}` : btn} disabled={!!problem || added} title={problem ?? 'Add this finding to your GitHub review as a draft you can edit'} onClick={() => addFinding(f)}>
        {added ? 'In your review' : theirs ? 'Add to my review' : 'Add to GitHub review'}
      </button>
    )
    return (
      <div className="sticky left-0 my-1 mr-4 ml-[6.5rem] w-[calc(100cqw-7.5rem)] max-w-3xl rounded-md border border-line bg-panel px-3 py-2 font-sans">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-medium uppercase ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
          <span className="text-[11px] text-faint">Reviewer agent</span>
          <span className="flex-1" />
          {open && toReview}
          {!theirs && (
            <button className={`rounded-md px-2 py-0.5 text-[12px] font-medium ${DEST_BUTTON.agent}`} onClick={() => void sendFix(ws, f)}>
              Fix
            </button>
          )}
        </div>
        <div className="whitespace-normal">{f.message}</div>
        {f.fix && <div className="mt-1 whitespace-normal text-muted">{f.fix}</div>}
      </div>
    )
  }
  // Called as a function, not <Queued />, so the edit box keeps focus across renders.
  const queuedBox = (c: CodeComment) => {
    const d = destOf(c)
    const problem = d === 'agent' ? draftProblem(c, target) : null
    const isEditing = editing?.id === c.id
    return (
      <div className="sticky left-0 my-1 mr-4 ml-[6.5rem] w-[calc(100cqw-7.5rem)] max-w-3xl rounded-md border border-accent/40 bg-panel px-3 py-2 font-sans">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[12px] font-medium">You</span>
          <DestTag dest={d} label={d === 'github' ? 'Pending in your GitHub review' : undefined} />
          {c.stale && (
            <span className="text-[11px] text-amber-400" title="New commits changed the lines this comment is on. Check it still applies.">
              code changed
            </span>
          )}
          <span className="flex-1" />
          {c.stale && (
            <button className="text-[12px] text-amber-400 hover:text-fg" title="It still applies: post it on these lines" onClick={() => setCodeComments(ws.id, (list) => list.map((x) => (x.id === c.id ? { ...x, stale: false } : x)))}>
              Keep
            </button>
          )}
          {!isEditing && (
            <button className="text-[12px] text-faint hover:text-fg" onClick={() => setEditing({ id: c.id, text: c.text })}>
              Edit
            </button>
          )}
          <button
            className="text-[12px] text-faint hover:text-fg disabled:opacity-40"
            disabled={!!problem || (d === 'agent' && !open)}
            title={problem ?? undefined}
            onClick={() => setCodeComments(ws.id, (list) => list.map((x) => (x.id === c.id ? { ...x, dest: other(d) } : x)))}
          >
            Move to {d === 'github' ? 'agent' : 'GitHub review'}
          </button>
          <button title="Remove comment" className="text-faint hover:text-fg" onClick={() => setCodeComments(ws.id, (list) => list.filter((x) => x.id !== c.id))}>
            <IconX width={11} height={11} />
          </button>
        </div>
        {isEditing ? (
          <div>
            <textarea
              autoFocus
              rows={2}
              className="w-full resize-none rounded border border-line bg-bg px-2 py-1 outline-none"
              value={editing.text}
              onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(null)
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && editing.text.trim()) {
                  setCodeComments(ws.id, (list) => list.map((x) => (x.id === c.id ? { ...x, text: editing.text.trim() } : x)))
                  setEditing(null)
                }
              }}
            />
            <div className="flex justify-end gap-2 text-[12px]">
              <button className="text-muted hover:text-fg" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                className="rounded-md bg-fg px-2 py-0.5 font-medium text-bg disabled:opacity-40"
                disabled={!editing.text.trim()}
                onClick={() => {
                  setCodeComments(ws.id, (list) => list.map((x) => (x.id === c.id ? { ...x, text: editing.text.trim() } : x)))
                  setEditing(null)
                }}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{c.text}</div>
        )}
      </div>
    )
  }
  const row = (key: string, child: React.ReactNode) => (
    <tr key={key}>
      <td colSpan={4}>{child}</td>
    </tr>
  )
  const composer = (
    <div className="sticky left-0 my-1 mr-4 ml-[6.5rem] w-[calc(100cqw-7.5rem)] max-w-3xl rounded-md border border-accent bg-panel font-sans">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] text-muted">
        <span>
          Comment on {pending ? (pending.start === pending.end ? `line ${pending.start}` : `lines ${pending.start}–${pending.end}`) : 'these lines'}
        </span>
        <span className="flex-1" />
        <span className="text-faint">Send to</span>
        <span className="flex overflow-hidden rounded-md border border-line">
          {(['github', 'agent'] as const).map((d) => (
            <button
              key={d}
              disabled={d === 'github' && !!githubProblem}
              title={d === 'github' ? (githubProblem ?? 'Add to your GitHub review, posted when you submit it') : 'Queue for the agent, sent with your next chat message'}
              className={`flex items-center gap-1 px-2 py-0.5 disabled:opacity-40 ${dest === d ? DEST_STYLE[d] : 'hover:bg-hover'}`}
              onClick={() => setDest(d)}
            >
              {d === 'github' ? <IconGithub width={11} height={11} /> : <IconBot width={11} height={11} />}
              {DEST_LABEL[d]}
            </button>
          ))}
        </span>
      </div>
      <div className="p-2">
        <textarea
          autoFocus
          rows={2}
          className="w-full resize-none rounded border border-line bg-bg px-2 py-1 outline-none placeholder:text-faint"
          placeholder={dest === 'github' ? 'Comment for the PR author. ⌘↵ to add to your review.' : 'Comment for the agent. ⌘↵ to queue it.'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              addComment(e.shiftKey ? other(dest) : dest)
            } else if (e.key === 'Escape') {
              setSel(null)
              setDraft('')
            }
          }}
        />
        <div className="mt-1 flex items-center gap-2 text-[12px]">
          {[dest, other(dest)].map((d, i) => (
            <button
              key={d}
              disabled={!draft.trim() || (d === 'github' && !!githubProblem)}
              title={d === 'github' ? (githubProblem ?? undefined) : undefined}
              className={i === 0 ? `rounded-md px-2.5 py-0.5 font-medium disabled:opacity-40 ${DEST_BUTTON[d]}` : btn}
              onClick={() => addComment(d)}
            >
              {d === 'github' ? 'Add to review' : 'Queue for agent'} <span className="opacity-60">{i === 0 ? '⌘↵' : '⌘⇧↵'}</span>
            </button>
          ))}
          <button className="text-muted hover:text-fg" onClick={() => (setSel(null), setDraft(''))}>
            Cancel
          </button>
          <span className="flex-1" />
          <span className="truncate text-faint">
            {dest === 'github' && githubProblem ? githubProblem : theirs ? 'Default here: GitHub, since you are reviewing' : 'Default here: the agent, since you are building'}
          </span>
        </div>
      </div>
    </div>
  )
  return (
    <div ref={box} className="selectable flex-1 overflow-auto font-mono text-[12px] leading-[20px] [container-type:inline-size]">
      <div className="sticky top-0 z-10 border-b border-line bg-panel px-4 py-2 text-muted">{file}</div>
      {lines.length === 0 && <div className="p-6 font-sans text-faint">No textual changes (binary or empty file).</div>}
      {unplaced.map((f, i) => (
        <Comment key={`u${i}`} f={f} />
      ))}
      {review && unplacedThreads.map((t) => <Thread key={t.id} ws={ws} c={t} pr={review.pr} theirs={theirs} />)}
      {review && outdatedThreads.length > 0 && (
        <details className="mx-4 my-1 font-sans">
          <summary className="cursor-pointer text-[12px] text-faint hover:text-fg">
            {outdatedThreads.length} outdated thread{outdatedThreads.length === 1 ? '' : 's'}: the code {outdatedThreads.length === 1 ? 'it was' : 'they were'} on has changed
          </summary>
          {outdatedThreads.map((t) => (
            <Thread key={t.id} ws={ws} c={t} pr={review.pr} theirs={theirs} />
          ))}
        </details>
      )}
      <table className="w-full border-collapse">
        <tbody>
          {lines.flatMap((l, i) => [
            <tr
              key={i}
              data-new-line={l.kind !== 'del' ? (l.newNo ?? undefined) : undefined}
              onMouseEnter={() => extend(i)}
              className={
                i >= lo && i <= hi
                  ? 'bg-accent/20'
                  : l.kind === 'add' ? 'bg-add/10' : l.kind === 'del' ? 'bg-del/10' : l.kind === 'hunk' ? 'bg-raised text-faint' : ''
              }
            >
              <td className={`w-12 pr-2 text-right text-faint select-none ${numbered(i) ? 'cursor-pointer hover:text-fg' : ''}`} onMouseDown={(e) => pick(i, e)} title={numbered(i) ? 'Comment on this line. Drag or shift-click for several.' : undefined}>
                {l.oldNo ?? ''}
              </td>
              <td className={`w-12 pr-2 text-right text-faint select-none ${numbered(i) ? 'cursor-pointer hover:text-fg' : ''}`} onMouseDown={(e) => pick(i, e)} title={numbered(i) ? 'Comment on this line. Drag or shift-click for several.' : undefined}>
                {l.newNo ?? ''}
              </td>
              <td className={`w-4 select-none ${l.kind === 'add' ? 'text-add' : l.kind === 'del' ? 'text-del' : 'text-faint'}`}>
                {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ''}
              </td>
              <td className="pr-4 whitespace-pre">
                {words.get(i)?.map((w, k) =>
                  w.changed ? (
                    <span key={k} className={`rounded-[3px] ${l.kind === 'add' ? 'bg-add/35' : 'bg-del/35'}`}>
                      {w.text}
                    </span>
                  ) : (
                    w.text
                  )
                ) ?? l.text}
              </td>
            </tr>,
            ...(l.newNo != null && l.kind !== 'del' ? mine.filter((f) => f.line === l.newNo).map((f, j) => row(`c${i}-${j}`, <Comment f={f} />)) : []),
            ...(review ? threadAt(l).map((t) => row(`t${t.id}`, <Thread ws={ws} c={t} pr={review.pr} theirs={theirs} />)) : []),
            ...queuedAt(l).map((c) => row(`q${c.id}`, queuedBox(c))),
            ...(sel && i === hi && !dragging ? [row('new-comment', composer)] : [])
          ])}
        </tbody>
      </table>
    </div>
  )
}

/** A review thread from GitHub, shown on its line with Reply, Resolve and Ask agent. */
function Thread({ ws, c, pr, theirs }: { ws: Workspace; c: PrComment; pr: { number: number; url: string }; theirs: boolean }) {
  const [reply, setReply] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const btn = 'rounded-md border border-line px-2 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40'
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  const sendReply = () =>
    run(async () => {
      if (!c.threadId || !reply?.trim()) return
      await window.api.replyToPrThread(ws.id, c.threadId, reply.trim())
      setReply(null)
    })
  return (
    <div className="sticky left-0 my-1 mr-4 ml-[6.5rem] w-[calc(100cqw-7.5rem)] max-w-3xl rounded-md border border-line bg-panel px-3 py-2 font-sans">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[12px] font-medium">{c.author}</span>
        <DestTag dest="github" label="GitHub thread" />
        {c.outdated && <span className="text-[11px] text-faint">outdated</span>}
        <span className="flex-1" />
        <button className="text-[12px] text-faint hover:text-fg" onClick={() => void window.api.openExternal(c.url)}>
          Open on GitHub
        </button>
      </div>
      {c.outdated && c.diffHunk && (
        <pre className="mb-1.5 overflow-x-auto rounded border border-line/60 bg-bg px-2 py-1 font-mono text-[11px] leading-[16px] text-faint" title="The code when this was written">
          {c.diffHunk.split('\n').slice(-4).join('\n')}
        </pre>
      )}
      <div className="whitespace-pre-wrap">{c.body}</div>
      {(c.replies ?? []).map((r, i) => (
        <div key={i} className="mt-1.5 border-l-2 border-line pl-2">
          <span className="text-[12px] font-medium">{r.author}</span>
          <div className="whitespace-pre-wrap">{r.body}</div>
        </div>
      ))}
      {reply !== null ? (
        <div className="mt-2">
          <textarea
            autoFocus
            rows={2}
            className="w-full resize-none rounded border border-line bg-bg px-2 py-1 outline-none placeholder:text-faint"
            placeholder="Reply on GitHub. ⌘↵ to post."
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setReply(null)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendReply()
            }}
          />
          <div className="flex justify-end gap-2 text-[12px]">
            <button className="text-muted hover:text-fg" onClick={() => setReply(null)}>
              Cancel
            </button>
            <button className={`rounded-md px-2 py-0.5 font-medium disabled:opacity-40 ${DEST_BUTTON.github}`} disabled={busy || !reply.trim()} onClick={() => void sendReply()}>
              {busy ? 'Posting…' : 'Reply'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button className={btn} disabled={!c.threadId} onClick={() => setReply('')}>
            Reply
          </button>
          <button className={btn} disabled={busy || !c.threadId} onClick={() => void run(() => window.api.resolvePrThread(ws.id, c.threadId!))}>
            Resolve
          </button>
          <button className={`${btn} flex items-center gap-1`} onClick={() => void sendToAgent(ws, threadPrompt(c, pr, theirs))}>
            <IconBot width={12} height={12} /> Ask agent
          </button>
        </div>
      )}
    </div>
  )
}
