import type { LimitWindow } from './types'

export interface Pace {
  start: number
  end: number
  /** Share of the window's time that has passed, 0-1. */
  elapsed: number
  /** Percent used if usage were spread evenly over the window. */
  expected: number
  /** Percent per millisecond, from recent readings (or the whole window if there are few). */
  rate: number
  /** Where usage ends up at reset at the current rate, capped at 150 for drawing. */
  projected: number
  /** When the cap is reached at the current rate, if before reset. */
  hitsCapAt?: number
  status: 'on-track' | 'ahead' | 'over'
}

/** Compares usage to an even spread across the window, and projects it to reset at the recent rate. */
export function pace(w: LimitWindow, now = Date.now()): Pace | null {
  if (!w.resetsAt || !w.windowMs) return null
  const end = w.resetsAt
  const start = end - w.windowMs
  const elapsed = Math.min(1, Math.max(0, (now - start) / w.windowMs))
  const expected = elapsed * 100
  const pts = (w.history ?? []).filter((x) => x.t >= start && x.t <= now)
  // Rate over the last quarter of the window's readings, falling back to the average since it started.
  const recentFrom = now - w.windowMs / 4
  const recent = pts.filter((x) => x.t >= recentFrom)
  let rate = now > start ? w.percent / (now - start) : 0
  if (recent.length >= 2) {
    const a = recent[0]
    const b = recent[recent.length - 1]
    // Only trust the recent slope once it covers a real stretch of the window.
    if (b.t - a.t >= w.windowMs / 20 && b.p >= a.p) rate = (b.p - a.p) / (b.t - a.t)
  }
  const projected = Math.min(150, w.percent + rate * Math.max(0, end - now))
  const hitsCapAt = w.percent >= 100 ? now : rate > 0 && projected >= 100 ? now + (100 - w.percent) / rate : undefined
  const status = w.percent >= 100 ? 'over' : hitsCapAt && hitsCapAt < end ? 'ahead' : 'on-track'
  return { start, end, elapsed, expected, rate, projected, hitsCapAt, status }
}

const when = (t: number, now: number) => {
  const d = new Date(t)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return sameDay ? `today at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : d.toLocaleString([], { weekday: 'short', hour: 'numeric' })
}

/** One plain sentence on whether this window will last until it resets. */
export function paceText(w: LimitWindow, p: Pace, now = Date.now()): string {
  if (p.status === 'over') return `At the cap. Resets ${when(p.end, now)}.`
  if (p.status === 'ahead' && p.hitsCapAt) return `Ahead of pace: at this rate you hit the cap ${when(p.hitsCapAt, now)}, before it resets ${when(p.end, now)}.`
  const diff = Math.round(p.expected - w.percent)
  return diff >= 0 ? `On track: ${Math.round(w.percent)}% used with ${Math.round(p.elapsed * 100)}% of the time gone.` : `On track, a little ahead of an even pace. Resets ${when(p.end, now)}.`
}
