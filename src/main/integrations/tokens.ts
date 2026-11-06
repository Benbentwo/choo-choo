import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Integration tokens, encrypted with the macOS keychain (Electron safeStorage), in userData/data/integrations.json. */

const file = () => join(app.getPath('userData'), 'data', 'integrations.json')
let cache: Record<string, string> | null = null

function all(): Record<string, string> {
  if (!cache) cache = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {}
  return cache!
}

function write() {
  mkdirSync(join(app.getPath('userData'), 'data'), { recursive: true })
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(all()), { mode: 0o600 })
  renameSync(tmp, file())
}

export function get<T>(id: string): T | undefined {
  const v = all()[id]
  if (!v) return undefined
  try {
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : Buffer.from(v, 'base64').toString()
    return JSON.parse(json) as T
  } catch {
    return undefined
  }
}

export function set<T>(id: string, value: T) {
  const json = JSON.stringify(value)
  all()[id] = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json)).toString('base64')
  write()
}

export function remove(id: string) {
  delete all()[id]
  write()
}
