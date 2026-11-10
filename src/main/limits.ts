import { query } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LimitWindow, SubscriptionLimits } from '@shared/types'
import { claudeExecutable } from './claudeBinary'

/**
 * Plan usage limits for the AI subscriptions in use, for the sidebar footer.
 * Claude: Claude Code's own /usage data through the Agent SDK. Codex: the latest rate-limit snapshot
 * the Codex CLI wrote to its session logs. Both read only what the tools already know; no extra sign-in.
 */

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
    const add = (name: string, w: { utilization: number | null; resets_at: string | null } | null | undefined) => {
      if (w && typeof w.utilization === 'number') windows.push({ label: name, percent: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) : undefined })
    }
    add('5h', u.rate_limits.five_hour)
    add('Week', u.rate_limits.seven_day)
    for (const m of u.rate_limits.model_scoped ?? []) add(`${m.display_name} week`, m)
    if (!windows.length) return null
    return { provider: 'claude', name: 'Claude', plan: u.subscription_type ?? undefined, windows, updatedAt: Date.now() }
  } catch {
    return null
  } finally {
    release()
    abort.abort()
  }
}

/** Newest rollout files under ~/.codex/sessions/YYYY/MM/DD, without walking the whole tree. */
function recentRollouts(root: string, n = 8): string[] {
  const out: { f: string; t: number }[] = []
  const desc = (d: string) => (existsSync(d) ? readdirSync(d).filter((x) => /^\d+$/.test(x)).sort().reverse() : [])
  for (const y of desc(root))
    for (const m of desc(join(root, y)))
      for (const d of desc(join(root, y, m))) {
        const dir = join(root, y, m, d)
        for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) out.push({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs })
        if (out.length >= n * 3) return out.sort((a, b) => b.t - a.t).slice(0, n).map((x) => x.f)
      }
  return out.sort((a, b) => b.t - a.t).slice(0, n).map((x) => x.f)
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
        windows.push({ label: label(w.window_minutes ?? 0), percent: w.used_percent, resetsAt: typeof w.resets_at === 'number' ? w.resets_at * 1000 : undefined })
    best = { ts, plan: rl.plan_type ?? undefined, windows }
  }
  return best
}

export function codexLimits(root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')): SubscriptionLimits | null {
  let best: ReturnType<typeof parseCodexLimits> = null
  for (const f of recentRollouts(root)) {
    try {
      const r = parseCodexLimits(readFileSync(f, 'utf8'))
      if (r && (!best || r.ts > best.ts)) best = r
    } catch {
      /* a log being written can be read half-done */
    }
  }
  // A snapshot from weeks ago says nothing about now.
  if (!best || Date.now() - best.ts > 8 * 24 * 3600_000) return null
  // Windows that have reset since the snapshot are back to zero.
  const windows = best.windows.map((w) => (w.resetsAt && w.resetsAt < Date.now() ? { ...w, percent: 0 } : w))
  return { provider: 'codex', name: 'Codex', plan: best.plan, windows, updatedAt: best.ts }
}

let cache: { at: number; value: SubscriptionLimits[] } | null = null
export async function subscriptionLimits(apiKey: string, force = false): Promise<SubscriptionLimits[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value
  const [claude, codex] = await Promise.all([claudeLimits(apiKey), Promise.resolve().then(() => codexLimits())])
  const value = [claude, codex].filter((x): x is SubscriptionLimits => !!x)
  cache = { at: Date.now(), value }
  return value
}
