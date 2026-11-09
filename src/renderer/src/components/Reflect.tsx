import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PrInfo, Workspace } from '@shared/types'
import { isExecutableTarget, lineDiff, type ReflectProposal, type ReflectResult } from '@shared/reflect'
import { useStore, refreshState, reportError } from '../store'

const dismissKey = (wsId: string) => `choo:merged-dismissed:${wsId}`

/** Archives a workspace and leaves it if it's the one on screen. */
export async function archiveAndLeave(wsId: string) {
  try {
    await window.api.archiveWorkspace(wsId)
    await refreshState()
    if (useStore.getState().selectedWs === wsId) useStore.getState().selectWorkspace(null)
  } catch (e) {
    reportError(e)
  }
}

/**
 * Top-right actions once the workspace's PR merges, like Conductor: Continue keeps working,
 * Archive asks how the session went and can reflect on it before archiving.
 */
export function MergedActions({ ws }: { ws: Workspace }) {
  const stats = useStore((s) => s.stats[ws.id])
  const prVersion = useStore((s) => s.prVersion[ws.id] ?? 0)
  const [pr, setPr] = useState<PrInfo | null>(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey(ws.id)))
  const [archiving, setArchiving] = useState(false)

  useEffect(() => {
    let live = true
    setDismissed(localStorage.getItem(dismissKey(ws.id)))
    const load = () => void window.api.getPr(ws.id).then((p) => live && setPr(p), () => {})
    load()
    return () => {
      live = false
    }
  }, [ws.id, stats, prVersion])

  if (!pr || pr.state !== 'MERGED' || ws.orchestrator) return null
  const showContinue = dismissed !== String(pr.number)

  return (
    <>
      {showContinue && (
        <button
          className="no-drag rounded-md border border-dashed border-line px-2.5 py-1 text-muted hover:bg-hover hover:text-fg"
          onClick={() => {
            localStorage.setItem(dismissKey(ws.id), String(pr.number))
            setDismissed(String(pr.number))
          }}
          title="Keep working in this workspace"
        >
          Continue
        </button>
      )}
      <button
        className="no-drag rounded-md bg-violet-500 px-2.5 py-1 font-medium text-white hover:bg-violet-400"
        onClick={() => setArchiving(true)}
        title="Archive this workspace"
      >
        Archive
      </button>
      {archiving && <SessionFeedback ws={ws} archive onClose={() => setArchiving(false)} />}
    </>
  )
}

const MOODS = [
  { id: 'smooth', label: 'Smooth' },
  { id: 'some', label: 'Some friction' },
  { id: 'painful', label: 'Painful' }
] as const

/**
 * Asks how the session went before archiving. The answer steers the reflect agent toward what
 * actually hurt; skipping it just archives.
 */
export function SessionFeedback({ ws, archive, onClose }: { ws: Workspace; archive: boolean; onClose: () => void }) {
  const [mood, setMood] = useState<(typeof MOODS)[number]['id'] | null>(null)
  const [text, setText] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (feedback !== null) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [feedback, busy, onClose])

  if (feedback !== null) return <ReflectModal ws={ws} feedback={feedback} archiveAfter={archive} onClose={onClose} onArchive={() => archiveAndLeave(ws.id)} />

  const reflect = () => {
    const m = MOODS.find((x) => x.id === mood)
    setFeedback([m ? `Overall: ${m.label}.` : '', text.trim()].filter(Boolean).join('\n'))
  }
  const justArchive = async () => {
    setBusy(true)
    await archiveAndLeave(ws.id)
    onClose()
  }

  return (
    <Overlay onMouseDown={() => !busy && onClose()} top="pt-[12vh]">
      <div className="anim-pop w-[560px] max-w-[92vw] rounded-xl border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="border-b border-line px-5 py-3">
          <div className="font-medium">How did this session go?</div>
          <div className="mt-0.5 text-[12px] text-faint">
            Tell us what was painful. A reflection agent uses it, with the conversation, to suggest changes to CLAUDE.md, rules, skills and hooks so the next session goes smoother. You review every change.
          </div>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="flex gap-2">
            {MOODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMood(mood === m.id ? null : m.id)}
                className={`rounded-full border px-3 py-1 ${mood === m.id ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted hover:bg-hover hover:text-fg'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reflect()}
            placeholder="What did you have to correct, repeat or explain? What did the agent get wrong about this repo?"
            className="selectable block h-32 w-full resize-y rounded-md border border-line bg-bg px-3 py-2 outline-none focus:border-faint"
          />
        </div>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button className="rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-fg" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <div className="flex-1" />
          {archive && (
            <button className="rounded-md border border-line px-3 py-1.5 hover:bg-hover disabled:opacity-40" disabled={busy} onClick={() => void justArchive()}>
              {busy ? 'Archiving…' : 'Skip and archive'}
            </button>
          )}
          <button className="rounded-md border border-accent/40 bg-accent/15 px-3 py-1.5 text-accent hover:bg-accent/25 disabled:opacity-40" disabled={busy} onClick={reflect} title="⌘↵">
            {archive ? 'Reflect and archive' : 'Reflect'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

interface Draft extends ReflectProposal {
  accepted: boolean
  editing: boolean
}

/** Runs the reflect agent and lets the user accept, edit or reject each suggested change. */
export function ReflectModal({ ws, feedback = '', archiveAfter, onClose, onArchive }: { ws: Workspace; feedback?: string; archiveAfter: boolean; onClose: () => void; onArchive: () => Promise<void> }) {
  const [result, setResult] = useState<ReflectResult | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setResult(null)
    setError(null)
    window.api.reflect(ws.id, feedback).then(
      (r) => {
        if (!live) return
        setResult(r)
        setDrafts(r.proposals.map((p) => ({ ...p, accepted: !isExecutableTarget(p.file), editing: false })))
      },
      (e) => live && setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    )
    return () => {
      live = false
    }
  }, [ws.id, attempt])

  const cancel = () => {
    if (!result && !error) void window.api.cancelReflect(ws.id)
    onClose()
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !applying && cancel()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const patch = (id: string, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d)))
  const accepted = drafts.filter((d) => d.accepted)

  const finish = async (apply: boolean) => {
    setApplying(true)
    try {
      let next: { workspace: Workspace; chat: { id: string } } | null = null
      if (apply && accepted.length) next = await window.api.applyReflection(ws.id, accepted.map(({ accepted: _a, editing: _e, ...p }) => p))
      if (archiveAfter) await onArchive()
      await refreshState()
      if (next) {
        const s = useStore.getState()
        s.selectWorkspace(next.workspace.id)
        s.setActiveChat(next.workspace.id, next.chat.id)
      }
      onClose()
    } catch (e) {
      reportError(e)
      setApplying(false)
    }
  }

  const done = archiveAfter ? 'Archive' : 'Close'
  return (
    <Overlay onMouseDown={() => !applying && cancel()} top="pt-[8vh]">
      <div className="anim-pop flex max-h-[84vh] w-[860px] max-w-[94vw] flex-col rounded-xl border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="border-b border-line px-5 py-3">
          <div className="font-medium">Reflect on this session</div>
          <div className="mt-0.5 text-[12px] text-faint">
            An agent reads the conversation for friction and suggests changes to CLAUDE.md, rules, skills and hooks. Nothing changes until you accept: accepted changes go to a new workspace that opens a PR.
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="text-del">{error}</div>
          ) : !result ? (
            <div className="flex items-center gap-2 text-muted">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" /> Reading the session and the repo's agent setup…
            </div>
          ) : (
            <>
              {result.summary && <p className="mb-4 text-muted">{result.summary}</p>}
              {drafts.length === 0 && <div className="text-faint">No changes suggested. The setup held up in this session.</div>}
              <div className="space-y-3">
                {drafts.map((d) => (
                  <ProposalCard key={d.id} d={d} onChange={(p) => patch(d.id, p)} />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          {error && (
            <button className="rounded-md border border-line px-3 py-1.5 hover:bg-hover" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          )}
          <div className="flex-1" />
          <button className="rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-fg" disabled={applying} onClick={cancel}>
            Cancel
          </button>
          {(result || error) && (
            <button className="rounded-md border border-line px-3 py-1.5 hover:bg-hover disabled:opacity-40" disabled={applying} onClick={() => void finish(false)}>
              {drafts.length ? `${done} without changes` : done}
            </button>
          )}
          {result && drafts.length > 0 && (
            <button
              className="rounded-md border border-accent/40 bg-accent/15 px-3 py-1.5 text-accent hover:bg-accent/25 disabled:opacity-40"
              disabled={applying || accepted.length === 0}
              onClick={() => void finish(true)}
            >
              {applying ? 'Working…' : `Open PR with ${accepted.length} change${accepted.length === 1 ? '' : 's'}${archiveAfter ? ' and archive' : ''}`}
            </button>
          )}
        </div>
      </div>
    </Overlay>
  )
}

function ProposalCard({ d, onChange }: { d: Draft; onChange: (p: Partial<Draft>) => void }) {
  const lines = lineDiff(d.before, d.after)
  // Show changed lines with three lines of context around them.
  const keep = lines.map((l, i) => l.kind !== 'ctx' || lines.slice(Math.max(0, i - 3), i + 4).some((x) => x.kind !== 'ctx'))
  return (
    <div className={`rounded-lg border ${d.accepted ? 'border-line' : 'border-line opacity-60'}`}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <input type="checkbox" className="mt-1" checked={d.accepted} onChange={(e) => onChange({ accepted: e.target.checked })} aria-label={`Accept ${d.title}`} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{d.title}</div>
          {d.why && <div className="mt-0.5 text-[12px] text-muted">{d.why}</div>}
          <div className="mt-1 font-mono text-[11px] text-faint">
            {d.file}
            {d.before === null && <span className="ml-2 rounded bg-add/15 px-1 text-add">new file</span>}
          </div>
          {isExecutableTarget(d.file) && (
            <div className="mt-1.5 rounded bg-del/10 px-2 py-1 text-[12px] text-del">This file runs commands. Read every line before accepting; it's unchecked by default.</div>
          )}
        </div>
        <button className="rounded px-2 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg" onClick={() => onChange({ editing: !d.editing, accepted: true })}>
          {d.editing ? 'Show diff' : 'Edit'}
        </button>
      </div>
      {d.editing ? (
        <textarea
          className="selectable block h-72 w-full resize-y border-t border-line bg-bg px-3 py-2 font-mono text-[12px] leading-[19px] outline-none"
          value={d.after}
          spellCheck={false}
          onChange={(e) => onChange({ after: e.target.value })}
        />
      ) : (
        <div className="selectable max-h-72 overflow-auto border-t border-line font-mono text-[12px] leading-[19px]">
          {lines.map((l, i) =>
            keep[i] ? (
              <div key={i} className={`flex px-3 ${l.kind === 'add' ? 'bg-add/10' : l.kind === 'del' ? 'bg-del/10' : ''}`}>
                <span className={`mr-2 w-3 shrink-0 select-none ${l.kind === 'add' ? 'text-add' : l.kind === 'del' ? 'text-del' : 'text-faint'}`}>
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ''}
                </span>
                <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{l.text}</span>
              </div>
            ) : i > 0 && keep[i - 1] ? (
              <div key={i} className="bg-raised px-3 text-faint select-none">
                ⋯
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Full-window backdrop rendered at the document root. The Archive button lives in the draggable
 * title bar, and anything rendered inside a drag region can't be clicked in Electron.
 */
function Overlay({ children, onMouseDown, top }: { children: ReactNode; onMouseDown: () => void; top: string }) {
  return createPortal(
    <div className={`no-drag anim-backdrop fixed inset-0 z-40 flex items-start justify-center bg-black/50 ${top}`} onMouseDown={onMouseDown}>
      {children}
    </div>,
    document.body
  )
}
