import { useEffect, useMemo, useRef, useState } from 'react'
import type { GithubRepo, ImportPreview, ImportResult, Settings } from '@shared/types'
import { IconFolder, IconLock } from '../icons'
import { useStore, addRepository, newWorkspace, newChatTab, refreshState, reportError, goToNextUnread } from '../store'
import { EFFORTS, MODELS, PERMISSIONS } from './Composer'
import { rank } from '../autocomplete'
import { QuickStartModalBody } from './AddProject'

function Shell({ children, onClose, width = 'w-[560px]' }: { children: React.ReactNode; onClose: () => void; width?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={onClose}>
      <div className={`${width} max-w-[92vw] rounded-xl border border-line bg-panel shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function Modals() {
  const modal = useStore((s) => s.modal)
  const close = () => useStore.getState().set({ modal: null })
  if (modal === 'settings') return <SettingsModal onClose={close} />
  if (modal === 'palette') return <Palette onClose={close} />
  if (modal === 'create') return <CreateModal onClose={close} />
  if (modal === 'conductor') return <ConductorImportModal onClose={close} />
  if (modal === 'quickstart')
    return (
      <Shell onClose={close} width="w-[480px]">
        <QuickStartModalBody onClose={close} />
      </Shell>
    )
  return null
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-0">
      <div className="flex-1">
        <div>{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const save = async (patch: Partial<Settings>) => {
    useStore.getState().set({ settings: await window.api.saveSettings(patch) })
  }
  const select = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'
  return (
    <Shell onClose={onClose}>
      <div className="border-b border-line px-5 py-3 font-medium">Settings</div>
      <Row label="Default model">
        <select className={select} value={settings.defaultModel} onChange={(e) => void save({ defaultModel: e.target.value as Settings['defaultModel'] })}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Default effort">
        <select className={select} value={settings.defaultEffort} onChange={(e) => void save({ defaultEffort: e.target.value as Settings['defaultEffort'] })}>
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Default permissions" hint="Full access runs agents unattended, like Conductor. The others ask before tools that change things.">
        <select className={select} value={settings.defaultPermission} onChange={(e) => void save({ defaultPermission: e.target.value as Settings['defaultPermission'] })}>
          {PERMISSIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Branch prefix" hint="New workspaces branch as prefix/name. Empty uses your GitHub username.">
        <input className={`${select} w-44`} defaultValue={settings.branchPrefix} placeholder="auto" onBlur={(e) => void save({ branchPrefix: e.target.value })} />
      </Row>
      <Row label="Anthropic API key" hint="Optional. Without one, agents use your Claude Code login.">
        <input type="password" className={`${select} w-44`} defaultValue={settings.anthropicApiKey} placeholder="sk-ant-…" onBlur={(e) => void save({ anthropicApiKey: e.target.value })} />
      </Row>
      <Row label="Notifications" hint="Notify when an agent finishes while the app is in the background.">
        <input type="checkbox" checked={settings.notifications} onChange={(e) => void save({ notifications: e.target.checked })} />
      </Row>
      <Row label="Workspaces folder" hint="Where new workspaces are created. Empty uses ~/choo-choo/workspaces.">
        <input className={`${select} w-44`} defaultValue={settings.workspacesRoot ?? ''} placeholder="~/choo-choo/workspaces" onBlur={(e) => void save({ workspacesRoot: e.target.value })} />
      </Row>
      <Row label="Import from Conductor" hint="Bring over your projects, open workspaces, chats and settings. Conductor's own data is only read, never changed.">
        <button className="rounded-md border border-line px-2.5 py-1 hover:bg-hover" onClick={() => useStore.getState().set({ modal: 'conductor' })}>
          Import…
        </button>
      </Row>
    </Shell>
  )
}

const LOCATION_KEY = 'clone-location'
const DEFAULT_LOCATION = '~/choo-choo/repos'

function CreateModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [location, setLocation] = useState(() => {
    try {
      return localStorage.getItem(LOCATION_KEY) || DEFAULT_LOCATION
    } catch {
      return DEFAULT_LOCATION
    }
  })
  const [busy, setBusy] = useState(false)
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [ghError, setGhError] = useState<string | null>(null)

  useEffect(() => {
    window.api.listGithubRepos().then(setRepos, (e) => setGhError(String(e?.message ?? e)))
  }, [])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (repos ?? []).filter((r) => !t || r.nameWithOwner.toLowerCase().includes(t) || r.description?.toLowerCase().includes(t)).slice(0, 100)
  }, [repos, q])

  const target = url.trim() || picked
  const clone = async () => {
    if (!target || busy) return
    setBusy(true)
    try {
      localStorage.setItem(LOCATION_KEY, location)
    } catch {
      /* storage unavailable */
    }
    try {
      const repo = await window.api.cloneRepo(target, location)
      await refreshState()
      onClose()
      newWorkspace(repo.id)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-md border border-line bg-bg px-3 py-2 outline-none focus:border-faint'
  return (
    <Shell onClose={onClose} width="w-[520px]">
      <div
        className="p-5"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.target === e.currentTarget.querySelector('input'))) {
            e.preventDefault()
            void clone()
          }
        }}
      >
        <div className="mb-4 text-lg font-semibold">Clone GitHub repo</div>
        <div className="mb-1.5 text-[12px] text-muted">Repository URL</div>
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/user/repo.git" className={`${field} mb-4`} />

        <div className="mb-1.5 text-[12px] text-muted">Your repos</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories…" className={`${field} mb-2`} />
        <div className="mb-4 h-56 overflow-y-auto rounded-md border border-line">
          {repos === null && !ghError && <div className="px-3 py-3 text-[12px] text-faint">Loading your repositories…</div>}
          {ghError && <div className="px-3 py-3 text-[12px] text-faint">Couldn't list GitHub repositories. Run <code>gh auth login</code>, or paste a URL above.</div>}
          {repos && shown.length === 0 && <div className="px-3 py-3 text-[12px] text-faint">No matching repositories.</div>}
          {shown.map((r) => {
            const [owner, name] = r.nameWithOwner.split('/')
            const on = picked === r.nameWithOwner && !url.trim()
            return (
              <button
                key={r.nameWithOwner}
                onClick={() => {
                  setPicked(r.nameWithOwner)
                  setUrl('')
                }}
                onDoubleClick={() => void clone()}
                className={`flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left last:border-b-0 ${on ? 'bg-raised' : 'hover:bg-hover'}`}
              >
                <img src={`https://avatars.githubusercontent.com/${owner}?s=64`} alt="" className="h-7 w-7 shrink-0 rounded-md bg-raised" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate">
                    {owner}/{name}
                    {r.private && <IconLock width={12} height={12} className="shrink-0 text-faint" />}
                  </div>
                  {r.description && <div className="truncate text-[12px] text-faint">{r.description}</div>}
                </div>
              </button>
            )
          })}
        </div>

        <div className="mb-1.5 text-[12px] text-muted">Location</div>
        <div className="mb-5 flex gap-2">
          <input value={location} onChange={(e) => setLocation(e.target.value)} className={`${field} flex-1`} />
          <button
            className="rounded-md border border-line px-3 hover:bg-hover"
            onClick={() => void window.api.pickFolder().then((p) => p && setLocation(p))}
          >
            Browse
          </button>
        </div>

        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-1.5 text-[12px] text-muted hover:text-fg"
            onClick={() => {
              onClose()
              void addRepository()
            }}
          >
            <IconFolder width={13} height={13} /> Open a local folder instead
          </button>
          <button disabled={!target || busy} onClick={() => void clone()} className="flex items-center gap-2 rounded-md bg-fg px-4 py-2 font-medium text-bg disabled:opacity-40">
            {busy ? `Cloning ${target}…` : 'Clone repo'} <span className="text-[11px] opacity-60">⌘↵</span>
          </button>
        </div>
      </div>
    </Shell>
  )
}

interface Entry {
  id: string
  label: string
  hint?: string
  run: () => void
}

function Palette({ onClose }: { onClose: () => void }) {
  const s = useStore()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const cur = s.workspaces.find((w) => w.id === s.selectedWs)

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    for (const w of s.workspaces.filter((w) => !w.archived)) {
      const repo = s.repos.find((r) => r.id === w.repoId)
      out.push({ id: `ws:${w.id}`, label: w.title, hint: `${repo?.name ?? ''} · ${w.branch}`, run: () => s.selectWorkspace(w.id) })
    }
    for (const r of s.repos) out.push({ id: `new:${r.id}`, label: `New workspace in ${r.name}`, hint: 'Action', run: () => newWorkspace(r.id) })
    out.push({ id: 'add', label: 'Add repository', hint: 'Action', run: () => s.set({ modal: 'create' }) })
    if (cur) out.push({ id: 'chat', label: 'New chat tab', hint: 'Action', run: () => void newChatTab(cur.id) })
    out.push({ id: 'unread', label: 'Next unread', hint: 'Action', run: goToNextUnread })
    out.push({ id: 'settings', label: 'Settings', hint: 'Action', run: () => s.set({ modal: 'settings' }) })
    out.push({ id: 'home', label: 'Home', hint: 'Action', run: () => s.selectWorkspace(null) })
    return out
  }, [s.workspaces, s.repos, cur?.id])

  const shown = useMemo(() => {
    if (!q) return entries
    const byKey = new Map(entries.map((e) => [`${e.label}  ${e.hint ?? ''}`, e]))
    return rank([...byKey.keys()], q, 50).map((k) => byKey.get(k)!)
  }, [q, entries])

  const pick = (e: Entry | undefined) => {
    if (!e) return
    onClose()
    if (e.id === 'add' || e.id === 'settings') setTimeout(e.run, 0)
    else e.run()
  }

  return (
    <Shell onClose={onClose}>
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setSel(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSel(Math.min(sel + 1, shown.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSel(Math.max(sel - 1, 0))
          } else if (e.key === 'Enter') pick(shown[sel])
        }}
        placeholder="Search workspaces and actions"
        className="w-full border-b border-line bg-transparent px-4 py-3 text-[14px] outline-none placeholder:text-faint"
      />
      <div ref={list} className="max-h-[50vh] overflow-y-auto p-1.5">
        {shown.length === 0 && <div className="p-4 text-center text-faint">No results</div>}
        {shown.map((e, i) => (
          <button
            key={e.id}
            onMouseEnter={() => setSel(i)}
            onClick={() => pick(e)}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${i === sel ? 'bg-hover' : ''}`}
          >
            <span className="flex-1 truncate">{e.label}</span>
            {e.hint && <span className="truncate text-[12px] text-faint">{e.hint}</span>}
          </button>
        ))}
      </div>
    </Shell>
  )
}

function ConductorImportModal({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [useRoot, setUseRoot] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<ImportResult | null>(null)

  useEffect(() => {
    window.api.previewConductorImport().then(setPreview, reportError)
  }, [])

  const run = async () => {
    setBusy(true)
    try {
      setDone(await window.api.importFromConductor({ useWorkspacesRoot: useRoot }))
      await refreshState()
      useStore.getState().set({ settings: (await window.api.getState()).settings })
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  const tag = (s: string) =>
    s === 'already' ? <span className="text-faint">already added</span> : s === 'missing' ? <span className="text-del">folder missing</span> : <span className="text-add">new</span>
  const newRepos = preview?.repos.filter((r) => r.status === 'new').length ?? 0
  const newWs = preview?.workspaces.filter((w) => w.status === 'new') ?? []
  const nothing = preview && newRepos === 0 && newWs.length === 0

  return (
    <Shell onClose={onClose} width="w-[620px]">
      <div className="border-b border-line px-5 py-3 font-medium">Import from Conductor</div>
      <div className="max-h-[60vh] overflow-y-auto p-5">
        {!preview && <div className="text-muted">Reading Conductor's data…</div>}
        {preview && !preview.found && <div className="text-muted">Conductor's data wasn't found on this Mac.</div>}
        {done && (
          <div className="mb-4 rounded-md border border-line bg-raised px-3 py-2">
            Imported {done.repos} projects, {done.workspaces} workspaces and {done.chats} chats ({done.messages} messages).
          </div>
        )}
        {preview?.found && !done && (
          <>
            <div className="mb-1 text-[12px] font-medium text-faint">Projects</div>
            {preview.repos.map((r) => (
              <div key={r.path} className="flex items-center gap-3 py-1">
                <span className="w-44 shrink-0 truncate">{r.name}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-faint" title={r.path}>
                  {r.path.replace(/^\/Users\/[^/]+/, '~')}
                  {r.hasScripts && ' · scripts'}
                </span>
                <span className="shrink-0 text-[12px]">{tag(r.status)}</span>
              </div>
            ))}
            <div className="mt-4 mb-1 text-[12px] font-medium text-faint">Open workspaces</div>
            {preview.workspaces.length === 0 && <div className="text-[12px] text-faint">None</div>}
            {preview.workspaces.map((w) => (
              <div key={w.path} className="flex items-center gap-3 py-1">
                <span className="w-44 shrink-0 truncate">{w.name}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-faint">
                  {w.repo} · {w.branch} · {w.chats} {w.chats === 1 ? 'chat' : 'chats'}
                </span>
                <span className="shrink-0 text-[12px]">{tag(w.status)}</span>
              </div>
            ))}
            {preview.archivedSkipped > 0 && <div className="mt-1 text-[12px] text-faint">{preview.archivedSkipped} archived workspaces are skipped.</div>}
            {preview.settings.length > 0 && (
              <>
                <div className="mt-4 mb-1 text-[12px] font-medium text-faint">Settings</div>
                {preview.settings.map((s) => (
                  <div key={s.label} className="flex gap-3 py-0.5 text-[12px]">
                    <span className="w-44 shrink-0 text-muted">{s.label}</span>
                    <span>{s.value}</span>
                  </div>
                ))}
              </>
            )}
            {preview.workspacesRoot && (
              <label className="mt-4 flex items-start gap-2 text-[12px]">
                <input type="checkbox" className="mt-0.5" checked={useRoot} onChange={(e) => setUseRoot(e.target.checked)} />
                <span>
                  Create new workspaces in Conductor's folder, <span className="text-muted">{preview.workspacesRoot.replace(/^\/Users\/[^/]+/, '~')}</span>
                </span>
              </label>
            )}
            <div className="mt-3 text-[12px] text-faint">
              Workspaces stay where they are; nothing is moved or copied. Claude chats resume with their full history.
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button className="rounded-md px-3 py-1.5 text-muted hover:text-fg" onClick={onClose}>
          {done ? 'Close' : 'Cancel'}
        </button>
        {preview?.found && !done && (
          <button disabled={busy || !!nothing} onClick={() => void run()} className="rounded-md bg-fg px-3 py-1.5 font-medium text-bg disabled:opacity-40">
            {busy ? 'Importing…' : nothing ? 'Nothing new to import' : `Import ${newRepos} projects and ${newWs.length} workspaces`}
          </button>
        )}
      </div>
    </Shell>
  )
}
