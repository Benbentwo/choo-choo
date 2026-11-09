import { useEffect, useState } from 'react'
import type { IntegrationId, IntegrationStatus, McpServerView } from '@shared/types'
import { reportError, useStore } from '../store'

/** Claude Code's Notion server among its MCP servers, preferring one that is connected. */
export function notionServer(servers: McpServerView[]): McpServerView | undefined {
  const isNotion = (s: McpServerView) => {
    try {
      return new URL(s.target).hostname === 'mcp.notion.com'
    } catch {
      return /\bnotion\b/i.test(s.name)
    }
  }
  const all = servers.filter(isNotion)
  return all.find((s) => s.status === 'connected') ?? all[0]
}

/**
 * Notion has no sign-in of its own here: agents use the Notion connection Claude Code already has
 * (a claude.ai connector or a server from `claude mcp add`). This row only reports its status.
 */
function NotionRow() {
  const repoId = useStore((s) => s.workspaces.find((w) => w.id === s.selectedWs)?.repoId ?? s.repos.find((r) => !r.hidden)?.id)
  const [server, setServer] = useState<McpServerView | null | undefined>(undefined)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setServer(undefined)
    if (!repoId) return
    window.api.mcpStatus(repoId).then(
      (list) => live && setServer(notionServer(list) ?? null),
      () => live && setServer(null)
    )
    return () => {
      live = false
    }
  }, [repoId, tick])
  const connected = server?.status === 'connected'
  const badge = !repoId ? null : server === undefined ? 'Checking…' : connected ? 'Connected' : server?.status === 'disabled' ? 'Turned off' : server ? 'Needs sign-in' : 'Not set up'
  return (
    <div className="flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          Notion
          {badge && <span className="rounded bg-raised px-1.5 py-px text-[11px] text-muted">{badge}</span>}
        </div>
        <div className="mt-0.5 text-[12px] text-faint">
          Uses the Notion connection Claude already has, so there is no separate sign-in. Paste a Notion page or task link in a new workspace to start from it; agents read and update Notion with
          Claude's Notion tools.
        </div>
        {repoId && server !== undefined && !connected && (
          <div className="mt-1 text-[12px] text-muted">
            {server?.status === 'disabled' ? 'Turn Notion back on under Settings > MCP.' : 'Connect Notion under Connectors at claude.ai, or sign in to it from Claude Code.'}
          </div>
        )}
      </div>
      {repoId && server !== undefined && (
        <div className="flex shrink-0 gap-2">
          {!connected && server?.status !== 'disabled' && (
            <button className="rounded-md bg-fg px-2.5 py-1 font-medium text-bg" onClick={() => void window.api.mcpSignIn(repoId).catch(reportError)}>
              Sign in with Claude Code
            </button>
          )}
          <button className="rounded-md border border-line px-2.5 py-1 text-muted hover:bg-hover hover:text-fg" onClick={() => setTick((t) => t + 1)}>
            Check again
          </button>
        </div>
      )}
    </div>
  )
}

/** Settings → Integrations: Notion through Claude's own connection, then one row per service Choo Choo signs in to itself (OAuth). */
export function IntegrationsSettings() {
  const list = useIntegrations()
  const [busy, setBusy] = useState<IntegrationId | null>(null)
  const connect = async (id: IntegrationId) => {
    setBusy(id)
    try {
      await window.api.connectIntegration(id)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
      list.refresh()
    }
  }
  const disconnect = async (id: IntegrationId) => {
    await window.api.disconnectIntegration(id).catch(reportError)
    list.refresh()
  }
  return (
    <div>
      <NotionRow />
      {list.items?.map((i) => (
        <div key={i.id} className="flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-0">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {i.label}
              {i.connected && <span className="rounded bg-raised px-1.5 py-px text-[11px] text-muted">Connected</span>}
            </div>
            <div className="mt-0.5 text-[12px] text-faint">{i.connected && i.account ? `Signed in as ${i.account}.` : i.description}</div>
            {busy === i.id && <div className="mt-1 text-[12px] text-muted">Finish signing in in your browser…</div>}
            {!i.configured && !i.connected && <div className="mt-1 text-[12px] text-faint">Sign-in isn't available in this build yet.</div>}
          </div>
          <div className="shrink-0">
            {i.connected ? (
              <button className="rounded-md border border-line px-2.5 py-1 text-muted hover:bg-hover hover:text-fg" onClick={() => void disconnect(i.id)}>
                Sign out
              </button>
            ) : (
              <button
                disabled={!i.configured || busy === i.id}
                className="rounded-md bg-fg px-2.5 py-1 font-medium text-bg disabled:opacity-50"
                onClick={() => void connect(i.id)}
              >
                {busy === i.id ? 'Waiting…' : `Sign in to ${i.label}`}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function useIntegrations() {
  const [items, setItems] = useState<IntegrationStatus[] | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => window.api.onStateChanged(() => setTick((t) => t + 1)), [])
  useEffect(() => {
    let live = true
    void window.api.listIntegrations().then((r) => live && setItems(r))
    return () => {
      live = false
    }
  }, [tick])
  return { items, refresh: () => setTick((t) => t + 1) }
}
