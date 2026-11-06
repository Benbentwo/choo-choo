import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExtraAgentId, Extras, GithubRepo, Settings } from '@shared/types'
import { IconFolder, IconGithub, IconLock } from '../icons'
import { useStore, addRepository, newWorkspace, newChatTab, refreshState, reportError, goToNextUnread } from '../store'
import { EFFORTS, MODELS, PERMISSIONS } from './Composer'
import { rank } from '../autocomplete'
import { AppearanceSettings } from './Appearance'
import { OpenShareModal, ShareModal } from './ShareModals'

function Shell({ children, onClose, width = 'w-[560px]' }: { children: React.ReactNode; onClose: () => void; width?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="anim-backdrop fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={onClose}>
      <div className={`anim-pop ${width} max-w-[92vw] rounded-xl border border-line bg-panel shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
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
  if (modal === 'open-share') return <OpenShareModal onClose={close} />
  if (modal === 'share') return <ShareFor onClose={close} />
  return null
}

function ShareFor({ onClose }: { onClose: () => void }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === s.selectedWs))
  return ws ? <ShareModal ws={ws} onClose={onClose} /> : null
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
  const [tab, setTab] = useState<'general' | 'agents' | 'appearance'>('general')
  return (
    <Shell onClose={onClose} width="w-[620px]">
      <div className="flex items-center gap-4 border-b border-line px-5 pt-3">
        <div className="pb-3 font-medium">Settings</div>
        <div className="ml-auto flex gap-1">
          {(['general', 'agents', 'appearance'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-2.5 pb-2.5 capitalize ${tab === t ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        {tab === 'appearance' ? (
          <AppearanceSettings />
        ) : tab === 'agents' ? (
          <ExtrasSection extras={settings.extras} save={(patch) => void save({ extras: { ...settings.extras, ...patch } })} />
        ) : (
          <>
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
            <Row label="Claude Code" hint="Which Claude Code runs your agents. Your installed copy uses its own updates and settings. Falls back to the bundled one if it isn't found.">
              <select className={select} value={settings.claudeBinary} onChange={(e) => void save({ claudeBinary: e.target.value as Settings['claudeBinary'] })}>
                <option value="bundled">Bundled with the app</option>
                <option value="installed">My installed claude</option>
              </select>
            </Row>
            <Row label="Anthropic API key" hint="Optional. Without one, agents use your own Claude login: run claude in Terminal and type /login to sign in.">
              <input type="password" className={`${select} w-44`} defaultValue={settings.anthropicApiKey} placeholder="sk-ant-…" onBlur={(e) => void save({ anthropicApiKey: e.target.value })} />
            </Row>
            <Row label="Notifications" hint="Notify when an agent finishes while the app is in the background.">
              <input type="checkbox" checked={settings.notifications} onChange={(e) => void save({ notifications: e.target.checked })} />
            </Row>
          </>
        )}
      </div>
    </Shell>
  )
}

const EXTRA_AGENTS: { id: ExtraAgentId; label: string; hint: string }[] = [
  { id: 'scout', label: 'Scout', hint: 'Fast read-only explorer on Haiku. Used for research in plan mode, or ask for it with @scout.' },
  { id: 'reviewer', label: 'Reviewer', hint: 'Bug-hunting reviewer on Opus. Powers the Review tab with stricter rules, or ask for it with @reviewer.' },
  { id: 'securityReviewer', label: 'Security reviewer', hint: 'Adds a Security review button to the Review tab, or ask for it with @security-reviewer.' },
  { id: 'quickWorker', label: 'Quick worker', hint: 'Low-cost Haiku worker for mechanical edits. Type /quick followed by the task.' }
]

function ExtrasSection({ extras, save }: { extras: Extras; save: (patch: Partial<Extras>) => void }) {
  const select = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'
  return (
    <>
      <div className="border-b border-line px-5 py-2.5 text-[12px] text-faint">Extra agents adapted from oh-my-pi. Subagents work in Claude chats; the advisor works in every chat.</div>
      {EXTRA_AGENTS.map((a) => (
        <div key={a.id}>
          <Row label={a.label} hint={a.hint}>
            <input type="checkbox" checked={extras.agents[a.id]} onChange={(e) => save({ agents: { ...extras.agents, [a.id]: e.target.checked } })} />
          </Row>
          {a.id === 'reviewer' && extras.agents.reviewer && (
            <Row label="Review before opening a PR" hint="Create PR has the reviewer check the changes first, and stops if it finds a serious bug.">
              <input type="checkbox" checked={extras.reviewBeforePr} onChange={(e) => save({ reviewBeforePr: e.target.checked })} />
            </Row>
          )}
        </div>
      ))}
      <Row label="Advisor" hint="A second model reviews each finished turn and points out bugs, drift from your ask, or unverified claims. On for every chat; switch it off per chat in the composer. Costs one extra model call per turn.">
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
          <Row label="Send blockers automatically" hint="Pass blocker notes to the agent without waiting for you to click Send to agent. At most once per message you send.">
            <input type="checkbox" checked={extras.advisorSteer} onChange={(e) => save({ advisorSteer: e.target.checked })} />
          </Row>
        </>
      )}
    </>
  )
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [ghError, setGhError] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const myRepos = useStore((s) => s.repos)
  const added = useMemo(() => new Set(myRepos.map((r) => r.name)), [myRepos])

  useEffect(() => {
    window.api.listGithubRepos().then(setRepos, (e) => setGhError(String(e?.message ?? e)))
  }, [])

  const looksLikeUrl = /^(https:\/\/|git@|ssh:\/\/)/.test(q.trim())
  const shown = useMemo(() => {
    if (!repos || looksLikeUrl) return []
    const t = q.trim().toLowerCase()
    return repos.filter((r) => !t || r.nameWithOwner.toLowerCase().includes(t) || r.description?.toLowerCase().includes(t)).slice(0, 50)
  }, [repos, q, looksLikeUrl])
  useEffect(() => setSel(0), [q])

  const clone = async (target: string) => {
    setBusy(target)
    try {
      const repo = await window.api.cloneRepo(target)
      await refreshState()
      onClose()
      await newWorkspace(repo.id)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
    }
  }
  const onEnter = () => {
    if (busy) return
    if (looksLikeUrl || /^[\w.-]+\/[\w.-]+$/.test(q.trim())) void clone(q.trim())
    else if (shown[sel]) void clone(shown[sel].nameWithOwner)
  }

  return (
    <Shell onClose={onClose} width="w-[560px]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="font-medium">Add a repository</span>
        <button
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12px] hover:bg-hover"
          onClick={() => {
            onClose()
            void addRepository()
          }}
        >
          <IconFolder width={14} height={14} /> Open local folder
        </button>
      </div>
      <div className="p-3">
        <div className="mb-2 flex items-center gap-2 rounded-md border border-line bg-bg px-2.5 focus-within:border-faint">
          <IconGithub width={15} height={15} className="text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEnter()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((i) => Math.min(i + 1, shown.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((i) => Math.max(i - 1, 0))
              }
            }}
            placeholder="Search your GitHub repositories, or paste a URL"
            className="flex-1 bg-transparent py-2 outline-none"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {looksLikeUrl && (
            <button disabled={!!busy} onClick={() => void clone(q.trim())} className="flex h-10 w-full items-center rounded-md bg-hover px-2 text-left">
              {busy ? `Cloning ${q.trim()}…` : `Clone ${q.trim()}`}
            </button>
          )}
          {!looksLikeUrl && repos === null && !ghError && <div className="px-2 py-3 text-[12px] text-faint">Loading your repositories…</div>}
          {ghError && (
            <div className="px-2 py-3 text-[12px] text-faint">
              Couldn't list GitHub repositories. Sign in with <code>gh auth login</code>, or paste a URL above.
            </div>
          )}
          {shown.map((r, i) => {
            const name = r.nameWithOwner.split('/')[1]
            return (
              <button
                key={r.nameWithOwner}
                disabled={!!busy}
                onMouseEnter={() => setSel(i)}
                onClick={() => void clone(r.nameWithOwner)}
                className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left ${i === sel ? 'bg-hover' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-faint">{r.nameWithOwner.split('/')[0]}/</span>
                    <span>{name}</span>
                    {r.private && <IconLock width={12} height={12} className="text-faint" />}
                  </div>
                  {r.description && <div className="truncate text-[12px] text-faint">{r.description}</div>}
                </div>
                <span className="shrink-0 text-[12px] text-faint">
                  {busy === r.nameWithOwner ? 'Cloning…' : added.has(name) ? 'Added' : i === sel ? 'Clone ↵' : ''}
                </span>
              </button>
            )
          })}
          {repos && !looksLikeUrl && shown.length === 0 && <div className="px-2 py-3 text-[12px] text-faint">No matching repositories.</div>}
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
    if (cur) out.push({ id: 'share', label: 'Share workspace with coworkers', hint: 'Action', run: () => s.set({ modal: 'share' }) })
    out.push({ id: 'open-share', label: 'Open shared session', hint: 'Action', run: () => s.set({ modal: 'open-share' }) })
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
    if (e.id === 'add' || e.id === 'settings' || e.id === 'share' || e.id === 'open-share') setTimeout(e.run, 0)
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
