import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SessionUsage, UsagePoint } from '@shared/types'

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
      ...(subagent || e.isSidechain ? { subagent: true } : {})
    }
    const id = e.message.id as string | undefined
    const prev = id ? byId.get(id) : undefined
    if (prev) {
      // Later lines of the same response can report the final output count.
      prev.output = Math.max(prev.output, point.output)
      continue
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
