import { useEffect, useRef, useState } from 'react'
import type { Effort, ModelId, SourceOption, WorkspaceSource } from '@shared/types'
import { useStore, createWorkspace, reportError } from '../store'
import { IconDown, IconGithub, IconRepo, IconSidebar, IconX } from '../icons'
import { Menu, type MenuItem } from './Menu'
import { EFFORTS, MODELS } from './Composer'

const KINDS: { id: WorkspaceSource['kind']; label: string }[] = [
  { id: 'pr', label: 'PRs' },
  { id: 'branch', label: 'Branches' },
  { id: 'issue', label: 'Issues' }
]

/** Conductor-style composer for a new workspace: pick the repo, the model, and optionally a PR, branch or issue to start from. */
export function NewWorkspace({ repoId }: { repoId: string }) {
  const s = useStore()
  const repo = s.repos.find((r) => r.id === repoId)
  const [text, setText] = useState('')
  const [model, setModel] = useState<ModelId>(s.settings.defaultModel)
  const [effort, setEffort] = useState<Effort>(s.settings.defaultEffort)
  const [source, setSource] = useState<SourceOption | null>(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<'repo' | 'model' | 'source' | null>(null)
  const repoBtn = useRef<HTMLButtonElement>(null)
  const modelBtn = useRef<HTMLButtonElement>(null)
  const sourceBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => setSource(null), [repoId])
  if (!repo) return null

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      await createWorkspace(repoId, { source: source?.source, text, model, effort })
    } catch (e) {
      reportError(e)
      setBusy(false)
    }
  }

  const repoItems: MenuItem[] = s.repos.filter((r) => !r.hidden).map((r) => ({ label: r.name, checked: r.id === repoId, onClick: () => s.set({ draftRepo: r.id }) }))
  const modelItems: MenuItem[] = [
    { kind: 'label', label: 'Model' },
    ...MODELS.map((m) => ({ label: m.label, checked: m.id === model, keepOpen: true, onClick: () => setModel(m.id) })),
    { kind: 'sep' },
    { kind: 'label', label: 'Effort' },
    ...EFFORTS.map((e) => ({ label: e[0].toUpperCase() + e.slice(1), checked: e === effort, keepOpen: true, onClick: () => setEffort(e) }))
  ]
  const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model

  return (
    <div className="flex flex-1 flex-col">
      <div className="drag flex h-11 items-center px-3">
        {!s.sidebarOpen && (
          <button className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
      </div>
      <div className="mx-auto w-full max-w-2xl px-6 pt-[18vh]">
        <div className="rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <button ref={repoBtn} className="flex items-center gap-1.5 rounded px-1.5 py-1 font-medium hover:bg-hover" onClick={() => setMenu('repo')}>
              <IconRepo className="text-faint" /> {repo.name} <IconDown className="text-faint" />
            </button>
            {source && (
              <span className="flex min-w-0 items-center gap-1 rounded bg-raised px-2 py-0.5 text-[12px] text-muted">
                <span className="truncate">{source.title}</span>
                <button className="text-faint hover:text-fg" onClick={() => setSource(null)} title="Start from the default branch instead">
                  <IconX width={12} height={12} />
                </button>
              </span>
            )}
            <div className="flex-1" />
            <button ref={sourceBtn} className="flex items-center gap-1 rounded px-1.5 py-1 text-muted hover:bg-hover hover:text-fg" title="Start from a PR, branch or issue" onClick={() => setMenu(menu === 'source' ? null : 'source')}>
              <IconGithub /> <IconDown className="text-faint" />
            </button>
          </div>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void create()
              }
            }}
            rows={4}
            placeholder={source?.source.kind === 'pr' ? 'What should the agent do with this PR? e.g. review it' : 'What do you want to work on?'}
            className="selectable block w-full resize-none bg-transparent px-4 pt-3 text-[14px] outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <button ref={modelBtn} className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-hover" onClick={() => setMenu('model')}>
              <span>{modelLabel}</span>
              <span className="text-muted capitalize">{effort}</span>
              <IconDown className="text-faint" />
            </button>
            <div className="flex-1" />
            <button disabled={busy} onClick={() => void create()} className="flex items-center gap-1.5 rounded-md bg-fg px-3 py-1 font-medium text-bg disabled:opacity-50">
              {busy ? 'Creating…' : 'Create'} <span className="text-[11px] opacity-60">↵</span>
            </button>
          </div>
        </div>
        <div className="mt-2 px-1 text-[12px] text-faint">
          {source ? `Starts the workspace on ${source.source.kind === 'issue' ? 'a new branch for' : ''} ${source.title}.` : `Starts a new branch from ${repo.defaultBranch}.`}
        </div>
      </div>
      {menu === 'repo' && <Menu anchor={repoBtn.current} align="left" items={repoItems} onClose={() => setMenu(null)} />}
      {menu === 'model' && <Menu anchor={modelBtn.current} align="left" items={modelItems} onClose={() => setMenu(null)} />}
      {menu === 'source' && (
        <SourcePicker
          anchor={sourceBtn.current}
          repoId={repoId}
          onPick={(o) => {
            setSource(o)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function SourcePicker({ anchor, repoId, onPick, onClose }: { anchor: HTMLElement | null; repoId: string; onPick: (o: SourceOption) => void; onClose: () => void }) {
  const [kind, setKind] = useState<WorkspaceSource['kind']>('pr')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<SourceOption[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    setItems(null)
    setErr(null)
    const t = setTimeout(() => {
      window.api.listSources(repoId, kind, q.trim()).then(
        (r) => live && (setItems(r), setSel(0)),
        (e) => live && setErr(String(e?.message ?? e))
      )
    }, 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [repoId, kind, q])

  useEffect(() => {
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose()
    window.addEventListener('mousedown', down)
    return () => window.removeEventListener('mousedown', down)
  }, [onClose])

  const r = anchor?.getBoundingClientRect()
  if (!r) return null
  return (
    <div ref={ref} className="fixed z-50 w-[420px] rounded-lg border border-line bg-raised shadow-2xl" style={{ top: r.bottom + 4, left: Math.max(8, r.right - 420) }}>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSel((i) => Math.min(i + 1, (items?.length ?? 1) - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && items?.[sel]) onPick(items[sel])
          else if (e.key === 'Tab') {
            e.preventDefault()
            setKind(KINDS[(KINDS.findIndex((k) => k.id === kind) + 1) % KINDS.length].id)
          }
        }}
        placeholder={kind === 'branch' ? 'Search branches' : 'Search by title, number, or author'}
        className="w-full border-b border-line bg-transparent px-3 py-2.5 outline-none placeholder:text-faint"
      />
      <div className="flex gap-1 border-b border-line px-2 py-1.5">
        {KINDS.map((k) => (
          <button key={k.id} onClick={() => setKind(k.id)} className={`rounded px-2 py-0.5 text-[12px] ${kind === k.id ? 'bg-hover text-fg' : 'text-muted hover:text-fg'}`}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="max-h-80 overflow-y-auto p-1">
        {err && <div className="px-2 py-3 text-[12px] text-faint">{err.includes('gh') ? 'Could not reach GitHub. Is gh signed in?' : err}</div>}
        {!err && items === null && <div className="px-2 py-3 text-[12px] text-faint">Loading…</div>}
        {items?.length === 0 && <div className="px-2 py-3 text-[12px] text-faint">Nothing found.</div>}
        {items?.map((o, i) => (
          <button key={JSON.stringify(o.source)} onMouseEnter={() => setSel(i)} onClick={() => onPick(o)} className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left ${i === sel ? 'bg-hover' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate">{o.title}</div>
              {o.detail && <div className="truncate text-[11px] text-faint">{o.detail}</div>}
            </div>
            {i === sel && <span className="shrink-0 text-[11px] text-faint">Select ↵</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
