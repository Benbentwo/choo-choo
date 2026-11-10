import { useEffect, useMemo, useRef, useState } from 'react'
import type { Workspace } from '@shared/types'
import { useStore, setCodeComments, type CodeComment } from '../store'
import { IconX } from '../icons'
import { useReview } from '../review'
import { pairedSegs } from '../wordDiff'
import { SEVERITY_STYLE, sendFix } from './RightTabs'
import type { ReviewFinding } from '@shared/types'

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

export function DiffView({ ws, file, line }: { ws: Workspace; file: string; line?: number }) {
  const [diff, setDiff] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const stats = useStore((s) => s.stats[ws.id])
  const { findings } = useReview(ws.id)
  const mine = (findings ?? []).filter((f) => f.file === file)
  const queued = useStore((s) => s.codeComments[ws.id]) ?? []
  const queuedHere = queued.filter((c) => c.file === file)
  // Selected rows (indexes into lines) for a new comment: click or drag the line numbers, shift-click to extend.
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    setSel(null)
    setDraft('')
  }, [ws.id, file])
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
  const addComment = () => {
    const text = draft.trim()
    if (!sel || !text) return
    const picked = lines.slice(lo, hi + 1).filter((l) => l.kind !== 'hunk' && l.kind !== 'meta')
    const side: CodeComment['side'] = picked.every((l) => l.kind === 'del') ? 'old' : 'new'
    const nums = picked.map((l) => (side === 'old' ? l.oldNo : l.kind === 'del' ? undefined : l.newNo)).filter((n): n is number => n != null)
    const code = picked.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '} ${l.text}`).join('\n')
    setCodeComments(ws.id, (list) => [...list, { id: crypto.randomUUID(), file, start: Math.min(...nums), end: Math.max(...nums), side, code, text }])
    setSel(null)
    setDraft('')
  }
  /** Queued comments that end on this row. */
  const queuedAt = (l: (typeof lines)[number]) =>
    queuedHere.filter((c) => (c.side === 'old' ? l.kind === 'del' && l.oldNo === c.end : l.kind !== 'del' && l.newNo === c.end))
  // The table is as wide as its longest code line, so a note is sized to the visible width (cqw) and sticks while scrolling sideways.
  const Comment = ({ f }: { f: ReviewFinding }) => (
    <div className="sticky left-0 my-1 mr-4 ml-[6.5rem] w-[calc(100cqw-7.5rem)] max-w-3xl rounded-md border border-line bg-panel px-3 py-2 font-sans">
      <div className="flex items-center gap-2">
        <span className={`text-[11px] font-medium uppercase ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
        <span className="flex-1" />
        <button className="text-[12px] text-muted hover:text-fg" onClick={() => void sendFix(ws, f)}>
          Fix
        </button>
      </div>
      <div className="whitespace-normal">{f.message}</div>
      {f.fix && <div className="mt-1 whitespace-normal text-muted">{f.fix}</div>}
    </div>
  )
  return (
    <div ref={box} className="selectable flex-1 overflow-auto font-mono text-[12px] leading-[20px] [container-type:inline-size]">
      <div className="sticky top-0 z-10 border-b border-line bg-panel px-4 py-2 text-muted">{file}</div>
      {lines.length === 0 && <div className="p-6 font-sans text-faint">No textual changes (binary or empty file).</div>}
      {unplaced.map((f, i) => (
        <Comment key={`u${i}`} f={f} />
      ))}
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
            ...(l.newNo != null && l.kind !== 'del'
              ? mine
                  .filter((f) => f.line === l.newNo)
                  .map((f, j) => (
                    <tr key={`c${i}-${j}`}>
                      <td colSpan={4}>
                        <Comment f={f} />
                      </td>
                    </tr>
                  ))
              : []),
            ...queuedAt(l).map((c) => (
              <tr key={`q${c.id}`}>
                <td colSpan={4}>
                  <div className="sticky left-0 my-1 mr-4 ml-[6.5rem] w-[calc(100cqw-7.5rem)] max-w-3xl flex items-start gap-2 rounded-md border border-accent/40 bg-panel px-3 py-2 font-sans">
                    <span className="flex-1 whitespace-pre-wrap">{c.text}</span>
                    <span className="shrink-0 text-[11px] text-faint">In the chat box</span>
                    <button title="Remove comment" className="shrink-0 text-faint hover:text-fg" onClick={() => setCodeComments(ws.id, (list) => list.filter((x) => x.id !== c.id))}>
                      <IconX width={11} height={11} />
                    </button>
                  </div>
                </td>
              </tr>
            )),
            ...(sel && i === hi && !dragging
              ? [
                  <tr key="new-comment">
                    <td colSpan={4}>
                      <div className="sticky left-0 my-1 mr-4 ml-[6.5rem] w-[calc(100cqw-7.5rem)] max-w-3xl rounded-md border border-line bg-panel p-2 font-sans">
                        <textarea
                          autoFocus
                          rows={2}
                          className="w-full resize-none bg-transparent outline-none placeholder:text-faint"
                          placeholder="Comment on these lines. ⌘↵ to add, Esc to cancel."
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault()
                              addComment()
                            } else if (e.key === 'Escape') {
                              setSel(null)
                              setDraft('')
                            }
                          }}
                        />
                        <div className="flex items-center justify-end gap-2 text-[12px]">
                          <button className="text-muted hover:text-fg" onClick={() => (setSel(null), setDraft(''))}>
                            Cancel
                          </button>
                          <button className="rounded-md bg-fg px-2.5 py-0.5 font-medium text-bg disabled:opacity-40" disabled={!draft.trim()} onClick={addComment}>
                            Add comment
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ]
              : [])
          ])}
        </tbody>
      </table>
    </div>
  )
}
