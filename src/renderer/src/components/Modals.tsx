import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExtraAgentId, Extras, Settings } from '@shared/types'
import { useStore, addRepository, newWorkspace, newChatTab, refreshState, reportError, goToNextUnread } from '../store'
import { EFFORTS, MODELS, PERMISSIONS } from './Composer'
import { rank } from '../autocomplete'

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
      <div className="max-h-[70vh] overflow-y-auto">
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
        <ExtrasSection extras={settings.extras} save={(patch) => void save({ extras: { ...settings.extras, ...patch } })} />
      </div>
    </Shell>
  )
}

const EXTRA_AGENTS: { id: ExtraAgentId; label: string; hint: string }[] = [
  { id: 'scout', label: 'Scout', hint: 'Fast read-only explorer on Haiku. The agent sends it to search the codebase and report back.' },
  { id: 'reviewer', label: 'Reviewer', hint: 'Code review specialist on Opus that finds bugs in the current diff before you merge.' },
  { id: 'securityReviewer', label: 'Security reviewer', hint: 'Read-only security specialist that traces untrusted input to dangerous code.' },
  { id: 'quickWorker', label: 'Quick worker', hint: 'Low-cost Haiku worker for strictly mechanical edits or data collection.' }
]

function ExtrasSection({ extras, save }: { extras: Extras; save: (patch: Partial<Extras>) => void }) {
  const select = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'
  return (
    <>
      <div className="border-y border-line bg-bg/40 px-5 py-2 text-[12px] font-medium text-muted">Extra agents (from oh-my-pi) · Claude chats only</div>
      {EXTRA_AGENTS.map((a) => (
        <Row key={a.id} label={a.label} hint={a.hint}>
          <input type="checkbox" checked={extras.agents[a.id]} onChange={(e) => save({ agents: { ...extras.agents, [a.id]: e.target.checked } })} />
        </Row>
      ))}
      <Row label="Advisor" hint="A second model reviews each finished turn and points out bugs, drift from your ask, or unverified claims. Costs an extra model call per turn.">
        <input type="checkbox" checked={extras.advisor} onChange={(e) => save({ advisor: e.target.checked })} />
      </Row>
      {extras.advisor && (
        <>
          <Row label="Advisor model">
            <select className={select} value={extras.advisorModel} onChange={(e) => save({ advisorModel: e.target.value as Extras['advisorModel'] })}>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </Row>
          <Row label="Let the advisor steer" hint="Send blocker-level advice back to the agent automatically, once per message you send.">
            <input type="checkbox" checked={extras.advisorSteer} onChange={(e) => save({ advisorSteer: e.target.checked })} />
          </Row>
        </>
      )}
    </>
  )
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const clone = async () => {
    setBusy(true)
    try {
      const repo = await window.api.cloneRepo(url)
      await refreshState()
      onClose()
      await newWorkspace(repo.id)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell onClose={onClose} width="w-[480px]">
      <div className="border-b border-line px-5 py-3 font-medium">Add a repository</div>
      <div className="p-5">
        <button
          className="mb-5 w-full rounded-lg border border-line px-4 py-3 text-left hover:bg-hover"
          onClick={() => {
            onClose()
            void addRepository()
          }}
        >
          <div>Open a local repository</div>
          <div className="text-[12px] text-faint">Pick a folder that is already a git repo</div>
        </button>
        <div className="mb-1.5 text-[12px] text-muted">Or clone from a URL</div>
        <div className="flex gap-2">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && url && !busy && void clone()}
            placeholder="https://github.com/owner/repo"
            className="flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 outline-none focus:border-faint"
          />
          <button disabled={!url || busy} onClick={() => void clone()} className="rounded-md bg-fg px-3 font-medium text-bg disabled:opacity-40">
            {busy ? 'Cloning…' : 'Clone'}
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
    for (const r of s.repos) out.push({ id: `new:${r.id}`, label: `New workspace in ${r.name}`, hint: 'Action', run: () => void newWorkspace(r.id) })
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
