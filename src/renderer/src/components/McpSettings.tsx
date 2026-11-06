import { useEffect, useState } from 'react'
import type { McpAddSpec, McpServerView } from '@shared/types'
import { reportError, useStore } from '../store'

const STATUS: Record<McpServerView['status'], { label: string; dot: string }> = {
  connected: { label: 'Connected', dot: 'bg-emerald-400' },
  failed: { label: 'Failed', dot: 'bg-del' },
  'needs-auth': { label: 'Needs sign-in', dot: 'bg-amber-400' },
  pending: { label: 'Connecting', dot: 'bg-faint' },
  disabled: { label: 'Off', dot: 'bg-line' }
}

const SOURCE: Record<string, string> = {
  user: 'You, every repo',
  project: "This repo's .mcp.json",
  local: 'You, this repo only',
  claudeai: 'claude.ai connector',
  plugin: 'Plugin',
  managed: 'Managed by your organization',
  enterprise: 'Managed by your organization'
}

const field = 'w-full rounded-md border border-line bg-bg px-2 py-1 outline-none'

/** Settings → MCP: the MCP servers Claude Code loads for a repo, with status, tools and controls. */
export function McpSettings() {
  const allRepos = useStore((s) => s.repos)
  const repos = allRepos.filter((r) => !r.hidden)
  const current = useStore((s) => s.workspaces.find((w) => w.id === s.selectedWs)?.repoId)
  const [repoId, setRepoId] = useState(() => current ?? repos[0]?.id ?? '')
  const [servers, setServers] = useState<McpServerView[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const run = async (key: string, fn: () => Promise<McpServerView[] | void>) => {
    setBusy(key)
    try {
      const list = await fn()
      if (list) setServers(list)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
    }
  }
  const refresh = () => run('refresh', () => window.api.mcpStatus(repoId))

  useEffect(() => {
    setServers(null)
    if (repoId) void refresh()
  }, [repoId])

  if (!repos.length) return <div className="px-5 py-4 text-[12px] text-faint">Add a repository first.</div>

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-[12px]">
        <span className="text-faint">Servers Claude Code loads in</span>
        <select className="rounded-md border border-line bg-bg px-2 py-0.5 outline-none" value={repoId} onChange={(e) => setRepoId(e.target.value)}>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button className="text-muted hover:text-fg disabled:opacity-40" disabled={!!busy} onClick={() => void refresh()}>
          {busy === 'refresh' ? 'Checking…' : 'Refresh'}
        </button>
        <button className="rounded-md border border-line px-2 py-0.5 hover:bg-hover" onClick={() => setAdding(!adding)}>
          Add server
        </button>
      </div>
      {adding && (
        <AddServer
          busy={busy === 'add'}
          onCancel={() => setAdding(false)}
          onAdd={(spec) =>
            void run('add', async () => {
              const list = await window.api.mcpAdd(repoId, spec)
              setAdding(false)
              return list
            })
          }
        />
      )}
      {!servers && <div className="px-5 py-4 text-[12px] text-faint">Starting Claude Code to check servers…</div>}
      {servers?.length === 0 && (
        <div className="px-5 py-4 text-[12px] text-faint">No MCP servers yet. Add one here, or with `claude mcp add` in Terminal; both end up in the same place.</div>
      )}
      {servers?.map((s) => {
        const st = STATUS[s.status] ?? STATUS.failed
        const key = `${s.source}:${s.name}`
        return (
          <div key={key} className="border-b border-line px-5 py-3 last:border-0">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} title={st.label} />
              <button className="min-w-0 truncate text-left font-medium hover:underline" onClick={() => setOpen(open === key ? null : key)}>
                {s.name}
              </button>
              <span className="shrink-0 text-[11px] text-faint">{SOURCE[s.source] ?? s.source}</span>
              <div className="flex-1" />
              {s.status === 'needs-auth' && (
                <button className="text-[12px] text-amber-400 hover:underline" onClick={() => void run(key, () => window.api.mcpSignIn(repoId))} title="Opens Terminal on Claude Code's /mcp screen">
                  Sign in…
                </button>
              )}
              {s.status === 'failed' && (
                <button className="text-[12px] text-muted hover:text-fg disabled:opacity-40" disabled={!!busy} onClick={() => void run(key, () => window.api.mcpReconnect(repoId, s.name))}>
                  Retry
                </button>
              )}
              {s.removable && (
                <button
                  className="text-[12px] text-faint hover:text-del disabled:opacity-40"
                  disabled={!!busy}
                  onClick={() => {
                    if (removing !== key) return setRemoving(key)
                    setRemoving(null)
                    void run(key, () => window.api.mcpRemove(repoId, s.name, s.source))
                  }}
                  onMouseLeave={() => removing === key && setRemoving(null)}
                >
                  {removing === key ? 'Click again to remove' : 'Remove'}
                </button>
              )}
              <input
                type="checkbox"
                title={s.status === 'disabled' ? 'Turn on for this repo' : 'Turn off for this repo'}
                checked={s.status !== 'disabled'}
                disabled={!!busy}
                onChange={(e) => void run(key, () => window.api.mcpToggle(repoId, s.name, e.target.checked))}
              />
            </div>
            <div className="mt-0.5 truncate pl-4 font-mono text-[11px] text-faint" title={s.target}>
              {busy === key ? 'Working…' : `${st.label} · ${s.transport}${s.target ? ` · ${s.target}` : ''}${s.tools.length ? ` · ${s.tools.length} tools` : ''}`}
            </div>
            {s.error && <div className="mt-1 pl-4 text-[12px] text-del">{s.error}</div>}
            {open === key && s.tools.length > 0 && (
              <div className="mt-2 ml-4 rounded-md border border-line">
                {s.tools.map((t) => (
                  <div key={t.name} className="border-b border-line px-2.5 py-1.5 text-[12px] last:border-0">
                    <span className="font-mono">{t.name}</span>
                    {t.description && <div className="line-clamp-2 text-faint">{t.description}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AddServer({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (spec: McpAddSpec) => void; onCancel: () => void }) {
  const [spec, setSpec] = useState<McpAddSpec>({ name: '', scope: 'user', transport: 'http', target: '', env: '', headers: '' })
  const set = (patch: Partial<McpAddSpec>) => setSpec({ ...spec, ...patch })
  const stdio = spec.transport === 'stdio'
  return (
    <div className="space-y-2 border-b border-line bg-raised/40 px-5 py-3 text-[12px]">
      <div className="flex gap-2">
        <input className={field} placeholder="Name, e.g. sentry" value={spec.name} onChange={(e) => set({ name: e.target.value })} />
        <select className="rounded-md border border-line bg-bg px-2 py-1 outline-none" value={spec.transport} onChange={(e) => set({ transport: e.target.value as McpAddSpec['transport'] })}>
          <option value="http">HTTP</option>
          <option value="sse">SSE</option>
          <option value="stdio">Command (stdio)</option>
        </select>
        <select className="rounded-md border border-line bg-bg px-2 py-1 outline-none" value={spec.scope} onChange={(e) => set({ scope: e.target.value as McpAddSpec['scope'] })} title="Every repo, or this repo's .mcp.json (commit it to share)">
          <option value="user">Every repo</option>
          <option value="project">This repo (.mcp.json)</option>
        </select>
      </div>
      <input
        className={`${field} font-mono`}
        placeholder={stdio ? 'npx -y @modelcontextprotocol/server-filesystem ~/notes' : 'https://mcp.example.com/mcp'}
        value={spec.target}
        onChange={(e) => set({ target: e.target.value })}
      />
      <textarea
        className={`${field} font-mono`}
        rows={2}
        placeholder={stdio ? 'Environment, one KEY=value per line (optional)' : 'Headers, one Name: value per line (optional). Servers with OAuth need none: sign in after adding.'}
        value={stdio ? spec.env : spec.headers}
        onChange={(e) => set(stdio ? { env: e.target.value } : { headers: e.target.value })}
      />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-faint">Saved by Claude Code, so it works in Terminal too. Project servers go in .mcp.json in the main checkout; commit it so workspaces get it, and keep secrets out of it.</span>
        <button className="text-muted hover:text-fg" onClick={onCancel}>
          Cancel
        </button>
        <button className="rounded-md bg-fg px-2.5 py-1 font-medium text-bg disabled:opacity-40" disabled={busy || !spec.name.trim() || !spec.target.trim()} onClick={() => onAdd(spec)}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  )
}
