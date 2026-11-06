import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IntegrationId } from '@shared/types'

/** What a provider keeps after sign-in. Stored encrypted with the macOS keychain via safeStorage. */
export interface StoredAuth {
  accessToken: string
  refreshToken?: string
  /** ms since epoch. */
  expiresAt?: number
  /** Shown in Settings, e.g. "Ben Smith · Acme". */
  account?: string
  /** Anything else the provider needs (client id from dynamic registration, workspace id, …). */
  extra?: Record<string, string>
}

const file = () => join(app.getPath('userData'), 'data', 'integrations.json')
let cache: Partial<Record<IntegrationId, string>> | null = null

function readAll() {
  if (!cache) cache = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {}
  return cache!
}

function writeAll() {
  mkdirSync(join(app.getPath('userData'), 'data'), { recursive: true })
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(readAll()), { mode: 0o600 })
  renameSync(tmp, file())
}

export function getAuth(id: IntegrationId): StoredAuth | null {
  const blob = readAll()[id]
  if (!blob) return null
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(blob, 'base64'))) as StoredAuth
  } catch {
    return null
  }
}

export function setAuth(id: IntegrationId, auth: StoredAuth) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available, so the sign-in cannot be saved')
  readAll()[id] = safeStorage.encryptString(JSON.stringify(auth)).toString('base64')
  writeAll()
}

export function clearAuth(id: IntegrationId) {
  delete readAll()[id]
  writeAll()
}
