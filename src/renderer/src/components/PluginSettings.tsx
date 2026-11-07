import { useEffect, useMemo, useState } from 'react'
import type { AvailablePlugin, InstalledPlugin, LocalSkill, Marketplace } from '@shared/types'
import { reportError, useStore } from '../store'

const SCOPE: Record<string, string> = { user: 'Every repo', project: 'This repo', local: 'You, this repo only' }
const field = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'
const OFFICIAL = 'anthropics/claude-plugins-official'

/** Settings → Plugins: Claude Code plugins and marketplaces, plus your own skills, commands and agents. */
export function PluginSettings() {
  const allRepos = useStore((s) => s.repos)
  const repos = allRepos.filter((r) => !r.hidden)
  const current = useStore((s) => s.workspaces.find((w) => w.id === s.selectedWs)?.repoId)
  const [repoId, setRepoId] = useState(() => current ?? repos[0]?.id ?? '')
  const [view, setView] = useState<'installed' | 'browse' | 'skills'>('installed')
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, string>>({})

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
    }
  }
  const refresh = () => run('refresh', async () => setInstalled(await window.api.pluginsInstalled(repoId)))
  useEffect(() => {
    setInstalled(null)
    setDetails({})
    if (repoId) void refresh()
  }, [repoId])

  if (!repos.length) return <div className="px-5 py-4 text-[12px] text-faint">Add a repository first.</div>

  const toggleDetails = (id: string) =>
    details[id] !== undefined
      ? setDetails(Object.fromEntries(Object.entries(details).filter(([k]) => k !== id)))
      : void run(`details:${id}`, async () => {
          const text = await window.api.pluginDetails(repoId, id)
          setDetails((d) => ({ ...d, [id]: text }))
        })

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-[12px]">
        <select className="rounded-md border border-line bg-bg px-2 py-0.5 outline-none" value={repoId} onChange={(e) => setRepoId(e.target.value)} title="Project-scope plugins and skills come from this repo">
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        {(['installed', 'browse', 'skills'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`rounded px-2 py-0.5 ${view === v ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}>
            {v === 'installed' ? 'Installed' : v === 'browse' ? 'Browse' : 'Your skills'}
          </button>
        ))}
      </div>

      {view === 'installed' && (
        <>
          {!installed && <div className="px-5 py-4 text-[12px] text-faint">Loading plugins…</div>}
          {installed?.length === 0 && <div className="px-5 py-4 text-[12px] text-faint">No plugins yet. Find some under Browse.</div>}
          {installed?.map((p) => (
            <div key={`${p.scope}:${p.id}`} className="border-b border-line px-5 py-3 last:border-0">
              <div className="flex items-center gap-2">
                <button className="min-w-0 truncate text-left font-medium hover:underline" onClick={() => toggleDetails(p.id)}>
                  {p.name}
                </button>
                <span className="shrink-0 text-[11px] text-faint">
                  {p.version && `v${p.version} · `}
                  {p.marketplace} · {SCOPE[p.scope] ?? p.scope}
                </span>
                <div className="flex-1" />
                {busy === `x:${p.id}` && <span className="text-[12px] text-faint">Working…</span>}
                {p.manageable && (
                  <button
                    className="text-[12px] text-faint hover:text-del disabled:opacity-40"
                    disabled={!!busy}
                    onClick={() =>
                      void run(`x:${p.id}`, async () => {
                        await window.api.pluginUninstall(repoId, p.id, p.scope)
                        setInstalled(await window.api.pluginsInstalled(repoId))
                      })
                    }
                  >
                    Uninstall
                  </button>
                )}
                <input
                  type="checkbox"
                  checked={p.enabled}
                  disabled={!!busy}
                  title={p.enabled ? 'Turn off' : 'Turn on'}
                  onChange={(e) =>
                    void run(`x:${p.id}`, async () => {
                      await window.api.pluginSetEnabled(repoId, p.id, e.target.checked, p.scope)
                      setInstalled(await window.api.pluginsInstalled(repoId))
                    })
                  }
                />
              </div>
              {busy === `details:${p.id}` && <div className="mt-1 text-[12px] text-faint">Reading plugin…</div>}
              {details[p.id] !== undefined && <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-line bg-bg p-2.5 font-mono text-[11px] whitespace-pre-wrap text-muted">{details[p.id]}</pre>}
            </div>
          ))}
          {installed && <div className="px-5 py-2.5 text-[12px] text-faint">Changes apply from the next message in each chat. Click a name to see its skills, agents, hooks and servers.</div>}
        </>
      )}

      {view === 'browse' && <Browse repoId={repoId} installedIds={new Set((installed ?? []).map((p) => p.id))} onInstalled={() => void refresh()} />}
      {view === 'skills' && <Skills repoId={repoId} />}
    </div>
  )
}

function Browse({ repoId, installedIds, onInstalled }: { repoId: string; installedIds: Set<string>; onInstalled: () => void }) {
  const [markets, setMarkets] = useState<Marketplace[] | null>(null)
  const [list, setList] = useState<AvailablePlugin[] | null>(null)
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [confirm, setConfirm] = useState<{ id: string; command: string; sha256: string } | null>(null)

  const load = async (fresh = false) => {
    try {
      const m = await window.api.pluginMarketplaces(repoId)
      setMarkets(m)
      setList(m.length ? await window.api.pluginsAvailable(repoId, fresh) : [])
    } catch (e) {
      reportError(e)
      setList([])
    }
  }
  useEffect(() => {
    setMarkets(null)
    setList(null)
    void load()
  }, [repoId])

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
    }
  }
  const addMarket = (s: string) =>
    run('market', async () => {
      await window.api.pluginAddMarketplace(repoId, s)
      setSource('')
      setList(null)
      await load(true)
    })
  const install = (id: string, acceptSha?: string) =>
    run(id, async () => {
      const r = await window.api.pluginInstall(repoId, id, scope, acceptSha)
      if (!r.ok) return setConfirm({ id, ...r.confirm })
      setConfirm(null)
      onInstalled()
    })

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (list ?? []).filter((p) => words.every((w) => `${p.name} ${p.description} ${p.marketplace}`.toLowerCase().includes(w))).slice(0, 60)
  }, [list, q])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5 text-[12px]">
        <span className="text-faint">Marketplaces:</span>
        {markets?.map((m) => (
          <span key={m.name} className="flex items-center gap-1 rounded bg-raised px-1.5 py-0.5" title={m.source}>
            {m.name}
            <button
              className="text-faint hover:text-del"
              title="Remove marketplace"
              disabled={!!busy}
              onClick={() =>
                void run('market', async () => {
                  await window.api.pluginRemoveMarketplace(repoId, m.name)
                  await load(true)
                })
              }
            >
              ×
            </button>
          </span>
        ))}
        {markets?.length === 0 && (
          <button className="rounded-md bg-fg px-2 py-0.5 font-medium text-bg disabled:opacity-40" disabled={!!busy} onClick={() => void addMarket(OFFICIAL)}>
            Add Anthropic's marketplace
          </button>
        )}
        <input className={`${field} min-w-0 flex-1 py-0.5`} placeholder="owner/repo or git URL" value={source} onChange={(e) => setSource(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && source.trim() && void addMarket(source)} />
        <button className="rounded-md border border-line px-2 py-0.5 hover:bg-hover disabled:opacity-40" disabled={!!busy || !source.trim()} onClick={() => void addMarket(source)}>
          {busy === 'market' ? 'Working…' : 'Add'}
        </button>
      </div>
      <div className="flex items-center gap-2 border-b border-line px-5 py-2 text-[12px]">
        <input className={`${field} min-w-0 flex-1`} placeholder={list ? `Search ${list.length} plugins` : 'Loading…'} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={field} value={scope} onChange={(e) => setScope(e.target.value as 'user' | 'project')} title="Install for every repo, or for this repo's .claude/settings.json">
          <option value="user">Install for every repo</option>
          <option value="project">Install for this repo</option>
        </select>
      </div>
      {confirm && (
        <div className="border-b border-amber-500/40 bg-amber-500/5 px-5 py-3 text-[12px]">
          <div className="mb-1 font-medium text-amber-400">{confirm.id} installs by running this command</div>
          <pre className="mb-2 max-h-32 overflow-auto rounded bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap">{confirm.command}</pre>
          <div className="flex gap-2">
            <button className="rounded-md bg-fg px-2.5 py-1 font-medium text-bg disabled:opacity-40" disabled={!!busy} onClick={() => void install(confirm.id, confirm.sha256)}>
              Run it and install
            </button>
            <button className="text-muted hover:text-fg" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {list === null && <div className="px-5 py-4 text-[12px] text-faint">Reading marketplaces…</div>}
      {list?.length === 0 && markets && markets.length > 0 && <div className="px-5 py-4 text-[12px] text-faint">These marketplaces list no plugins.</div>}
      {shown.map((p) => (
        <div key={p.id} className="flex items-start gap-3 border-b border-line px-5 py-2.5 last:border-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-[11px] text-faint">
                {p.marketplace}
                {p.installs ? ` · ${p.installs.toLocaleString()} installs` : ''}
              </span>
            </div>
            <div className="line-clamp-2 text-[12px] text-faint">{p.description}</div>
          </div>
          {installedIds.has(p.id) ? (
            <span className="shrink-0 text-[12px] text-faint">Installed</span>
          ) : (
            <button className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[12px] hover:bg-hover disabled:opacity-40" disabled={!!busy} onClick={() => void install(p.id)}>
              {busy === p.id ? 'Installing…' : 'Install'}
            </button>
          )}
        </div>
      ))}
      {list && list.length > shown.length && <div className="px-5 py-2.5 text-[12px] text-faint">Showing {shown.length} of {list.length}. Search to narrow it down.</div>}
    </div>
  )
}

function Skills({ repoId }: { repoId: string }) {
  const [list, setList] = useState<LocalSkill[] | null>(null)
  useEffect(() => {
    setList(null)
    void window.api.localSkills(repoId).then(setList, (e) => {
      reportError(e)
      setList([])
    })
  }, [repoId])
  if (!list) return <div className="px-5 py-4 text-[12px] text-faint">Loading…</div>
  if (!list.length)
    return <div className="px-5 py-4 text-[12px] text-faint">No skills, commands or agents in ~/.claude or this repo's .claude folder. Plugins bring their own; see Installed.</div>
  return (
    <div>
      {list.map((s) => (
        <div key={s.path} className="group flex items-start gap-3 border-b border-line px-5 py-2.5 last:border-0">
          <span className="mt-0.5 w-14 shrink-0 text-[11px] text-faint capitalize">{s.kind}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px]">{s.kind === 'agent' ? `@${s.name}` : `/${s.name}`}</span>
              <span className="text-[11px] text-faint">{s.scope === 'user' ? 'You, every repo' : 'This repo'}</span>
            </div>
            {s.description && <div className="line-clamp-2 text-[12px] text-faint">{s.description}</div>}
          </div>
          <button className="hidden shrink-0 text-[12px] text-muted group-hover:block hover:text-fg" onClick={() => void window.api.revealPath(s.path)}>
            Show in Finder
          </button>
        </div>
      ))}
    </div>
  )
}
