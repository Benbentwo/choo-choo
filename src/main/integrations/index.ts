import type { IntegrationId, IntegrationStatus } from '@shared/types'
import * as notion from './notion'

/** Sign-in integrations shown under Settings > Integrations. */
interface Provider {
  id: IntegrationId
  label: string
  description: string
  connected(): boolean
  account(): string | undefined
  connect(): Promise<unknown>
  disconnect(): void
}

const providers: Provider[] = [
  {
    id: 'notion',
    label: 'Notion',
    description: 'Start a workspace from a Notion page or task, and let agents read and update Notion.',
    connected: notion.connected,
    account: notion.account,
    connect: notion.connect,
    disconnect: notion.disconnect
  }
]

export function list(): IntegrationStatus[] {
  return providers.map((p) => ({ id: p.id, label: p.label, description: p.description, connected: p.connected(), account: p.account() }))
}

function find(id: IntegrationId) {
  const p = providers.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown integration: ${id}`)
  return p
}

export async function connect(id: IntegrationId) {
  await find(id).connect()
  return list()
}

export function disconnect(id: IntegrationId) {
  find(id).disconnect()
  return list()
}
