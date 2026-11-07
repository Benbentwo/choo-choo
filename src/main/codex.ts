import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ChatItem, Effort } from '@shared/types'

export interface CodexRun {
  cwd: string
  prompt: string
  effort: Effort
  /** Plan mode: read-only sandbox, no edits. */
  readOnly?: boolean
  threadId?: string
  images: string[]
  env: Record<string, string>
  signal: AbortSignal
  onThread(id: string): void
  put(item: ChatItem): void
}

/** Arguments for `codex exec --json`, resuming a thread when we have one. */
/** Codex has no "max" effort; its highest is xhigh. */
export function codexEffort(e: Effort): string {
  return e === 'max' ? 'xhigh' : e
}

export function codexArgs(o: { cwd: string; effort: Effort; readOnly?: boolean; threadId?: string; imagePaths: string[]; prompt: string }): string[] {
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    // Same trust model as the Claude agents: unattended inside an isolated worktree.
    ...(o.readOnly ? ['-s', 'read-only'] : ['--dangerously-bypass-approvals-and-sandbox']),
    '-C',
    o.cwd,
    '-c',
    `model_reasoning_effort="${codexEffort(o.effort)}"`
  ]
  if (o.threadId) args.push('resume', o.threadId)
  for (const p of o.imagePaths) args.push('-i', p)
  args.push(o.prompt)
  return args
}

/** Maps one `codex exec --json` event to a chat item, or null when it has nothing to show. */
export function codexItem(ev: any, now = Date.now()): ChatItem | null {
  const item = ev?.item
  if (ev?.type === 'turn.failed') return { id: `err-${now}`, kind: 'error', text: ev.error?.message ?? 'Codex turn failed', ts: now }
  if (ev?.type === 'error') return { id: `err-${now}`, kind: 'error', text: ev.message ?? 'Codex error', ts: now }
  if (!item || !['item.started', 'item.updated', 'item.completed'].includes(ev.type)) return null
  const done = ev.type === 'item.completed'
  switch (item.type) {
    case 'agent_message':
      return { id: item.id, kind: 'assistant', text: item.text ?? '', streaming: !done, ts: now }
    case 'command_execution':
      return {
        id: item.id,
        kind: 'tool',
        name: 'Bash',
        input: { command: item.command },
        result: done || item.status !== 'in_progress' ? (item.aggregated_output ?? '') : undefined,
        isError: item.status === 'failed' || (item.exit_code != null && item.exit_code !== 0),
        ts: now
      }
    case 'file_change':
      return {
        id: item.id,
        kind: 'tool',
        name: 'Edit',
        input: { file_path: (item.changes ?? []).map((c: { path: string }) => c.path).join(', '), changes: item.changes },
        result: done ? (item.status === 'failed' ? 'Patch failed' : 'Applied') : undefined,
        isError: item.status === 'failed',
        ts: now
      }
    case 'mcp_tool_call':
      return {
        id: item.id,
        kind: 'tool',
        name: `${item.server}.${item.tool}`,
        input: item.arguments,
        result: done ? JSON.stringify(item.result?.content ?? item.error?.message ?? '') : undefined,
        isError: !!item.error,
        ts: now
      }
    case 'web_search':
      return { id: item.id, kind: 'tool', name: 'WebSearch', input: { query: item.query }, result: done ? '' : undefined, ts: now }
    case 'todo_list':
      return {
        id: item.id,
        kind: 'tool',
        name: 'TodoWrite',
        input: item.items,
        result: (item.items ?? []).map((t: { text: string; completed: boolean }) => `${t.completed ? '✓' : '○'} ${t.text}`).join('\n'),
        ts: now
      }
    case 'error':
      return { id: item.id, kind: 'error', text: item.message, ts: now }
    default:
      return null
  }
}

/** Runs one Codex turn. Resolves with usage when the turn completes; rejects on failure or abort. */
export function runCodex(o: CodexRun): Promise<{ ok: boolean; usage?: { input_tokens: number; output_tokens: number } }> {
  const dir = mkdtempSync(join(tmpdir(), 'choo-codex-'))
  const imagePaths = o.images.map((url, i) => {
    const m = url.match(/^data:image\/(png|jpeg|gif|webp);base64,(.+)$/)
    if (!m) return null
    const p = join(dir, `image-${i}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`)
    writeFileSync(p, Buffer.from(m[2], 'base64'))
    return p
  }).filter((p): p is string => !!p)

  return new Promise((resolve, reject) => {
    const proc = spawn('codex', codexArgs({ cwd: o.cwd, effort: o.effort, readOnly: o.readOnly, threadId: o.threadId, imagePaths, prompt: o.prompt }), {
      cwd: o.cwd,
      env: { ...process.env, ...o.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stderr = ''
    let result: { ok: boolean; usage?: { input_tokens: number; output_tokens: number } } = { ok: false }
    const onAbort = () => proc.kill('SIGINT')
    o.signal.addEventListener('abort', onAbort)
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
    createInterface({ input: proc.stdout }).on('line', (line) => {
      let ev: any
      try {
        ev = JSON.parse(line)
      } catch {
        return
      }
      if (ev.type === 'thread.started' && ev.thread_id) o.onThread(ev.thread_id)
      if (ev.type === 'turn.completed') result = { ok: true, usage: ev.usage }
      const item = codexItem(ev)
      if (item) o.put(item)
    })
    proc.on('error', (e) => {
      cleanup()
      reject(new Error((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'Codex CLI not found. Install it with `npm i -g @openai/codex` and run `codex login`.' : e.message))
    })
    proc.on('close', (code) => {
      cleanup()
      if (o.signal.aborted) return reject(new Error('Stopped'))
      if (code !== 0 && !result.ok) return reject(new Error(stderr.trim() || `codex exited with code ${code}`))
      resolve(result)
    })
    function cleanup() {
      o.signal.removeEventListener('abort', onAbort)
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
