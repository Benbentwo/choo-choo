import { useEffect, useRef, useState } from 'react'
import type { Effort, ModelId, SourceOption, WorkspaceSource } from '@shared/types'
import { useStore, createWorkspace, reportError, modelLabel, type DraftContext } from '../store'
import { IconBranch, IconDown, IconFolder, IconGithub, IconImage, IconPlus, IconSidebar, IconX } from '../icons'
import { Menu, type MenuItem } from './Menu'
import { RepoIcon } from './Sidebar'
import { EFFORT_LABEL, EFFORTS, MODELS } from './Composer'

const KINDS: { id: WorkspaceSource['kind']; label: string }[] = [
  { id: 'pr', label: 'PRs' },
  { id: 'branch', label: 'Branches' },
  { id: 'issue', label: 'Issues' },
  { id: 'notion', label: 'Notion' }
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
  const [menu, setMenu] = useState<'repo' | 'model' | 'source' | 'add' | null>(null)
  const [extra, setExtra] = useState<DraftContext>({ images: [], files: [], folders: [], links: [] })
  const addBtn = useRef<HTMLButtonElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const addImages = (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) continue
      const r = new FileReader()
      r.onload = () => setExtra((x) => ({ ...x, images: [...x.images, String(r.result)].slice(0, 10) }))
      r.readAsDataURL(f)
    }
  }
  const repoBtn = useRef<HTMLButtonElement>(null)
  const modelBtn = useRef<HTMLButtonElement>(null)
  const sourceBtn = useRef<HTMLButtonElement>(null)

  const [branches, setBranches] = useState<string[]>([])
  useEffect(() => setSource(null), [repoId])
  useEffect(() => {
    setBranches([])
    let live = true
    window.api.listSources(repoId, 'branch', '').then(
      (opts) => live && setBranches(opts.map((o) => o.title)),
      () => {}
    )
    return () => {
      live = false
    }
  }, [repoId])
  if (!repo) return null

  /** Remembers the base branch per repo, so the next workspace starts from it too. */
  const setBase = async (branch: string) => {
    try {
      await window.api.setRepoBaseBranch(repoId, branch)
      useStore.getState().set({ repos: useStore.getState().repos.map((r) => (r.id === repoId ? { ...r, defaultBranch: branch } : r)) })
    } catch (e) {
      reportError(e)
    }
  }

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      await createWorkspace(repoId, { source: source?.source, text, model, effort, extra })
    } catch (e) {
      reportError(e)
      setBusy(false)
    }
  }

  const repoItems: MenuItem[] = s.repos.filter((r) => !r.hidden).map((r) => ({ label: r.name, checked: r.id === repoId, onClick: () => s.set({ draftRepo: r.id }) }))
  const linkable = s.workspaces.filter((w) => !w.archived && !w.orchestrator)
  const addItems: MenuItem[] = [
    { label: 'Images…', icon: <IconImage />, onClick: () => imageInput.current?.click() },
    { label: 'Files…', icon: <IconFolder />, onClick: () => void window.api.pickFiles().then((f) => f.length && setExtra((x) => ({ ...x, files: [...new Set([...x.files, ...f])] }))) },
    { label: 'Folder…', icon: <IconFolder />, onClick: () => void window.api.pickFolder().then((f) => f && setExtra((x) => ({ ...x, folders: [...new Set([...x.folders, f])] }))) },
    {
      label: 'Link workspace',
      icon: <IconBranch />,
      submenu: linkable.length
        ? linkable.map((w) => ({
            label: w.title,
            hint: s.repos.find((r) => r.id === w.repoId)?.name,
            checked: extra.links.includes(w.id),
            keepOpen: true,
            onClick: () => setExtra((x) => ({ ...x, links: x.links.includes(w.id) ? x.links.filter((l) => l !== w.id) : [...x.links, w.id] }))
          }))
        : [{ kind: 'label', label: 'No open workspaces' }]
    }
  ]
  const chips = [
    ...extra.links.map((id) => ({ key: `l:${id}`, icon: <IconBranch width={12} height={12} />, label: s.workspaces.find((w) => w.id === id)?.title ?? id, remove: () => setExtra((x) => ({ ...x, links: x.links.filter((l) => l !== id) })) })),
    ...extra.folders.map((f) => ({ key: `d:${f}`, icon: <IconFolder width={12} height={12} />, label: f.split('/').pop() || f, remove: () => setExtra((x) => ({ ...x, folders: x.folders.filter((y) => y !== f) })) })),
    ...extra.files.map((f) => ({ key: `f:${f}`, icon: null, label: f.split('/').pop() || f, remove: () => setExtra((x) => ({ ...x, files: x.files.filter((y) => y !== f) })) }))
  ]
  const modelItems: MenuItem[] = [
    { kind: 'label', label: 'Model' },
    ...MODELS.map((m) => ({ label: modelLabel(m.id, s.modelDetails), hint: s.modelDetails[m.id]?.description, checked: m.id === model, keepOpen: true, onClick: () => setModel(m.id) })),
    { kind: 'sep' },
    { kind: 'label', label: 'Effort' },
    ...EFFORTS.map((e) => ({ label: EFFORT_LABEL[e], checked: e === effort, keepOpen: true, onClick: () => setEffort(e) }))
  ]
  const currentModel = modelLabel(model, s.modelDetails)

  return (
    <div className="flex flex-1 flex-col">
      <div className="drag flex h-11 items-center px-3">
        {!s.sidebarOpen && (
          <button title="Show sidebar" className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
      </div>
      <div className="mx-auto w-full max-w-2xl px-6 pt-[18vh]">
        <div className="rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <button ref={repoBtn} className="flex items-center gap-1.5 rounded px-1.5 py-1 font-medium hover:bg-hover" onClick={() => setMenu('repo')}>
              <RepoIcon repo={repo} /> {repo.name} <IconDown className="text-faint" />
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
            <button ref={sourceBtn} className="flex items-center gap-1 rounded px-1.5 py-1 text-muted hover:bg-hover hover:text-fg" title="Start from a PR, branch, issue or Notion page" onClick={() => setMenu(menu === 'source' ? null : 'source')}>
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
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
              if (imgs.length) {
                e.preventDefault()
                addImages(imgs)
              }
            }}
            rows={4}
            placeholder={source?.source.kind === 'pr' ? 'What should the agent do with this PR? e.g. review it' : 'What do you want to work on?'}
            className="selectable block w-full resize-none bg-transparent px-4 pt-3 text-[14px] outline-none placeholder:text-faint"
          />
          {(chips.length > 0 || extra.images.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
              {extra.images.map((src, i) => (
                <span key={i} className="relative">
                  <img src={src} alt="" className="h-10 w-10 rounded border border-line object-cover" />
                  <button title="Remove image" className="absolute -top-1.5 -right-1.5 rounded-full bg-raised p-0.5 text-faint hover:text-fg" onClick={() => setExtra((x) => ({ ...x, images: x.images.filter((_, j) => j !== i) }))}>
                    <IconX width={10} height={10} />
                  </button>
                </span>
              ))}
              {chips.map((c) => (
                <span key={c.key} className="flex max-w-[220px] items-center gap-1 rounded bg-raised px-2 py-0.5 text-[12px] text-muted">
                  {c.icon}
                  <span className="truncate">{c.label}</span>
                  <button title="Remove" className="text-faint hover:text-fg" onClick={c.remove}>
                    <IconX width={11} height={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <button ref={modelBtn} className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-hover" onClick={() => setMenu('model')}>
              <span>{currentModel}</span>
              <span className="text-muted">{EFFORT_LABEL[effort]}</span>
              <IconDown className="text-faint" />
            </button>
            <div className="flex-1" />
            <button ref={addBtn} className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg" title="Add images, files, folders or link a workspace" onClick={() => setMenu('add')}>
              <IconPlus />
            </button>
            <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden" onChange={(e) => e.target.files && addImages(e.target.files)} />
            <button disabled={busy} onClick={() => void create()} className="flex items-center gap-1.5 rounded-md bg-fg px-3 py-1 font-medium text-bg disabled:opacity-50">
              {busy ? 'Creating…' : 'Create'} <span className="text-[11px] opacity-60">↵</span>
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5 px-1 text-[12px] text-faint">
          {source ? (
            `Starts the workspace on ${source.source.kind === 'issue' || source.source.kind === 'notion' ? 'a new branch for' : ''} ${source.title}.`
          ) : (
            <>
              Starts a new branch from
              <select
                className="rounded-md border border-line bg-bg px-1.5 py-0.5 text-fg outline-none"
                value={repo.defaultBranch}
                onChange={(e) => void setBase(e.target.value)}
                title="Remembered for this repo. PRs from its workspaces target this branch too."
              >
                {[repo.defaultBranch, ...branches.filter((b) => b !== repo.defaultBranch)].map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>
      {menu === 'repo' && <Menu anchor={repoBtn.current} align="left" items={repoItems} onClose={() => setMenu(null)} />}
      {menu === 'add' && <Menu anchor={addBtn.current} items={addItems} onClose={() => setMenu(null)} />}
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
        placeholder={kind === 'branch' ? 'Search branches' : kind === 'notion' ? 'Paste a Notion page or task link' : 'Search by title, number, or author'}
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
        {items?.length === 0 && <div className="px-2 py-3 text-[12px] text-faint">{kind === 'notion' ? (q.trim() ? 'That is not a Notion link. Paste the link to a page or task.' : "Paste the link to a Notion page or task. The agent reads it with Claude's Notion connection.") : 'Nothing found.'}</div>}
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
