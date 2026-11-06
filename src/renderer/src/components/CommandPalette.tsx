import { useEffect, useMemo, useRef, useState } from 'react'
import type { GrepHit, Workspace } from '@shared/types'
import { useStore, ago, archiveWorkspace, goToNextUnread, newChatTab, newWorkspace, openDoc, openOrchestrator, openPalette, restoreWorkspace, reportError, type PaletteMode } from '../store'
import { rank } from '../autocomplete'
import { IconArchive, IconFile, IconFileDiff, IconFileSearch, IconFolder, IconGear, IconHome, IconOrchestrator, IconPlus, IconRepo, IconSearch, IconTerminal } from '../icons'

type Tab = 'all' | 'workspaces' | 'projects' | 'actions' | 'settings'
const TABS: [Tab, string][] = [
  ['all', 'All'],
  ['workspaces', 'Workspaces'],
  ['projects', 'Projects'],
  ['actions', 'Actions'],
  ['settings', 'Settings']
]

interface Entry {
  id: string
  tab: Exclude<Tab, 'all'>
  section: string
  label: string
  /** Extra text matched by search but not shown. */
  keywords?: string
  icon: React.ReactNode
  /** Right-aligned: a shortcut or a relative time. */
  hint?: string
  archived?: boolean
  title?: string
  /** Runs after the palette closes. */
  run: () => void
  /** Switches the palette to another list instead of closing. */
  mode?: PaletteMode
}

const RECENT_IN_ALL = 5

/** ⌘K: workspaces (archived ones too), projects, actions and settings, plus the ⌘P file picker and ⌘⇧F search in files. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const s = useStore()
  const mode = s.paletteMode
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [sel, setSel] = useState(0)
  const [activity, setActivity] = useState<Record<string, number>>({})
  const listRef = useRef<HTMLDivElement>(null)
  const cur = s.workspaces.find((w) => w.id === s.selectedWs && !w.archived)

  useEffect(() => {
    let live = true
    void window.api.workspaceActivity().then((a) => live && setActivity(a), () => {})
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    setQ('')
    setSel(0)
  }, [mode])

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    const repoName = (w: Workspace) => s.repos.find((r) => r.id === w.repoId)?.name ?? ''
    const when = (w: Workspace) => (w.archived ? Math.max(w.archivedAt ?? 0, activity[w.id] ?? 0) : (activity[w.id] ?? w.createdAt))
    const recent = s.workspaces.filter((w) => !(w.orchestrator && w.archived)).sort((a, b) => when(b) - when(a))
    for (const w of recent) {
      out.push({
        id: `ws:${w.id}`,
        tab: 'workspaces',
        section: 'Recent workspaces',
        label: w.orchestrator ? `Orchestrator · ${repoName(w)}` : w.title,
        keywords: `${repoName(w)} ${w.branch}`,
        icon: w.orchestrator ? <IconOrchestrator /> : <IconTerminal />,
        hint: ago(when(w)),
        archived: w.archived,
        title: `${repoName(w)} · ${w.branch}${w.archived ? ' · archived, opening restores it' : ''}`,
        run: () => (w.archived ? void restoreWorkspace(w.id) : s.selectWorkspace(w.id))
      })
    }

    if (cur) {
      const ws = cur
      const section = 'Workspace actions'
      out.push({ id: 'files', tab: 'actions', section, label: 'File picker', icon: <IconFile />, hint: '⌘P', run: () => {}, mode: 'files' })
      out.push({ id: 'grep', tab: 'actions', section, label: 'Search in files', icon: <IconFileSearch />, hint: '⌘⇧F', run: () => {}, mode: 'grep' })
      out.push({
        id: 'changes',
        tab: 'actions',
        section,
        label: 'Show changes',
        icon: <IconFileDiff />,
        run: () => useStore.getState().set({ rightOpen: true, rightTab: 'changes' })
      })
      out.push({ id: 'chat', tab: 'actions', section, label: 'New chat tab', icon: <IconPlus />, hint: '⌘T', run: () => void newChatTab(ws.id) })
      out.push({ id: 'terminal', tab: 'actions', section, label: 'Toggle terminal', icon: <IconTerminal />, hint: '⌘J', run: () => useStore.getState().set({ bottomOpen: !useStore.getState().bottomOpen, rightOpen: true }) })
      out.push({ id: 'reveal', tab: 'actions', section, label: 'Reveal in Finder', icon: <IconFolder />, run: () => void window.api.revealInFinder(ws.path) })
      out.push({ id: 'share', tab: 'actions', section, label: 'Share with coworkers', icon: <IconRepo />, run: () => useStore.getState().set({ modal: 'share' }) })
      if (!ws.orchestrator) out.push({ id: 'archive', tab: 'actions', section, label: 'Archive workspace', icon: <IconArchive />, run: () => void archiveWorkspace(ws.id) })
    }

    for (const r of s.repos) {
      out.push({ id: `new:${r.id}`, tab: 'projects', section: 'Projects', label: r.name, keywords: 'new workspace project repository', icon: <IconRepo />, hint: 'New workspace', run: () => newWorkspace(r.id) })
    }
    for (const r of s.repos) {
      out.push({ id: `orch:${r.id}`, tab: 'projects', section: 'Projects', label: `Orchestrator for ${r.name}`, icon: <IconOrchestrator />, run: () => void openOrchestrator(r.id) })
    }
    out.push({ id: 'add', tab: 'projects', section: 'Projects', label: 'Add project', keywords: 'repository clone open folder', icon: <IconPlus />, hint: '⌘O', run: () => useStore.getState().set({ modal: 'create' }) })

    const a = 'Actions'
    out.push({ id: 'home', tab: 'actions', section: a, label: 'Go home', icon: <IconHome />, run: () => s.selectWorkspace(null) })
    out.push({ id: 'unread', tab: 'actions', section: a, label: 'Next unread', icon: <IconSearch />, hint: '⌘⇧U', run: goToNextUnread })
    out.push({ id: 'open-share', tab: 'actions', section: a, label: 'Open shared session', icon: <IconRepo />, run: () => useStore.getState().set({ modal: 'open-share' }) })
    out.push({ id: 'sidebar', tab: 'actions', section: a, label: 'Toggle sidebar', icon: <IconHome />, hint: '⌘B', run: () => useStore.getState().set({ sidebarOpen: !useStore.getState().sidebarOpen }) })
    out.push({
      id: 'cleanup',
      tab: 'actions',
      section: a,
      label: 'Clean up old archived workspaces',
      keywords: 'delete purge retention',
      icon: <IconArchive />,
      run: () => void window.api.cleanupArchives().catch(reportError)
    })

    const st = 'Settings'
    out.push({ id: 'settings', tab: 'settings', section: st, label: 'Open settings', icon: <IconGear />, hint: '⌘,', run: () => useStore.getState().set({ modal: 'settings' }) })
    out.push({ id: 'appearance', tab: 'settings', section: st, label: 'Appearance', keywords: 'theme accent font size density', icon: <IconGear />, run: () => useStore.getState().set({ modal: 'settings', settingsTab: 'appearance' }) })
    out.push({ id: 'telemetry', tab: 'settings', section: st, label: 'Telemetry', keywords: 'observability opentelemetry otel otlp traces metrics', icon: <IconGear />, run: () => useStore.getState().set({ modal: 'settings', settingsTab: 'telemetry' }) })
    out.push({
      id: 'notify',
      tab: 'settings',
      section: st,
      label: s.settings.notifications ? 'Turn off notifications' : 'Turn on notifications',
      icon: <IconGear />,
      run: () => void window.api.saveSettings({ notifications: !s.settings.notifications }).then((settings) => useStore.getState().set({ settings }))
    })
    out.push({
      id: 'retention',
      tab: 'settings',
      section: st,
      label: 'Delete archived workspaces after…',
      keywords: 'retention cleanup archive',
      icon: <IconArchive />,
      hint: s.settings.archiveRetentionDays ? `${s.settings.archiveRetentionDays}d` : 'Never',
      run: () => useStore.getState().set({ modal: 'settings', settingsTab: 'general' })
    })
    return out
  }, [s.workspaces, s.repos, s.settings, cur?.id, activity])

  const shown = useMemo(() => {
    let list = tab === 'all' ? entries : entries.filter((e) => e.tab === tab)
    if (!q) {
      if (tab === 'all') {
        const recent = list.filter((e) => e.section === 'Recent workspaces').slice(0, RECENT_IN_ALL)
        list = [...recent, ...list.filter((e) => e.section !== 'Recent workspaces')]
      }
      return list
    }
    const byKey = new Map(list.map((e) => [`${e.label}  ${e.keywords ?? ''}`, e]))
    const order = new Map(rank([...byKey.keys()], q, 200).map((k, i) => [byKey.get(k)!, i]))
    // Keep sections together, best match first within each.
    const sections = [...new Set(list.map((e) => e.section))]
    return sections.flatMap((sec) => list.filter((e) => e.section === sec && order.has(e)).sort((a, b) => order.get(a)! - order.get(b)!))
  }, [entries, tab, q])

  useEffect(() => setSel(0), [tab, q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const pick = (e: Entry | undefined) => {
    if (!e) return
    if (e.mode) return useStore.getState().set({ paletteMode: e.mode })
    onClose()
    // Let the palette unmount first so a modal opened by the entry isn't closed with it.
    setTimeout(e.run, 0)
  }

  if (mode !== 'all') return <FileSearch mode={mode} onClose={onClose} />

  const move = (d: number, len: number) => setSel((i) => Math.max(0, Math.min(len - 1, i + d)))

  return (
    <PaletteShell onClose={onClose}>
      <SearchInput
        value={q}
        onChange={setQ}
        placeholder="Type a command or search…"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            move(1, shown.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            move(-1, shown.length)
          } else if (e.key === 'Enter') pick(shown[sel])
          else if (e.key === 'Tab') {
            e.preventDefault()
            const i = TABS.findIndex(([t]) => t === tab)
            setTab(TABS[(i + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length][0])
          }
        }}
      />
      <div className="flex gap-1 px-3 pt-2.5 pb-1">
        {TABS.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-2.5 py-1 ${tab === t ? 'bg-hover text-fg' : 'text-muted hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>
      <div ref={listRef} className="max-h-[56vh] overflow-y-auto px-1.5 pb-1.5">
        {shown.length === 0 && <div className="p-6 text-center text-faint">No results</div>}
        {shown.map((e, i) => (
          <div key={e.id}>
            {(i === 0 || shown[i - 1].section !== e.section) && <div className="px-2.5 pt-3 pb-1 text-[12px] text-faint">{e.section}</div>}
            <button
              data-i={i}
              onMouseMove={() => sel !== i && setSel(i)}
              onClick={() => pick(e)}
              title={e.title}
              className={`relative flex h-10 w-full items-center gap-3 rounded-md px-2.5 text-left ${i === sel ? 'bg-hover' : ''}`}
            >
              {e.archived && <span className="absolute top-2 bottom-2 left-0 w-[2px] rounded-full bg-accent" />}
              <span className={`shrink-0 ${e.archived ? 'text-faint' : 'text-muted'}`}>{e.icon}</span>
              <span className={`flex-1 truncate ${e.archived ? 'text-faint' : i === sel ? 'font-medium text-fg' : ''}`}>{e.label}</span>
              {e.archived && i === sel && <span className="shrink-0 text-[11px] text-faint">Restore ↵</span>}
              {e.hint && <span className="shrink-0 text-[12px] text-faint">{e.hint}</span>}
            </button>
          </div>
        ))}
      </div>
    </PaletteShell>
  )
}

/** ⌘P file picker and ⌘⇧F search in files for the open workspace. */
function FileSearch({ mode, onClose }: { mode: 'files' | 'grep'; onClose: () => void }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === s.selectedWs && !w.archived))
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [files, setFiles] = useState<string[] | null>(null)
  const [hits, setHits] = useState<GrepHit[] | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode !== 'files' || !ws) return
    void window.api.listFiles(ws.id).then(setFiles, () => setFiles([]))
  }, [mode, ws?.id])

  useEffect(() => {
    if (mode !== 'grep' || !ws) return
    if (q.trim().length < 2) return setHits(null)
    let live = true
    const t = setTimeout(() => void window.api.searchFiles(ws.id, q).then((h) => live && setHits(h), () => live && setHits([])), 180)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [mode, q, ws?.id])

  const rows = useMemo(() => {
    if (mode === 'files') return rank(files ?? [], q, 100).map((p) => ({ key: p, path: p, line: undefined as number | undefined, text: '' }))
    return (hits ?? []).map((h) => ({ key: `${h.path}:${h.line}`, path: h.path, line: h.line as number | undefined, text: h.text }))
  }, [mode, files, hits, q])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const pick = (r: (typeof rows)[number] | undefined) => {
    if (!r || !ws) return
    onClose()
    openDoc(ws.id, { kind: 'file', path: r.path, line: r.line })
  }

  return (
    <PaletteShell onClose={onClose}>
      <SearchInput
        value={q}
        onChange={setQ}
        placeholder={!ws ? 'Open a workspace first' : mode === 'files' ? 'Search files by name…' : 'Search in files…'}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSel((i) => Math.min(rows.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') pick(rows[sel])
          else if (e.key === 'Backspace' && !q) openPalette('all')
        }}
      />
      <div className="flex items-center gap-2 px-4 pt-2.5 text-[12px] text-faint">
        <button className="hover:text-fg" onClick={() => openPalette('all')}>
          All
        </button>
        <span>/</span>
        <span className="text-muted">{mode === 'files' ? 'File picker' : 'Search in files'}</span>
      </div>
      <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-1.5">
        {!ws && <div className="p-6 text-center text-faint">Open a workspace to search its files.</div>}
        {ws && mode === 'files' && files === null && <div className="p-6 text-center text-faint">Loading files…</div>}
        {ws && mode === 'grep' && q.trim().length < 2 && <div className="p-6 text-center text-faint">Type at least two characters.</div>}
        {ws && rows.length === 0 && (mode === 'files' ? files !== null : hits !== null) && <div className="p-6 text-center text-faint">No results</div>}
        {rows.map((r, i) => {
          const slash = r.path.lastIndexOf('/')
          return (
            <button
              key={r.key}
              data-i={i}
              onMouseMove={() => sel !== i && setSel(i)}
              onClick={() => pick(r)}
              className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left ${i === sel ? 'bg-hover' : ''}`}
            >
              <IconFile className="shrink-0 text-muted" />
              {mode === 'files' ? (
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-fg">{r.path.slice(slash + 1)}</span>
                  {slash > 0 && <span className="ml-2 text-[12px] text-faint">{r.path.slice(0, slash)}</span>}
                </span>
              ) : (
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] text-fg">{r.text}</span>
                  <span className="block truncate text-[11px] text-faint">
                    {r.path}:{r.line}
                  </span>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </PaletteShell>
  )
}

function PaletteShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="anim-backdrop fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[10vh]" onMouseDown={onClose}>
      <div className="anim-pop w-[680px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function SearchInput(p: { value: string; onChange: (v: string) => void; placeholder: string; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4">
      <IconSearch width={16} height={16} className="shrink-0 text-faint" />
      <input autoFocus value={p.value} onChange={(e) => p.onChange(e.target.value)} onKeyDown={p.onKeyDown} placeholder={p.placeholder} className="flex-1 bg-transparent py-3.5 text-[15px] outline-none placeholder:text-faint" />
    </div>
  )
}
