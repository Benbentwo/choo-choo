import { execFile } from 'node:child_process'
import { claudeExecutable } from './claudeBinary'

export interface CliResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** Runs the same Claude Code binary agents use, such as `claude mcp add` or `claude plugin list`. */
export function runClaudeCli(args: string[], cwd: string, env: Record<string, string>, timeout = 120_000): Promise<CliResult> {
  const bin = claudeExecutable() ?? 'claude'
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, env: { ...process.env, ...env }, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && !stdout ? err.message : '') })
    })
  })
}

/** Like runClaudeCli, but throws Claude Code's own message when the command fails. */
export async function runClaude(args: string[], cwd: string, env: Record<string, string>, timeout?: number): Promise<string> {
  const r = await runClaudeCli(args, cwd, env, timeout)
  if (!r.ok) throw new Error(lastJson(r.stdout)?.message || (r.stderr || r.stdout).trim() || 'Claude Code failed')
  return r.stdout
}

/** The last line of output that parses as a JSON object, as `--json` commands print. */
export function lastJson(text: string): any {
  const lines = text.trim().split('\n').reverse()
  for (const l of lines) {
    const t = l.trim()
    if (!t.startsWith('{')) continue
    try {
      return JSON.parse(t)
    } catch {
      /* not JSON */
    }
  }
  return undefined
}
