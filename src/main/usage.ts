import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChatContext, SessionUsage, UsagePoint } from '@shared/types'

/**
 * Per-response token usage for a Claude chat, read from the transcript Claude Code keeps at
 * ~/.claude/projects/<project>/<session>.jsonl. Works for every session, including ones from
 * before this feature, and needs no telemetry collector.
 */

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Parses one transcript. A response is written as several lines, one per content block, so lines are merged by message id. */
export function parseTranscript(text: string, subagent = false): { points: UsagePoint[]; compactions: number[]; models: string[] } {
  const byId = new Map<string, UsagePoint>()
  const order: UsagePoint[] = []
  const compactions: number[] = []
  const models = new Set<string>()
  let prompt: string | undefined
  /** A message arrived and no main-chat response has answered it yet. */
  let freshPrompt = false
  const short = (s: string, n = 160) => {
    const t = s.replace(/\s+/g, ' ').trim()
    return t.length > n ? `${t.slice(0, n - 1)}…` : t
  }
  /** Text and tool names in one transcript line of an assistant message. */
  const describe = (content: unknown): { text?: string; tools: string[] } => {
    const tools: string[] = []
    let text: string | undefined
    if (Array.isArray(content))
      for (const b of content) {
        if (b?.type === 'text' && b.text?.trim() && !text) text = short(b.text)
        else if (b?.type === 'tool_use' && b.name) tools.push(String(b.name))
      }
    return { text, tools }
  }
  const didOf = (d: { text?: string; tools: string[] }) => d.text ?? (d.tools.length ? `Used ${[...new Set(d.tools)].join(', ')}` : undefined)
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const ts = Date.parse(e.timestamp)
    if (!Number.isFinite(ts)) continue
    if (e.type === 'system' && e.subtype === 'compact_boundary') {
      compactions.push(ts)
      continue
    }
    if (e.type === 'user' && !e.isSidechain && !e.isMeta) {
      const c = e.message?.content
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join(' ') : ''
      // Tool results also arrive as user lines; only a real message moves the prompt on.
      if (t.trim() && !t.startsWith('<')) {
        prompt = short(t)
        freshPrompt = true
      }
      continue
    }
    if (e.type !== 'assistant' || !e.message?.usage) continue
    // Synthetic messages (errors, interrupts) carry no real usage.
    if (e.message.model === '<synthetic>') continue
    if (typeof e.requestedModel === 'string') models.add(e.requestedModel)
    const u = e.message.usage
    const point: UsagePoint = {
      ts,
      model: String(e.message.model ?? ''),
      input: num(u.input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      output: num(u.output_tokens),
      ...(subagent || e.isSidechain ? { subagent: true } : {}),
      ...(prompt && !subagent && !e.isSidechain ? { prompt } : {})
    }
    const d = describe(e.message.content)
    const id = e.message.id as string | undefined
    const prev = id ? byId.get(id) : undefined
    if (prev) {
      // Later lines of the same response can report the final output count.
      prev.output = Math.max(prev.output, point.output)
      if (!prev.did || (d.text && prev.did.startsWith('Used '))) prev.did = didOf(d) ?? prev.did
      else if (d.tools.length && prev.did.startsWith('Used ')) prev.did = `Used ${[...new Set([...prev.did.slice(5).split(', '), ...d.tools])].join(', ')}`
      continue
    }
    const did = didOf(d)
    if (did) point.did = did
    if (freshPrompt && point.prompt) {
      point.afterMessage = true
      freshPrompt = false
    }
    if (id) byId.set(id, point)
    order.push(point)
  }
  return { points: order, compactions, models: [...models] }
}

/** Tokens in the main context window after a response: what was sent plus what came back. */
export const contextTokens = (p: UsagePoint) => p.input + p.cacheWrite + p.cacheRead + p.output

/** Best guess at the window when Claude Code hasn't told us: 1M models say so, and anything past 200k must be one. */
export function guessContextWindow(points: UsagePoint[], models: string[]): number {
  if (models.some((m) => /\[1m\]/i.test(m))) return 1_000_000
  return points.some((p) => !p.subagent && contextTokens(p) > 200_000) ? 1_000_000 : 200_000
}

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

/** Finds a session's transcript and its subagents' transcripts in any project folder. */
export function transcriptFiles(sessionId: string, root = join(claudeDir(), 'projects')): { main?: string; subagents: string[] } {
  if (!/^[\w-]+$/.test(sessionId) || !existsSync(root)) return { subagents: [] }
  for (const d of readdirSync(root)) {
    const main = join(root, d, `${sessionId}.jsonl`)
    if (!existsSync(main)) continue
    const subDir = join(root, d, sessionId, 'subagents')
    const subagents = existsSync(subDir) ? readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).map((f) => join(subDir, f)) : []
    return { main, subagents }
  }
  return { subagents: [] }
}

export function sessionUsage(sessionId: string | undefined, opts: { contextWindow?: number; costUsd?: number; root?: string } = {}): SessionUsage {
  const base = { compactions: [], contextWindow: opts.contextWindow ?? 200_000, costUsd: opts.costUsd }
  if (!sessionId) return { ...base, points: [], empty: 'No messages yet. Usage shows after the first reply.' }
  const files = transcriptFiles(sessionId, opts.root)
  if (!files.main) return { ...base, points: [], empty: "Claude Code's transcript for this chat wasn't found." }
  const main = parseTranscript(readFileSync(files.main, 'utf8'))
  const points = [...main.points]
  const seen = new Set(points.map((p) => `${p.ts}:${p.output}:${p.cacheRead}`))
  for (const f of files.subagents) {
    try {
      for (const p of parseTranscript(readFileSync(f, 'utf8'), true).points) {
        // Older Claude Code versions also wrote subagent lines into the main file.
        if (!seen.has(`${p.ts}:${p.output}:${p.cacheRead}`)) points.push(p)
      }
    } catch {
      // A subagent file being written can be read half-done; skip it.
    }
  }
  points.sort((a, b) => a.ts - b.ts)
  return {
    points,
    compactions: main.compactions,
    contextWindow: opts.contextWindow ?? guessContextWindow(points, main.models),
    costUsd: opts.costUsd,
    ...(points.length ? {} : { empty: 'No messages yet. Usage shows after the first reply.' })
  }
}

/** What contextNow has read of a transcript so far. */
interface ContextScan {
  /** Bytes read: always up to the end of a complete line. */
  size: number
  compactions: number
  oneM: boolean
  /** Context tokens after the last main-chat response, and that response's id (its lines repeat). */
  used: number
  lastId?: string
}
const scans = new Map<string, ContextScan>()

/** Reads complete lines appended since the last scan. Only compaction and assistant lines are parsed. */
function scanLines(scan: ContextScan, text: string) {
  for (const line of text.split('\n')) {
    const compact = line.includes('compact_boundary')
    if (!compact && !line.includes('"assistant"')) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.type === 'system' && e.subtype === 'compact_boundary') scan.compactions++
    if (e.type !== 'assistant' || e.isSidechain || !e.message?.usage || e.message.model === '<synthetic>') continue
    if (typeof e.requestedModel === 'string' && /\[1m\]/i.test(e.requestedModel)) scan.oneM = true
    const u = e.message.usage
    const used = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens) + num(u.output_tokens)
    // Later lines of one response can only raise its output count.
    scan.used = e.message.id && e.message.id === scan.lastId ? Math.max(scan.used, used) : used
    scan.lastId = e.message.id
  }
}

/**
 * How full a chat's context window is now, for the composer's ring. Unlike sessionUsage it reads
 * only what was appended since the last call, so it stays cheap on long transcripts.
 */
export function contextNow(sessionId: string | undefined, opts: { contextWindow?: number; root?: string } = {}): ChatContext | null {
  if (!sessionId) return null
  const file = transcriptFiles(sessionId, opts.root).main
  if (!file) return null
  // Open first and size the open file, so what's read is the file that was measured.
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch {
    return null
  }
  let scan = scans.get(file)
  try {
    const size = fstatSync(fd).size
    // A file that shrank was rewritten: start over.
    if (!scan || size < scan.size) scan = { size: 0, compactions: 0, oneM: false, used: 0 }
    if (size > scan.size) {
      const buf = Buffer.alloc(size - scan.size)
      const n = readSync(fd, buf, 0, buf.length, scan.size)
      // Stop at the last newline: a line still being written is read whole next time.
      const end = buf.subarray(0, n).lastIndexOf(0x0a) + 1
      if (end) {
        scanLines(scan, buf.subarray(0, end).toString('utf8'))
        scan.size += end
      }
    }
  } finally {
    closeSync(fd)
  }
  scans.set(file, scan)
  if (!scan.lastId && !scan.used) return null
  const contextWindow = opts.contextWindow ?? (scan.oneM || scan.used > 200_000 ? 1_000_000 : 200_000)
  return { used: scan.used, contextWindow, compactions: scan.compactions }
}
