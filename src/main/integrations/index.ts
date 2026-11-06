import { ipcMain } from 'electron'
import type { IntegrationId, IntegrationStatus } from '@shared/types'
import { getAuth } from './tokens'
import { linear } from './linear'

/**
 * A service you sign in to from Settings → Integrations. Each provider runs its own OAuth flow
 * (oauth.ts has the shared browser + loopback redirect part) and stores the result with tokens.ts.
 */
export interface Provider {
  id: IntegrationId
  label: string
  description: string
  /** False when this build has no OAuth app for the service. */
  configured(): boolean
  /** Signs in through the browser and saves the token. */
  connect(): Promise<void>
  disconnect(): Promise<void>
}

const providers: Provider[] = [linear]

export function status(p: Provider): IntegrationStatus {
  const auth = getAuth(p.id)
  return { id: p.id, label: p.label, description: p.description, connected: !!auth, account: auth?.account, configured: p.configured() }
}

const find = (id: IntegrationId) => {
  const p = providers.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown integration: ${id}`)
  return p
}

export const isConnected = (id: IntegrationId) => !!getAuth(id)

export function registerIntegrationsIpc(onChange: () => void) {
  const pending = new Map<IntegrationId, Promise<void>>()
  ipcMain.handle('integrations:list', () => providers.map(status))
  ipcMain.handle('integrations:connect', async (_e, id: IntegrationId) => {
    const p = find(id)
    // One sign-in at a time: a second click while the browser is open waits for the first.
    let run = pending.get(id)
    if (!run) {
      run = p.connect().finally(() => pending.delete(id))
      pending.set(id, run)
    }
    await run
    onChange()
    return status(p)
  })
  ipcMain.handle('integrations:disconnect', async (_e, id: IntegrationId) => {
    await find(id).disconnect()
    onChange()
  })
}
