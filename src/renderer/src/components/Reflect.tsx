import { useEffect, useState } from 'react'
import type { PrInfo, Workspace } from '@shared/types'
import { lineDiff, type ReflectProposal, type ReflectResult } from '@shared/reflect'
import { useStore, refreshState, reportError } from '../store'
import { IconPR } from '../icons'

const dismissKey = (wsId: string) => `choo:merged-dismissed:${wsId}`

/**
 * Shown above the composer once the workspace's PR merges: keep going, archive, or archive after
 * a reflection pass that suggests improvements to the repo's agent setup.
 */
export function MergedBar({ ws, onArchive }: { ws: Workspace; onArchive: () => Promise<void> }) {
  const stats = useStore((s) => s.stats[ws.id])
  const [pr, setPr] = useState<PrInfo | null>(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey(ws.id)))
  const [reflecting, setReflecting] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setDismissed(localStorage.getItem(dismissKey(ws.id)))
    const load = () => void window.api.getPr(ws.id).then((p) => live && setPr(p), () => {})
    load()
    const t = setInterval(load, 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [ws.id, stats])

  if (!pr || pr.state !== 'MERGED' || dismissed === String(pr.number)) return null

  const keepGoing = () => {
    localStorage.setItem(dismissKey(ws.id), String(pr.number))
    setDismissed(String(pr.number))
  }
  const archive = async () => {
    setBusy(true)
    try {
      await onArchive()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="anim-pop mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 px-8">
        <div className="flex flex-1 items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2">
          <span className="text-violet-400">
            <IconPR />
          </span>
          <span className="min-w-0 flex-1 truncate">
            PR #{pr.number} merged. <span className="text-muted">What next?</span>
          </span>
          <button className="rounded-md px-2.5 py-1 text-muted hover:bg-hover hover:text-fg" onClick={keepGoing}>
            Continue
          </button>
          <button className="rounded-md border border-line px-2.5 py-1 hover:bg-hover disabled:opacity-40" disabled={busy} onClick={() => void archive()}>
            {busy ? 'Archiving…' : 'Archive'}
          </button>
          <button
            className="rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 text-accent hover:bg-accent/25 disabled:opacity-40"
            disabled={busy}
            onClick={() => setReflecting(true)}
            title="Review this session for friction and suggest changes to CLAUDE.md, rules, skills and hooks, then archive"
          >
            Archive and reflect
          </button>
        </div>
      </div>
      {reflecting && <ReflectModal ws={ws} archiveAfter onClose={() => setReflecting(false)} onArchive={onArchive} />}
    </>
  )
}

interface Draft extends ReflectProposal {
  accepted: boolean
  editing: boolean
}

/** Runs the reflect agent and lets the user accept, edit or reject each suggested change. */
export function ReflectModal({ ws, archiveAfter, onClose, onArchive }: { ws: Workspace; archiveAfter: boolean; onClose: () => void; onArchive: () => Promise<void> }) {
  const [result, setResult] = useState<ReflectResult | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setResult(null)
    setError(null)
    window.api.reflect(ws.id).then(
      (r) => {
        if (!live) return
        setResult(r)
        setDrafts(r.proposals.map((p) => ({ ...p, accepted: true, editing: false })))
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
    <div className="anim-backdrop fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[8vh]" onMouseDown={() => !applying && cancel()}>
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
    </div>
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
