import { useEffect, useMemo, useRef, useState } from 'react'
import type { GithubRepo, Settings } from '@shared/types'
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
