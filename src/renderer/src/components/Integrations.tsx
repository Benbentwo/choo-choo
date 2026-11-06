import { useEffect, useState } from 'react'
import type { IntegrationId, IntegrationStatus } from '@shared/types'
import { reportError, useStore } from '../store'

/** Settings → Integrations: one row per service, each signed in through the browser (OAuth). */
export function IntegrationsSettings() {
  const list = useIntegrations()
  const notionTools = useStore((s) => s.settings.notionAgentTools)
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
  if (!list.items) return <div className="px-5 py-4 text-[12px] text-faint">Loading…</div>
  return (
    <div>
      {list.items.map((i) => (
        <div key={i.id} className="flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-0">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {i.label}
              {i.connected && <span className="rounded bg-raised px-1.5 py-px text-[11px] text-muted">Connected</span>}
            </div>
            <div className="mt-0.5 text-[12px] text-faint">{i.connected && i.account ? `Signed in as ${i.account}.` : i.description}</div>
            {busy === i.id && <div className="mt-1 text-[12px] text-muted">Finish signing in in your browser…</div>}
            {!i.configured && !i.connected && <div className="mt-1 text-[12px] text-faint">Sign-in isn't available in this build yet.</div>}
            {i.id === 'notion' && i.connected && (
              <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                <input
                  type="checkbox"
                  checked={notionTools}
                  onChange={async (e) => useStore.getState().set({ settings: await window.api.saveSettings({ notionAgentTools: e.target.checked }) })}
                />
                Give agents Notion tools (search, read and edit pages)
              </label>
            )}
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
