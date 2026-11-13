import { useId } from 'react'
import type { LimitWindow } from '@shared/types'
import type { Pace } from '@shared/limitPace'

/**
 * Usage over the window: time across, percent up. A gradient area for readings so far, a dashed line
 * for where the current rate leads, a dotted line at reset and a line at the cap.
 */
export function LimitsChart({ w, p, height = 64, now = Date.now(), labels = false }: { w: LimitWindow; p: Pace; height?: number; now?: number; labels?: boolean }) {
  const id = useId().replace(/:/g, '')
  const W = 260
  const H = height
  const pad = { l: labels ? 26 : 2, r: 4, t: 6, b: labels ? 14 : 2 }
  // A little room past reset so the reset line isn't on the edge.
  const t0 = p.start
  const t1 = p.end + (p.end - p.start) * 0.04
  const yMax = Math.max(110, Math.min(150, Math.ceil(Math.max(w.percent, p.projected) / 10) * 10 + 5))
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b)
  const pts = [{ t: t0, p: 0 }, ...(w.history ?? []).filter((h) => h.t >= t0 && h.t <= now), { t: now, p: w.percent }]
  // Usage only rises within a window: hold each reading until the next (a step line), never dip.
  let line = ''
  let last = 0
  for (const [k, h] of pts.entries()) {
    const v = Math.max(last, h.p)
    line += k === 0 ? `M${x(h.t).toFixed(1)},${y(v).toFixed(1)}` : `L${x(h.t).toFixed(1)},${y(last).toFixed(1)}L${x(h.t).toFixed(1)},${y(v).toFixed(1)}`
    last = v
  }
  const area = `${line}L${x(now).toFixed(1)},${y(0).toFixed(1)}L${x(t0).toFixed(1)},${y(0).toFixed(1)}Z`
  const color = p.status === 'on-track' ? 'var(--color-accent)' : p.status === 'ahead' ? '#f59e0b' : 'var(--color-del)'
  // Draw the projection at the real rate, stopping at reset or the top of the chart, whichever comes first.
  const projT = p.rate > 0 ? Math.min(p.end, now + (yMax - w.percent) / p.rate) : p.end
  const projV = Math.min(yMax, w.percent + p.rate * (projT - now))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="block overflow-visible">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.55} />
          <stop offset="100%" stopColor={color} stopOpacity={0.03} />
        </linearGradient>
      </defs>
      {/* Even pace, start to reset */}
      <line x1={x(t0)} y1={y(0)} x2={x(p.end)} y2={y(100)} stroke="var(--color-faint)" strokeWidth={1} strokeDasharray="1 3" opacity={0.7} />
      {/* Cap */}
      <line x1={pad.l} x2={W - pad.r} y1={y(100)} y2={y(100)} stroke="var(--color-del)" strokeWidth={1} strokeDasharray="4 3" opacity={0.8} />
      {/* Reset */}
      <line x1={x(p.end)} x2={x(p.end)} y1={pad.t} y2={H - pad.b} stroke="var(--color-muted)" strokeWidth={1} strokeDasharray="2 3" />
      <path d={area} fill={`url(#g${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      {/* Where the current rate leads */}
      {p.rate > 0 && w.percent < 100 && <line x1={x(now)} y1={y(w.percent)} x2={x(projT)} y2={y(projV)} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />}
      <circle cx={x(now)} cy={y(w.percent)} r={2.5} fill={color} />
      {labels && (
        <>
          <text x={pad.l - 4} y={y(100) + 3} textAnchor="end" fontSize={9} fill="var(--color-faint)">
            cap
          </text>
          <text x={pad.l - 4} y={y(0)} textAnchor="end" fontSize={9} fill="var(--color-faint)">
            0
          </text>
          <text x={x(p.end)} y={H - 2} textAnchor="end" fontSize={9} fill="var(--color-muted)">
            reset
          </text>
          <text x={pad.l} y={H - 2} fontSize={9} fill="var(--color-faint)">
            start
          </text>
        </>
      )}
    </svg>
  )
}
