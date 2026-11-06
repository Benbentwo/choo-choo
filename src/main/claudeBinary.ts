import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import * as store from './store'

let bundled: string | null | undefined

/**
 * The SDK ships the Claude Code binary in a per-platform package. In a packaged app that file sits in
 * app.asar.unpacked, which the SDK cannot find on its own, so we point it there.
 */
function bundledExecutable(): string | undefined {
  if (bundled !== undefined) return bundled ?? undefined
  bundled = null
  try {
    const pkg = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
    const bin = join(dirname(pkg), process.platform === 'win32' ? 'claude.exe' : 'claude').replace(`app.asar${'/'}`, 'app.asar.unpacked/')
    if (existsSync(bin)) bundled = bin
  } catch {
    /* let the SDK resolve it */
  }
  return bundled ?? undefined
}

/** The `claude` you installed yourself: first on PATH, then the usual install locations. */
export function installedExecutable(path = process.env.PATH ?? '', home = homedir()): string | undefined {
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const dirs = [...path.split(delimiter).filter(Boolean), join(home, '.local', 'bin'), join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin']
  for (const d of dirs) {
    const p = join(d, name)
    if (existsSync(p)) return p
  }
  return undefined
}

/** The Claude Code binary to run, following the Settings choice. Falls back to the bundled one if yours isn't found. */
export function claudeExecutable(): string | undefined {
  if (store.get().settings.claudeBinary === 'installed') return installedExecutable() ?? bundledExecutable()
  return bundledExecutable()
}
