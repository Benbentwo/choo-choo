/**
 * MCP servers as Claude Code sees them for a repo: status, tools, add, remove, turn on or off.
 * Everything goes through the official Claude Code binary (`claude mcp …`) or an Agent SDK query,
 * so servers configured here work the same in the terminal.
 */
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { McpAddSpec, McpServerView } from '@shared/types'
import { claudeExecutable } from './claudeBinary'
import { runClaude } from './claudeCli'

let sdk: Promise<typeof import('@anthropic-ai/claude-agent-sdk')> | null = null
const loadSdk = () => (sdk ??= import('@anthropic-ai/claude-agent-sdk'))

const NAME = /^[A-Za-z0-9_.-]{1,64}$/

/** Arguments for `claude mcp add`. Throws on input Claude Code would reject or misread. */
export function mcpAddArgs(spec: McpAddSpec): string[] {
  const name = spec.name.trim()
  if (!NAME.test(name)) throw new Error('Use letters, numbers, dots, dashes or underscores for the name')
  const target = spec.target.trim()
  if (!target) throw new Error(spec.transport === 'stdio' ? 'Enter the command that starts the server' : 'Enter the server URL')
  // -e and -H take several values, so they go after the name: anything after them would be read as one more value.
  const args = ['mcp', 'add', '-s', spec.scope, '-t', spec.transport, name]
  const pairs = (text: string | undefined) =>
    (text ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  if (spec.transport === 'stdio') {
    for (const e of pairs(spec.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(e)) throw new Error(`Environment lines look like KEY=value: ${e}`)
      args.push('-e', e)
    }
    args.push('--', ...splitCommand(target))
  } else {
    if (!/^https?:\/\//i.test(target)) throw new Error('The URL must start with http:// or https://')
    args.push(target)
    for (const h of pairs(spec.headers)) {
      if (!/^[A-Za-z0-9-]+:\s*\S/.test(h)) throw new Error(`Header lines look like Name: value: ${h}`)
      args.push('-H', h)
    }
  }
  return args
}

/** Splits a command line on spaces, keeping quoted parts together. */
export function splitCommand(cmd: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** Arguments for `claude mcp remove`. Only scopes Claude Code's own config holds can be removed. */
export function mcpRemoveArgs(name: string, scope: string): string[] {
  if (!['user', 'project', 'local'].includes(scope)) throw new Error('This server comes from a plugin or your claude.ai account. Turn it off instead.')
  return ['mcp', 'remove', name, '-s', scope]
}

/** The view of one server from the SDK's mcpServerStatus(). */
export function toView(s: any): McpServerView {
  const cfg = s.config ?? {}
  const source: string = s.source ?? s.scope ?? 'unknown'
  return {
    name: s.name,
    status: s.status,
    scope: s.scope ?? source,
    source,
    error: s.error,
    transport: cfg.type ?? (cfg.url ? 'http' : 'stdio'),
    target: cfg.url ?? [cfg.command, ...(cfg.args ?? [])].filter(Boolean).join(' '),
    tools: (s.tools ?? []).map((t: { name: string; description?: string }) => ({ name: t.name, description: t.description })),
    removable: ['user', 'project', 'local'].includes(source)
  }
}

/**
 * Runs `fn` against an idle Claude Code session in `cwd` that loads the same settings as agents,
 * then closes it. No message is sent, so it uses no tokens.
 */
async function withSession<T>(cwd: string, env: Record<string, string>, fn: (q: any) => Promise<T>): Promise<T> {
  const { query } = await loadSdk()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  async function* idle() {
    await gate
  }
  const abort = new AbortController()
  const q = query({
    prompt: idle(),
    options: {
      abortController: abort,
      cwd: cwd || tmpdir(),
      pathToClaudeCodeExecutable: claudeExecutable(),
      persistSession: false,
      settingSources: ['user', 'project', 'local'],
      env: { ...process.env, ...env }
    } as never
  }) as any
  try {
    return await fn(q)
  } finally {
    release()
    abort.abort()
  }
}

/** Waits until no server is still connecting (or 20 seconds), then returns every server. */
async function settledStatus(q: any): Promise<McpServerView[]> {
  const deadline = Date.now() + 20_000
  for (;;) {
    const list: any[] = await q.mcpServerStatus()
    if (!list.some((s) => s.status === 'pending') || Date.now() > deadline) return list.map(toView)
    await new Promise((r) => setTimeout(r, 500))
  }
}

export function status(cwd: string, env: Record<string, string>) {
  return withSession(cwd, env, settledStatus)
}

export async function add(cwd: string, env: Record<string, string>, spec: McpAddSpec) {
  await runClaude(mcpAddArgs(spec), cwd, env)
  return status(cwd, env)
}

export async function remove(cwd: string, env: Record<string, string>, name: string, scope: string) {
  await runClaude(mcpRemoveArgs(name, scope), cwd, env)
  return status(cwd, env)
}

/** Turns a server on or off for this repo. Claude Code remembers it in ~/.claude.json, for the terminal too. */
export function toggle(cwd: string, env: Record<string, string>, name: string, enabled: boolean) {
  return withSession(cwd, env, async (q) => {
    await q.toggleMcpServer(name, enabled)
    return settledStatus(q)
  })
}

export function reconnect(cwd: string, env: Record<string, string>, name: string) {
  return withSession(cwd, env, async (q) => {
    await settledStatus(q)
    await q.reconnectMcpServer(name).catch(() => undefined)
    return settledStatus(q)
  })
}

/** AppleScript that opens Terminal in `cwd` and starts Claude Code's /mcp screen, where servers sign in. */
export function signInScript(cwd: string, bin: string): string {
  const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const cmd = `cd ${sh(cwd)} && ${sh(bin)} /mcp`
  return `tell application "Terminal"\nactivate\ndo script "${cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\nend tell`
}

/** Opens Terminal with `claude /mcp`, where the person signs in to servers that need it. */
export function openSignIn(cwd: string) {
  if (process.platform !== 'darwin') throw new Error('Run `claude` in this repo and type /mcp to sign in.')
  spawn('osascript', ['-e', signInScript(cwd, claudeExecutable() ?? 'claude')], { detached: true, stdio: 'ignore' }).unref()
}
