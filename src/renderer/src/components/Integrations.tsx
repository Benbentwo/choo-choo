import { useEffect, useState } from 'react'
import type { IntegrationId, IntegrationStatus } from '@shared/types'
import { useStore, reportError } from '../store'

/** Settings > Integrations: one row per sign-in provider. */
export function IntegrationsSettings() {
  const settings = useStore((s) => s.settings)
  const [list, setList] = useState<IntegrationStatus[] | null>(null)
  const [busy, setBusy] = useState<IntegrationId | null>(null)
  useEffect(() => {
    void window.api.listIntegrations().then(setList, reportError)
  }, [])

  const connect = async (id: IntegrationId) => {
    setBusy(id)
    try {
      setList(await window.api.connectIntegration(id))
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
    }
  }
  const disconnect = async (id: IntegrationId) => setList(await window.api.disconnectIntegration(id))

  if (!list) return <div className="px-5 py-4 text-[12px] text-faint">Loading…</div>
  return (
    <>
      <div className="border-b border-line px-5 py-2.5 text-[12px] text-faint">Sign in once and Choo Choo keeps you signed in. Tokens are encrypted in your macOS keychain.</div>
      {list.map((p) => (
        <div key={p.id} className="border-b border-line px-5 py-3.5 last:border-0">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <div>{p.label}</div>
              <div className="mt-0.5 text-[12px] text-faint">{p.connected ? `Connected${p.account ? ` as ${p.account}` : ''}. ` : ''}{p.description}</div>
            </div>
            <div className="shrink-0">
              {p.connected ? (
                <button className="rounded-md border border-line px-2.5 py-1 text-muted hover:text-fg" onClick={() => void disconnect(p.id)}>
                  Disconnect
                </button>
              ) : (
                <button className="rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 text-accent hover:bg-accent/25 disabled:opacity-60" disabled={busy === p.id} onClick={() => void connect(p.id)}>
                  {busy === p.id ? 'Waiting for browser…' : 'Sign in'}
                </button>
              )}
            </div>
          </div>
          {p.id === 'notion' && p.connected && (
            <label className="mt-2.5 flex items-center gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={settings.notionAgentTools}
                onChange={async (e) => useStore.getState().set({ settings: await window.api.saveSettings({ notionAgentTools: e.target.checked }) })}
              />
              Give agents Notion tools (search, read and edit pages) in new turns
            </label>
          )}
        </div>
      ))}
    </>
  )
}
