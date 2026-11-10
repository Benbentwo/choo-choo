import { query } from '@anthropic-ai/claude-agent-sdk'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LimitWindow, SubscriptionLimits } from '@shared/types'
import { claudeExecutable } from './claudeBinary'

/**
 * Plan usage limits for the AI subscriptions in use, for the sidebar footer.
 * Claude: Claude Code's own /usage data through the Agent SDK. Codex: the latest rate-limit snapshot
 * the Codex CLI wrote to its session logs. Both read only what the tools already know; no extra sign-in.
 */

const HOUR = 3600_000
const label = (minutes: number) => (minutes <= 360 ? `${Math.round(minutes / 60)}h` : minutes >= 10_000 && minutes <= 10_200 ? 'Week' : `${Math.round(minutes / 1440)}d`)

export async function claudeLimits(apiKey: string): Promise<SubscriptionLimits | null> {
  if (apiKey.trim()) return null // API key billing has no plan limits
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  async function* idle() {
    await gate
  }
  const abort = new AbortController()
  const q = query({
    prompt: idle(),
    options: { abortController: abort, cwd: tmpdir(), pathToClaudeCodeExecutable: claudeExecutable(), persistSession: false, settingSources: [] } as never
  }) as unknown as { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (o: { skipBehaviors: boolean }) => Promise<any> }
  try {
    // Experimental in the SDK: if it's renamed or removed, the footer just stops showing Claude.
    const fn = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
    if (typeof fn !== 'function') return null
    const u = await Promise.race([fn.call(q, { skipBehaviors: true }), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 20_000))])
    if (!u?.rate_limits_available || !u.rate_limits) return null
    const windows: LimitWindow[] = []
    const add = (key: string, name: string, windowMs: number, w: { utilization: number | null; resets_at: string | null } | null | undefined) => {
      if (w && typeof w.utilization === 'number')
        windows.push({ key: `claude:${key}`, label: name, percent: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) : undefined, windowMs })
    }
    add('five_hour', '5h', 5 * HOUR, u.rate_limits.five_hour)
    add('seven_day', 'Week', 7 * 24 * HOUR, u.rate_limits.seven_day)
    for (const m of u.rate_limits.model_scoped ?? []) add(`model:${m.display_name}`, `${m.display_name} week`, 7 * 24 * HOUR, m)
    if (!windows.length) return null
    const now = Date.now()
    for (const w of windows) record(w.key, now, w.percent, w.resetsAt, w.windowMs)
    return { provider: 'claude', name: 'Claude', plan: u.subscription_type ?? undefined, windows: windows.map(withHistory), updatedAt: now }
  } catch {
    return null
  } finally {
    release()
    abort.abort()
  }
}

/** Most recently written rollout files under ~/.codex/sessions/YYYY/MM/DD. A long session keeps writing to the file from the day it started, so every day is checked (stat only). */
function recentRollouts(root: string, n = 8): string[] {
  const out: { f: string; t: number }[] = []
  const desc = (d: string) => (existsSync(d) ? readdirSync(d).filter((x) => /^\d+$/.test(x)).sort().reverse() : [])
  for (const y of desc(root))
    for (const m of desc(join(root, y)))
      for (const d of desc(join(root, y, m))) {
        const dir = join(root, y, m, d)
        for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) out.push({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs })
      }
  return out.sort((a, b) => b.t - a.t).slice(0, n).map((x) => x.f)
}

type CodexSnapshot = { ts: number; plan?: string; windows: LimitWindow[] }

/** "try again at Nov 16th, 2026 5:39 PM" → a timestamp (local time, as Codex prints it). */
export function parseRetryAt(message: string): number | undefined {
  const m = message.match(/try again (?:at|on) ([A-Z][a-z]{2,8} \d{1,2}(?:st|nd|rd|th)?,? \d{4},? \d{1,2}:\d{2}\s*[AP]M)/i)
  if (!m) return undefined
  const t = Date.parse(m[1].replace(/(\d)(st|nd|rd|th)/, '$1').replace(/,(?= \d{1,2}:)/, ''))
  return Number.isFinite(t) ? t : undefined
}

/**
 * When Codex refused a turn for being over the limit. Its rate-limit snapshots can still read below
 * 100% (another bucket ran out), so this error is the reliable signal.
 */
export function codexCaps(text: string): { ts: number; until?: number }[] {
  const out: { ts: number; until?: number }[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('usage_limit_exceeded') && !line.includes('usage_limit_reached')) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const err = e?.payload?.error ?? e?.payload
    const msg = String(err?.message ?? '')
    out.push({ ts: Date.parse(e.timestamp) || 0, until: parseRetryAt(msg) })
  }
  return out
}

/** Every rate-limit snapshot in a Codex log, oldest first. */
export function codexSnapshots(text: string): CodexSnapshot[] {
  const out: CodexSnapshot[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('rate_limits')) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const rl = e?.payload?.rate_limits
    if (!rl || (!rl.primary && !rl.secondary)) continue
    const windows: LimitWindow[] = []
    for (const w of [rl.primary, rl.secondary])
      if (w && typeof w.used_percent === 'number') {
        const mins = w.window_minutes ?? 0
        windows.push({ key: `codex:${mins}`, label: label(mins), percent: w.used_percent, resetsAt: typeof w.resets_at === 'number' ? w.resets_at * 1000 : undefined, windowMs: mins ? mins * 60_000 : undefined })
      }
    out.push({ ts: Date.parse(e.timestamp) || 0, plan: rl.plan_type ?? undefined, windows })
  }
  return out
}

export function parseCodexLimits(text: string): { ts: number; plan?: string; windows: LimitWindow[] } | null {
  let best: { ts: number; plan?: string; windows: LimitWindow[] } | null = null
  for (const line of text.split('\n')) {
    if (!line.includes('rate_limits')) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const rl = e?.payload?.rate_limits
    if (!rl || (!rl.primary && !rl.secondary)) continue
    const ts = Date.parse(e.timestamp) || 0
    if (best && ts < best.ts) continue
    const windows: LimitWindow[] = []
    for (const w of [rl.primary, rl.secondary])
      if (w && typeof w.used_percent === 'number')
        windows.push({
          key: `codex:${w.window_minutes ?? 0}`,
          label: label(w.window_minutes ?? 0),
          percent: w.used_percent,
          resetsAt: typeof w.resets_at === 'number' ? w.resets_at * 1000 : undefined,
          windowMs: w.window_minutes ? w.window_minutes * 60_000 : undefined
        })
    best = { ts, plan: rl.plan_type ?? undefined, windows }
  }
  return best
}

export function codexLimits(root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')): SubscriptionLimits | null {
  let best: ReturnType<typeof parseCodexLimits> = null
  const all: CodexSnapshot[] = []
  let cap: { ts: number; until?: number } | null = null
  for (const f of recentRollouts(root)) {
    try {
      const parsed = parseRollout(f)
      for (const c of parsed.caps) if (!cap || c.ts > cap.ts) cap = c
      const snaps = parsed.snaps
      all.push(...snaps)
      for (const r of snaps) if (!best || r.ts > best.ts) best = r
    } catch {
      /* a log being written can be read half-done */
    }
  }
  // Codex logs every reading, so the history comes for free.
  for (const snap of all) for (const w of snap.windows) record(w.key, snap.ts, w.percent, w.resetsAt, w.windowMs)
  // A snapshot from weeks ago says nothing about now.
  if (!best || Date.now() - best.ts > 8 * 24 * 3600_000) return null
  // Windows that have reset since the snapshot are back to zero.
  let windows = best.windows.map((w) => (w.resetsAt && w.resetsAt < Date.now() ? { ...w, percent: 0 } : w))
  // Refused for the limit after the last snapshot, and it hasn't freed up yet: that window is full.
  const now = Date.now()
  const capped = cap && cap.ts >= best.ts - 60_000 && (cap.until ? cap.until > now : now - cap.ts < 24 * 3600_000) ? { since: cap.ts, until: cap.until } : undefined
  if (capped) {
    // The window that frees up when Codex says to try again; otherwise the longest one.
    const match = windows.find((w) => capped.until && w.resetsAt && Math.abs(w.resetsAt - capped.until) < 36 * 3600_000) ?? [...windows].sort((a, b) => (b.windowMs ?? 0) - (a.windowMs ?? 0))[0]
    windows = match ? windows.map((w) => (w === match ? { ...w, percent: 100, resetsAt: capped.until ?? w.resetsAt } : w)) : [{ key: 'codex:cap', label: 'Limit', percent: 100, resetsAt: capped.until }]
    for (const w of windows) if (w.percent === 100) record(w.key, capped.since, 100)
  }
  return { provider: 'codex', name: 'Codex', plan: best.plan, windows: windows.map(withHistory), updatedAt: Math.max(best.ts, capped?.since ?? 0), capped }
}

/**
 * The end of a log, at most `max` bytes. A long Codex session's log can pass the size of a JS string,
 * and the readings that matter are the latest ones anyway.
 */
export function readTail(file: string, max = 16 * 1024 * 1024): string {
  const size = statSync(file).size
  if (size <= max) return readFileSync(file, 'utf8')
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(max)
    readSync(fd, buf, 0, max, size - max)
    const text = buf.toString('utf8')
    // Drop the partial first line.
    return text.slice(text.indexOf('\n') + 1)
  } finally {
    closeSync(fd)
  }
}

/** Parsed logs by path, reused while the file hasn't changed, so a refresh only reads what moved. */
const parsedLogs = new Map<string, { key: string; snaps: CodexSnapshot[]; caps: { ts: number; until?: number }[] }>()
function parseRollout(f: string) {
  const st = statSync(f)
  const key = `${st.size}:${st.mtimeMs}`
  const hit = parsedLogs.get(f)
  if (hit?.key === key) return hit
  const text = readTail(f)
  const out = { key, snaps: codexSnapshots(text), caps: codexCaps(text) }
  parsedLogs.set(f, out)
  return out
}

let cache: { at: number; value: SubscriptionLimits[] } | null = null
export async function subscriptionLimits(apiKey: string, force = false): Promise<SubscriptionLimits[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value
  const [claude, codex] = await Promise.all([claudeLimits(apiKey), Promise.resolve().then(() => codexLimits())])
  const value = [claude, codex].filter((x): x is SubscriptionLimits => !!x)
  flush()
  cache = { at: Date.now(), value }
  return value
}

// ---- History: readings over time, so the sidebar can graph a window. Claude only reports "now", so we keep our own.

type Point = { t: number; p: number }
let historyFile: string | null = null
let history: Record<string, Point[]> = {}

/** Where readings are kept; set once at startup. Without it, history lives in memory only. */
export function initLimitsHistory(dir: string) {
  mkdirSync(dir, { recursive: true })
  historyFile = join(dir, 'limits-history.json')
  try {
    history = JSON.parse(readFileSync(historyFile, 'utf8'))
  } catch {
    history = {}
  }
}

let dirty = false
function record(key: string, t: number, p: number, resetsAt?: number, windowMs?: number) {
  const list = (history[key] ??= [])
  if (list.some((x) => x.t === t)) return
  list.push({ t, p })
  list.sort((a, b) => a.t - b.t)
  // Keep a bit more than the longest window.
  const keepFrom = Date.now() - 9 * 24 * HOUR
  history[key] = list.filter((x) => x.t >= keepFrom).slice(-2000)
  dirty = true
  void resetsAt
  void windowMs
}

function flush() {
  if (!dirty || !historyFile) return
  dirty = false
  try {
    writeFileSync(historyFile, JSON.stringify(history))
  } catch {
    /* best effort */
  }
}

/** The readings that belong to the window's current period. */
function withHistory(w: LimitWindow): LimitWindow {
  const start = w.resetsAt && w.windowMs ? w.resetsAt - w.windowMs : -Infinity
  const pts = (history[w.key] ?? []).filter((x) => x.t >= start)
  return { ...w, history: pts }
}

export function _resetHistoryForTests() {
  history = {}
  historyFile = null
}
