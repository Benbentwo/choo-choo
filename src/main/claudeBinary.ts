import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

let cached: string | null | undefined

/**
 * The SDK ships the Claude Code binary in a per-platform package. In a packaged app that file sits in
 * app.asar.unpacked, which the SDK cannot find on its own, so we point it there.
 */
export function claudeExecutable(): string | undefined {
  if (cached !== undefined) return cached ?? undefined
  cached = null
  try {
    const pkg = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
    const bin = join(dirname(pkg), process.platform === 'win32' ? 'claude.exe' : 'claude').replace(`app.asar${'/'}`, 'app.asar.unpacked/')
    if (existsSync(bin)) cached = bin
  } catch {
    /* let the SDK resolve it */
  }
  return cached ?? undefined
}
