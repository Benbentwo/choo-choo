import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Scripts } from '@shared/types'

// Conductor reads conductor.json; we read choo-choo.json first and fall back to it.
const FILES = ['choo-choo.json', 'conductor.json']

export function parseScripts(json: string): Scripts {
  const raw = JSON.parse(json) as { scripts?: Record<string, unknown> }
  const sc = raw.scripts ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
  return { setup: str(sc.setup), run: str(sc.run), archive: str(sc.archive) }
}

/** The worktree's copy wins so a branch can change its own scripts; the main checkout is the fallback. */
export function readScripts(...dirs: string[]): Scripts {
  for (const dir of dirs) {
    for (const f of FILES) {
      const p = join(dir, f)
      if (!existsSync(p)) continue
      try {
        return { ...parseScripts(readFileSync(p, 'utf8')), source: f }
      } catch {
        /* invalid JSON: keep looking */
      }
    }
  }
  return {}
}
