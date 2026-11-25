import type { ChatContext } from './types'

/** How full a chat's context window is, for the ring in the composer. See docs/prd/context-ring.md. */
export interface ContextGauge {
  /** Tokens in the main context window after the last response. */
  used: number
  window: number
  /** 0–100, rounded. */
  percent: number
  level: 'ok' | 'warn' | 'full'
  /** Times the conversation has been compacted. */
  compactions: number
}

/** Null when there is nothing to show yet (no replies, or a Codex chat). */
export function contextGauge(c: ChatContext | null | undefined): ContextGauge | null {
  if (!c || !c.contextWindow) return null
  const percent = Math.min(100, Math.max(0, Math.round((c.used / c.contextWindow) * 100)))
  // Same thresholds as the usage bars in the sidebar footer.
  const level = percent >= 90 ? 'full' : percent >= 70 ? 'warn' : 'ok'
  return { used: c.used, window: c.contextWindow, percent, level, compactions: c.compactions }
}

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export function contextGaugeTitle(g: ContextGauge): string {
  const lines = [`Context: ${k(g.used)} of ${k(g.window)} (${g.percent}% used, ${100 - g.percent}% left)`]
  if (g.compactions) lines.push(`Compacted ${g.compactions === 1 ? 'once' : `${g.compactions} times`}`)
  if (g.level !== 'ok') lines.push('Claude Code compacts the conversation automatically when it fills up')
  lines.push('This chat only. Plan usage is in the sidebar. Click for graphs.')
  return lines.join('\n')
}
