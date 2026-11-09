import { useEffect, useState } from 'react'
import { describePermission, missingGrants, type AddonInfo, type AddonManifest, type AddonSlot, type AddonSource, type AvailableAddon } from '@shared/addons'
import { reportError, useStore } from '../store'

const field = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'
const DOCS = 'https://github.com/Benbentwo/choo-choo/blob/main/docs/addon-api.md'
const WHERE: Record<AddonSlot, string> = { app: 'in the sidebar', repo: 'under each project', workspace: 'as a tab beside each workspace' }

const STATE_NOTE: Partial<Record<AddonInfo['state'], string>> = {
  review: 'Paused: it asks for new permissions',
  'plugin-off': 'Its plugin is off in Settings › Plugins',
  invalid: "Can't be loaded"
}

/** What turning an add-on on means: the views it adds and each permission in plain words. */
function Asks({ manifest, granted = [] }: { manifest: AddonManifest; granted?: string[] }) {
  const fresh = new Set(granted.length ? missingGrants(manifest, granted) : [])
  return (
    <div className="text-[12px]">
      {manifest.views.length > 0 && (
        <div className="mb-2 text-muted">
          Adds {manifest.views.map((v, i) => `${i ? (i === manifest.views.length - 1 ? ' and ' : ', ') : ''}“${v.title}” ${WHERE[v.slot]}`).join('')}.
        </div>
      )}
      {manifest.permissions.length === 0 ? (
        <div className="text-faint">It asks for no permissions: its views can't see or change anything in Choo Choo.</div>
      ) : (
        <>
          <div className="mb-1 text-faint">It can:</div>
          {manifest.permissions.map((p) => {
            const d = describePermission(p)
            return (
              <div key={p} className="flex gap-2 border-t border-line py-1.5 first:border-0">
                <span className="w-56 shrink-0">
                  {d.label}
                  {fresh.has(p) && <span className="ml-1.5 rounded bg-amber-500/15 px-1 text-[10px] text-amber-400">new</span>}
                </span>
                <span className="text-faint">{d.detail}</span>
              </div>
            )
          })}
        </>
      )}
      <div className="mt-2 text-faint">
        Views run in a sandbox: they can't read files, run commands or reach the network beyond what is listed here. The add-on's Claude Code parts (skills, hooks, MCP servers) run with your own permissions, like any plugin.
      </div>
    </div>
  )
}

/** Settings → Add-ons: sources, what they offer, and what is installed and turned on. */
export function AddonSettings() {
  const addons = useStore((s) => s.addons)
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState<AvailableAddon[] | null>(null)
  const [sources, setSources] = useState<AddonSource[] | null>(null)
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  /** The add-on whose permissions are on screen, waiting for Turn on. */
  const [asking, setAsking] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; command: string; sha256: string } | null>(null)

  const load = async () => {
    try {
      useStore.getState().set({ addons: await window.api.addonsList(true) })
      const [a, s] = await Promise.all([window.api.addonsAvailable(), window.api.addonSources()])
      setAvailable(a)
      setSources(s)
    } catch (e) {
      reportError(e)
      setAvailable([])
      setSources([])
    } finally {
      setLoaded(true)
    }
  }
  useEffect(() => {
    void load()
  }, [])

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
  const setEnabled = (a: AddonInfo, on: boolean) =>
    run(a.id, async () => {
      useStore.getState().set({ addons: await window.api.addonSetEnabled(a.id, on, on ? a.manifest?.permissions : undefined) })
      setAsking(null)
    })
  const install = (id: string, acceptSha?: string) =>
    run(id, async () => {
      const r = await window.api.addonInstall(id, acceptSha)
      if (!r.ok) return setConfirm({ id, ...r.confirm })
      setConfirm(null)
      await load()
      // Installed is not on yet: show what it asks for next.
      setAsking(id)
    })

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-[12px] text-faint">
        <span className="flex-1">
          Add-ons are Claude Code plugins that also add views and tools to Choo Choo. They come from sources: git repos you can read, including private ones.{' '}
          <button className="text-muted underline hover:text-fg" onClick={() => void window.api.openExternal(DOCS)}>
            Write your own
          </button>
        </span>
        <button className="rounded-md border border-line px-2 py-0.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-40" disabled={!!busy} onClick={() => void run('refresh', load)}>
          {busy === 'refresh' ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {!loaded && addons.length === 0 && <div className="px-5 py-4 text-[12px] text-faint">Looking for add-ons…</div>}
      {loaded && addons.length === 0 && <div className="px-5 py-4 text-[12px] text-faint">No add-ons installed. Add a source below, then install what it offers.</div>}

      {addons.map((a) => {
        const on = a.state === 'on'
        const show = asking === a.id || open === a.id
        return (
          <div key={a.id} className="border-b border-line px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{a.name}</span>
              <span className="shrink-0 text-[11px] text-faint">
                {a.version && `v${a.version} · `}
                {a.marketplace}
              </span>
              {STATE_NOTE[a.state] && <span className={`rounded px-1.5 py-px text-[11px] ${a.state === 'invalid' ? 'bg-del/15 text-del' : 'bg-amber-500/15 text-amber-400'}`}>{STATE_NOTE[a.state]}</span>}
              <div className="flex-1" />
              {busy === a.id && <span className="text-[12px] text-faint">Working…</span>}
              {a.manifest && (
                <button className="text-[12px] text-faint hover:text-fg" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  Permissions
                </button>
              )}
              <button
                className="text-[12px] text-faint hover:text-del disabled:opacity-40"
                disabled={!!busy}
                onClick={() =>
                  void run(a.id, async () => {
                    await window.api.addonUninstall(a.id)
                    await load()
                  })
                }
              >
                Uninstall
              </button>
              {a.state === 'review' ? (
                <button className="rounded-md bg-fg px-2 py-0.5 text-[12px] font-medium text-bg disabled:opacity-40" disabled={!!busy} onClick={() => setAsking(a.id)}>
                  Review
                </button>
              ) : (
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!!busy || !a.manifest}
                  title={on ? 'Turn off' : 'Turn on'}
                  // Turning on always goes through the permissions panel first.
                  onChange={(e) => (e.target.checked ? setAsking(a.id) : void setEnabled(a, false))}
                />
              )}
            </div>
            {a.description && <div className="mt-0.5 text-[12px] text-faint">{a.description}</div>}
            {a.errors.map((e) => (
              <div key={e} className="mt-1 text-[12px] text-del">
                {e}
              </div>
            ))}
            {show && a.manifest && (
              <div className="mt-2 rounded-md border border-line bg-bg p-3">
                <Asks manifest={a.manifest} granted={a.state === 'review' ? a.granted : []} />
                {asking === a.id && (
                  <div className="mt-3 flex gap-2">
                    <button className="rounded-md bg-fg px-2.5 py-1 text-[12px] font-medium text-bg disabled:opacity-40" disabled={!!busy} onClick={() => void setEnabled(a, true)}>
                      Turn on {a.name}
                    </button>
                    <button className="text-[12px] text-muted hover:text-fg" onClick={() => setAsking(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {available && available.length > 0 && (
        <>
          <div className="border-b border-line px-5 pt-3 pb-1.5 text-[11px] font-medium text-faint">From your sources</div>
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
          {available.map((p) => (
            <div key={p.id} className="border-b border-line px-5 py-2.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-[11px] text-faint">{p.marketplace}</span>
                  </div>
                  <div className="line-clamp-2 text-[12px] text-faint">{p.description}</div>
                </div>
                {p.manifest && (
                  <button className="shrink-0 text-[12px] text-faint hover:text-fg" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    Permissions
                  </button>
                )}
                <button className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[12px] hover:bg-hover disabled:opacity-40" disabled={!!busy} onClick={() => void install(p.id)}>
                  {busy === p.id ? 'Installing…' : 'Install'}
                </button>
              </div>
              {open === p.id && p.manifest && (
                <div className="mt-2 rounded-md border border-line bg-bg p-3">
                  <Asks manifest={p.manifest} />
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 px-5 py-3 text-[12px]">
        <span className="text-faint">Sources:</span>
        {sources?.length === 0 && <span className="text-faint">none yet</span>}
        {sources?.map((m) => (
          <span key={m.name} className="flex items-center gap-1 rounded bg-raised px-1.5 py-0.5" title={m.source}>
            {m.name}
            <button
              className="text-faint hover:text-del"
              title="Remove source"
              disabled={!!busy}
              onClick={() =>
                void run('source', async () => {
                  await window.api.addonRemoveSource(m.name)
                  await load()
                })
              }
            >
              ×
            </button>
          </span>
        ))}
        <input
          className={`${field} min-w-0 flex-1 py-0.5`}
          placeholder="owner/repo or git URL, public or private"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && source.trim() && void addSource()}
        />
        <button className="rounded-md border border-line px-2 py-0.5 hover:bg-hover disabled:opacity-40" disabled={!!busy || !source.trim()} onClick={() => void addSource()}>
          {busy === 'source' ? 'Adding…' : 'Add source'}
        </button>
      </div>
      <div className="px-5 pb-3 text-[12px] text-faint">Sources are Claude Code plugin marketplaces, so the same list shows under Plugins. Private repos use your own git and GitHub access.</div>
    </div>
  )

  function addSource() {
    return run('source', async () => {
      await window.api.addonAddSource(source.trim())
      setSource('')
      await load()
    })
  }
}
