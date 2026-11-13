import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore, reportError } from '../store'
import { IconLeft, IconSidebar } from '../icons'
import { FAMILIES, type ModelFamily, type UsageDashboard, type UsageHit, type WindowDetail } from '@shared/usageHistory'

/**
 * Usage page: plan window history, limit hits, and where usage went. Data comes from readings
 * Choo Choo saves while it runs and response summaries copied from Claude Code's transcripts
 * (src/main/usageHistory.ts). Chart colors follow the data-viz palette (UsageGraphs.tsx uses the same).
 */

const HOUR = 3600_000
const DAY = 24 * HOUR
type Range = '24h' | '7d' | '30d' | '90d' | 'all'
const RANGES: { id: Range; label: string; ms: number }[] = [
  { id: '24h', label: '24h', ms: DAY },
  { id: '7d', label: '7 days', ms: 7 * DAY },
  { id: '30d', label: '30 days', ms: 30 * DAY },
  { id: '90d', label: '90 days', ms: 90 * DAY },
  { id: 'all', label: 'All', ms: 400 * DAY }
]

const SLOTS = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'] }
const OTHER = { light: '#8d9098', dark: '#676b73' }
const CRITICAL = '#d03b3b'
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b']
const FAMILY_SLOT: Record<ModelFamily, number> = { Opus: 0, Sonnet: 1, Haiku: 2, Fable: 3, Other: -1 }

const isDark = () => document.documentElement.style.colorScheme !== 'light'
const slot = (i: number, dark: boolean) => (i < 0 ? OTHER[dark ? 'dark' : 'light'] : SLOTS[dark ? 'dark' : 'light'][i % 5])

const money = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString()}` : n >= 10 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`)
const dur = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const dayTime = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const dayLabel = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const card = 'rounded-[10px] border border-line bg-panel px-4 py-3.5'
const seg = (on: boolean) => `px-2.5 py-1 text-[12px] ${on ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`

function Card({ title, sub, right, children, className = '' }: { title: string; sub?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${card} ${className}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="text-[13.5px] font-semibold">{title}</h3>
        {sub && <span className="text-[12px] text-muted">{sub}</span>}
        {right && <div className="ml-auto flex items-center gap-3 text-[12px] text-muted">{right}</div>}
      </div>
      {children}
    </section>
  )
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: ReactNode }) {
  return (
    <div className={card}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 mb-0.5 text-[24px] font-semibold tabular-nums">{value}</div>
      {detail && <div className="text-[12px] text-muted">{detail}</div>}
    </div>
  )
}

function Legend({ items }: { items: { label: string; color: string; line?: boolean; dashed?: boolean }[] }) {
  return (
    <>
      {items.map((x) => (
        <span key={x.label} className="flex items-center gap-1.5">
          {x.line ? <i className="inline-block w-3.5" style={{ borderTop: `2px ${x.dashed ? 'dashed' : 'solid'} ${x.color}` }} /> : <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: x.color }} />}
          {x.label}
        </span>
      ))}
    </>
  )
}

function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute z-10 rounded-md border border-line bg-code px-2.5 py-1.5 text-[12px] leading-[1.5] whitespace-nowrap shadow-xl" style={{ left: x, top: y }}>
      {children}
    </div>
  )
}

const HitMark = ({ x, y, onClick }: { x: number; y: number; onClick?: () => void }) => (
  <g className={onClick ? 'cursor-pointer' : undefined} onClick={onClick}>
    <rect x={x - 9} y={y - 12} width={18} height={18} fill="transparent" />
    <path d={`M${x},${y - 9} l6,10 h-12z`} fill={CRITICAL} stroke="var(--color-panel)" strokeWidth={2} />
  </g>
)

// ---- Plan windows over time

function WindowsChart({ data, provider, dark, openHit }: { data: UsageDashboard; provider: 'claude' | 'codex'; dark: boolean; openHit: (h: UsageHit) => void }) {
  const [ref, W] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const windows = data.windows.filter((w) => w.provider === provider && (/five_hour|seven_day/.test(w.key) || provider === 'codex')).slice(0, 4)
  const hits = data.hits.filter((h) => windows.some((w) => w.key === h.key))
  const H = 250
  const L = 40
  const R = 96
  const T = 24
  const B = 24
  const iw = Math.max(50, W - L - R)
  const ih = H - T - B
  const x = (t: number) => L + ((t - data.from) / (data.to - data.from)) * iw
  const y = (p: number) => T + ih - (Math.min(p, 100) / 100) * ih
  // A gap longer than this means Choo Choo was closed: no line across it.
  const GAP = 40 * 60_000
  const path = (pts: { t: number; p: number }[]) => pts.map((q, i) => `${i && q.t - pts[i - 1].t < GAP ? 'L' : 'M'}${x(q.t).toFixed(1)},${y(q.p).toFixed(1)}`).join('')
  const ticks = useMemo(() => {
    const span = data.to - data.from
    const step = span <= DAY ? 3 * HOUR : span <= 8 * DAY ? DAY : span <= 31 * DAY ? 7 * DAY : 30 * DAY
    const first = new Date(data.from)
    first.setHours(span <= DAY ? Math.ceil(first.getHours() / 3) * 3 : 24, 0, 0, 0)
    const out: number[] = []
    for (let t = first.getTime(); t < data.to; t += step) out.push(t)
    return out
  }, [data.from, data.to])
  const weekly = windows.find((w) => /seven_day|codex:10080/.test(w.key))
  // End labels, pushed apart so they never overlap.
  const ends = windows
    .filter((w) => w.points.length)
    .map((w, i) => ({ w, i, y: y(w.points[w.points.length - 1].p) + 4 }))
    .sort((a, b) => a.y - b.y)
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14
  const atHover = (pts: { t: number; p: number }[], t: number) => {
    let best: { t: number; p: number } | undefined
    for (const q of pts) if (q.t <= t) best = q
    return best && t - best.t < GAP ? best : undefined
  }
  if (!windows.some((w) => w.points.length))
    return <div ref={ref} className="grid h-[200px] place-items-center text-[12.5px] text-muted">No readings in this range yet. Choo Choo saves one every 2 minutes while it’s open.</div>
  return (
    <div ref={ref} className="relative">
      <svg
        width={W}
        height={H}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = e.clientX - r.left
          setHover(px < L || px > L + iw ? null : data.from + ((px - L) / iw) * (data.to - data.from))
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 25, 50, 75].map((v) => (
          <g key={v}>
            <line x1={L} x2={L + iw} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeOpacity={0.6} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">{v}%</text>
          </g>
        ))}
        <line x1={L} x2={L + iw} y1={y(100)} y2={y(100)} stroke={CRITICAL} strokeDasharray="4 4" strokeOpacity={0.8} />
        <text x={L - 8} y={y(100) + 4} textAnchor="end" className="fill-muted text-[11px]">100%</text>
        {ticks.map((t) => (
          <text key={t} x={x(t) + 3} y={H - 6} className="fill-muted text-[11px]">
            {data.to - data.from <= DAY ? time(t) : data.to - data.from <= 8 * DAY ? new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric' }) : dayLabel(t)}
          </text>
        ))}
        {weekly?.resets.map((r) => (
          <g key={r}>
            <line x1={x(r)} x2={x(r)} y1={T - 4} y2={T + ih} stroke="var(--color-muted)" strokeDasharray="2 3" />
            <text x={x(r)} y={T - 8} textAnchor="middle" className="fill-muted text-[11px]">{weekly.label} reset</text>
          </g>
        ))}
        {windows.map((w, i) => (
          <path key={w.key} d={path(w.points)} fill="none" stroke={slot(i, dark)} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {ends.map((e) => (
          <text key={e.w.key} x={x(e.w.points[e.w.points.length - 1].t) + 8} y={e.y} className="fill-fg text-[11px]">
            {e.w.label} {Math.round(e.w.points[e.w.points.length - 1].p)}%
          </text>
        ))}
        {hits.map((h) => (
          <HitMark key={`${h.key}${h.t}`} x={x(h.t)} y={y(100)} onClick={() => openHit(h)} />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ih} stroke="var(--color-faint)" />}
      </svg>
      {hover !== null && (
        <Tip x={Math.min(x(hover) + 12, W - 230)} y={T + 6}>
          <div className="text-muted">{dayTime(hover)}</div>
          {windows.map((w, i) => {
            const q = atHover(w.points, hover)
            return (
              <div key={w.key} className="flex items-center gap-1.5">
                <i className="inline-block w-3" style={{ borderTop: `2px solid ${slot(i, dark)}` }} />
                {w.label} {q ? `${Math.round(q.p)}%` : <span className="text-faint">no reading</span>}
              </div>
            )
          })}
          {hits.some((h) => Math.abs(h.t - hover) < (data.to - data.from) / 80) && <div className="text-accent">Click ▲ to see what used it</div>}
        </Tip>
      )}
    </div>
  )
}

// ---- Where it went

function WhereBars({ data, dark }: { data: UsageDashboard; dark: boolean }) {
  const [ref, W] = useWidth()
  const max = Math.max(0.01, ...data.groups.map((g) => g.share))
  const labelW = Math.min(230, W * 0.42)
  const barMax = Math.max(40, W - labelW - 56)
  if (!data.groups.length) return <div ref={ref} className="py-10 text-center text-[12.5px] text-muted">No Claude Code responses in this range.</div>
  return (
    <div ref={ref} className="flex flex-col gap-1.5">
      {data.groups.map((g) => (
        <div key={g.id} className="flex items-center text-[12px]" title={`${g.label}: ${Math.round(g.share * 100)}% · ${money(g.cost)} API-equivalent`}>
          <span className="truncate" style={{ width: labelW }}>{g.label}</span>
          <span className="h-4 rounded-r-[4px]" style={{ width: Math.max(2, (g.share / max) * barMax), background: g.kind === 'other' ? OTHER[dark ? 'dark' : 'light'] : slot(0, dark) }} />
          <span className="ml-2 tabular-nums">{Math.round(g.share * 100)}%</span>
        </div>
      ))}
    </div>
  )
}

// ---- By model

function ModelBars({ data, dark }: { data: UsageDashboard; dark: boolean }) {
  const [ref, W] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const fams = FAMILIES.filter((f) => data.buckets.some((b) => b.costs[f]))
  const H = 190
  const L = 44
  const T = 10
  const B = 22
  const iw = Math.max(50, W - L - 8)
  const ih = H - T - B
  const totals = data.buckets.map((b) => fams.reduce((a, f) => a + (b.costs[f] ?? 0), 0))
  // A round top: 1, 2 or 5 times a power of ten, split into two steps.
  const raw = Math.max(1, ...totals)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const max = ([1, 2, 5, 10].find((k) => k * mag >= raw) ?? 10) * mag
  const step = iw / Math.max(1, data.buckets.length)
  const bw = Math.max(2, Math.min(36, step * 0.62))
  const y = (v: number) => T + ih - (v / max) * ih
  const nice = [0, max / 2, max]
  const every = Math.ceil(data.buckets.length / Math.max(1, Math.floor(iw / 56)))
  const fmt = (t: number) => (data.bucket === 'hour' ? new Date(t).toLocaleTimeString([], { hour: 'numeric' }) : data.bucket === 'day' && data.buckets.length <= 8 ? new Date(t).toLocaleDateString([], { weekday: 'short' }) : dayLabel(t))
  return (
    <div ref={ref} className="relative">
      <div className="mb-1 flex gap-3 text-[12px] text-muted">
        <Legend items={fams.map((f) => ({ label: f, color: slot(FAMILY_SLOT[f], dark) }))} />
      </div>
      <svg width={W} height={H} onMouseLeave={() => setHover(null)}>
        {nice.map((v) => (
          <g key={v}>
            <line x1={L} x2={L + iw} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeOpacity={0.6} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">${v < 10 && v % 1 ? v.toFixed(1) : Math.round(v)}</text>
          </g>
        ))}
        {data.buckets.map((b, i) => {
          const cx = L + (i + 0.5) * step
          let acc = 0
          const segs = fams.filter((f) => b.costs[f])
          return (
            <g key={b.start} onMouseEnter={() => setHover(i)}>
              <rect x={cx - step / 2} y={T} width={step} height={ih} fill="transparent" />
              {segs.map((f, k) => {
                const v = b.costs[f]!
                const y0 = y(acc)
                acc += v
                const y1 = y(acc)
                const h = Math.max(0, y0 - y1 - (k ? 2 : 0))
                const top = k === segs.length - 1
                const r = top ? Math.min(4, h, bw / 2) : 0
                return <path key={f} d={`M${cx - bw / 2},${y1 + h + (k ? 0 : 0)} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${bw - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r}z`} transform={`translate(0,${k ? -2 : 0})`} fill={slot(FAMILY_SLOT[f], dark)} opacity={hover === null || hover === i ? 1 : 0.55} />
              })}
              {i % every === 0 && (
                <text x={Math.min(cx, L + iw)} y={H - 5} textAnchor={cx + 26 > L + iw ? 'end' : 'middle'} className="fill-muted text-[11px]">
                  {fmt(b.start)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && data.buckets[hover] && (
        <Tip x={Math.min(L + (hover + 0.5) * step + 14, W - 180)} y={8}>
          <div className="text-muted">{data.bucket === 'hour' ? dayTime(data.buckets[hover].start) : data.bucket === 'week' ? `Week of ${dayLabel(data.buckets[hover].start)}` : new Date(data.buckets[hover].start).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          {fams.map((f) => (
            <div key={f} className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 rounded-sm" style={{ background: slot(FAMILY_SLOT[f], dark) }} />
              {f} {money(data.buckets[hover].costs[f] ?? 0)}
            </div>
          ))}
          <div>Total {money(totals[hover])}</div>
        </Tip>
      )}
    </div>
  )
}

// ---- Busiest hours

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
function Heatmap({ data, dark }: { data: UsageDashboard; dark: boolean }) {
  const max = Math.max(0, ...data.heat.flat())
  const ramp = dark ? [...RAMP].reverse() : RAMP
  const color = (v: number) => (v <= 0 || !max ? 'var(--color-raised)' : ramp[Math.min(ramp.length - 1, 1 + Math.floor((v / max) * (ramp.length - 2)))])
  const hour = (h: number) => (h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`)
  return (
    <div className="text-[11px] text-muted">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: '34px repeat(24, minmax(0, 1fr))' }}>
        {data.heat.map((row, d) => (
          <div key={d} className="contents">
            <span className="leading-[18px]">{DAYS[d]}</span>
            {row.map((v, h) => (
              <span key={h} className="h-[18px] rounded-[3px]" style={{ background: color(v) }} title={`${DAYS[d]} ${hour(h)}: ${money(v)} API-equivalent`} />
            ))}
          </div>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="pt-1 whitespace-nowrap">{h % 6 === 0 ? hour(h) : ''}</span>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        Less
        {[1, 3, 5, 7, 9, 11].map((k) => (
          <i key={k} className="inline-block h-3 w-4 rounded-[3px]" style={{ background: ramp[k] }} />
        ))}
        More
      </div>
    </div>
  )
}

// ---- One window

function WindowView({ hit, dark, back }: { hit: { key: string; start: number; end: number; label: string }; dark: boolean; back: () => void }) {
  const [d, setD] = useState<WindowDetail | null>(null)
  const [ref, W] = useWidth()
  const len = hit.end - hit.start
  const [span, setSpan] = useState(hit)
  useEffect(() => {
    setD(null)
    window.api.usageWindow({ key: span.key, start: span.start, end: span.end }).then(setD).catch(reportError)
  }, [span.key, span.start, span.end])
  const shift = (n: number) => setSpan((s) => ({ ...s, start: s.start + n * len, end: s.end + n * len }))
  const H = 280
  const L = 40
  const R = 200
  const T = 22
  const B = 24
  const iw = Math.max(50, W - L - R)
  const ih = H - T - B
  const x = (t: number) => L + ((t - span.start) / len) * iw
  const y = (p: number) => T + ih - (p / 112) * ih
  const groups = d?.groups ?? []
  const colorOf = (i: number, kind: string) => (kind === 'elsewhere' || kind === 'other' || i >= 4 ? OTHER[dark ? 'dark' : 'light'] : slot(i, dark))
  // Areas run flat to the window's end (or now) once the last reading is in.
  const endT = Math.min(span.end, Date.now())
  const areas: { id: string; d: string; color: string; mid: number; share: number; label: string }[] = []
  if (d && d.times.length > 1) {
    const ts = [...d.times, endT]
    let base = new Array(ts.length).fill(0)
    groups.forEach((g, i) => {
      const s = [...d.series[g.id], d.series[g.id][d.series[g.id].length - 1]]
      const top = base.map((b, k) => b + s[k])
      const up = ts.map((t, k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)},${y(top[k]).toFixed(1)}`).join('')
      const down = ts.map((t, k) => `L${x(t).toFixed(1)},${y(base[k]).toFixed(1)}`).reverse().join('')
      areas.push({ id: g.id, d: `${up}${down}z`, color: colorOf(i, g.kind), mid: y((base[base.length - 1] + top[top.length - 1]) / 2), share: g.share, label: g.label })
      base = top
    })
  }
  const labels = areas.map((a) => ({ ...a, ly: a.mid + 4 })).sort((a, b) => a.ly - b.ly)
  for (let k = 1; k < labels.length; k++) if (labels[k].ly - labels[k - 1].ly < 15) labels[k].ly = labels[k - 1].ly + 15
  const ticks = Array.from({ length: 6 }, (_, k) => span.start + (k * len) / 5)
  const fam = d ? Object.entries(d.models).sort((a, b) => b[1] - a[1]) : []
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button className="flex items-center gap-1 text-[13px] text-muted hover:text-fg" onClick={back}>
          <IconLeft width={14} height={14} /> Usage
        </button>
        <h1 className="text-[20px] font-[650] tracking-[-0.02em]">{hit.label} window</h1>
        <span className="text-[13px] text-muted">
          {new Date(span.start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, {time(span.start)} – {len > DAY ? dayTime(span.end) : time(span.end)}
        </span>
        <div className="ml-auto flex overflow-hidden rounded-md border border-line">
          <button className={seg(false)} onClick={() => shift(-1)}>‹ Previous window</button>
          <button className={seg(false)} disabled={span.end > Date.now()} onClick={() => shift(1)}>Next window ›</button>
        </div>
      </div>
      <div className="mb-3.5 grid grid-cols-4 gap-3">
        <Tile label="Hit the limit" value={d?.hit ? time(d.hit.t) : d ? 'No' : '…'} detail={d?.hit ? `${dur(d.hit.t - span.start)} into the window` : 'Stayed under the cap'} />
        <Tile label="Waited" value={d?.hit?.waitedMs ? dur(d.hit.waitedMs) : '–'} detail={d?.hit?.resetsAt ? `Reset at ${time(d.hit.resetsAt)}` : undefined} />
        <Tile label="Chats that ran" value={d ? String(d.chats.length) : '…'} detail={d ? `${d.responses} responses` : undefined} />
        <Tile label="API-equivalent value" value={d ? money(d.cost) : '…'} detail={fam.length ? fam.map(([f, v]) => `${f} ${Math.round((v / (d!.cost || 1)) * 100)}%`).join(' · ') : undefined} />
      </div>
      <Card title="What filled the window" sub="Estimated share of the window, by where it was used" right={<Legend items={areas.map((a) => ({ label: a.label, color: a.color }))} />}>
        <div ref={ref}>
          {!d ? (
            <div className="h-[280px]" />
          ) : d.times.length < 2 ? (
            <div className="grid h-[200px] place-items-center text-[12.5px] text-muted">No readings in this window. Choo Choo wasn’t open, so there’s nothing to split.</div>
          ) : (
            <svg width={W} height={H}>
              {[0, 25, 50, 75].map((v) => (
                <g key={v}>
                  <line x1={L} x2={L + iw} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeOpacity={0.6} />
                  <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">{v}%</text>
                </g>
              ))}
              {areas.map((a) => (
                <path key={a.id} d={a.d} fill={a.color} stroke="var(--color-panel)" strokeWidth={2} strokeLinejoin="round" />
              ))}
              {d.hit && <rect x={x(d.hit.t)} y={T} width={Math.max(0, x(endT) - x(d.hit.t))} height={ih} fill="var(--color-bg)" opacity={0.45} />}
              <line x1={L} x2={L + iw} y1={y(100)} y2={y(100)} stroke={CRITICAL} strokeDasharray="4 4" />
              <text x={L - 8} y={y(100) + 4} textAnchor="end" className="fill-muted text-[11px]">100%</text>
              {d.hit && (
                <>
                  <HitMark x={x(d.hit.t)} y={y(100)} />
                  <text x={x(d.hit.t) - 10} y={y(100) - 6} textAnchor="end" className="fill-fg text-[11px]">Limit hit {time(d.hit.t)}</text>
                  {x(endT) - x(d.hit.t) > 160 && (
                    <text x={(x(d.hit.t) + x(endT)) / 2} y={y(100) - 6} textAnchor="middle" className="fill-fg text-[11px]">Waiting for reset</text>
                  )}
                </>
              )}
              {labels.map((a) => (
                <text key={a.id} x={x(endT) + 10} y={a.ly} className="fill-fg text-[11px]">
                  {a.label.length > 26 ? `${a.label.slice(0, 25)}…` : a.label} {Math.round(a.share)}%
                </text>
              ))}
              {ticks.map((t) => (
                <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">{len > DAY ? dayLabel(t) : time(t)}</text>
              ))}
            </svg>
          )}
        </div>
      </Card>
      <Card title="Chats in this window" sub="By estimated share of the window" className="mt-3.5">
        {d && !d.chats.length ? (
          <div className="py-6 text-center text-[12.5px] text-muted">No Claude Code responses on this Mac in this window.</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-1.5 font-medium">Chat</th>
                <th className="py-1.5 font-medium">Where</th>
                <th className="py-1.5 text-right font-medium">Responses</th>
                <th className="py-1.5 text-right font-medium">API-equivalent</th>
                <th className="py-1.5 text-right font-medium">Share of window</th>
              </tr>
            </thead>
            <tbody>
              {(d?.chats ?? []).slice(0, 12).map((c) => (
                <tr key={c.session} className="border-b border-line/50">
                  <td className="py-1.5">{c.title}{c.workspace && <span className="text-muted"> · {c.workspace}</span>}</td>
                  <td className="py-1.5 text-muted">{c.group}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.responses}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(c.cost)}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.share >= 0.5 ? `~${Math.round(c.share)}%` : '<1%'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11.5px] leading-[1.45] text-faint">
          Claude only reports a window’s total. Each rise between two readings is split across the chats that ran in between, by tokens weighted by model price. A rise with no chat on this Mac behind it (claude.ai, another computer) shows as “Not on this Mac”.
        </p>
      </Card>
    </>
  )
}

// ---- Page

export function UsagePage() {
  const s = useStore()
  const [range, setRange] = useState<Range>('7d')
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude')
  const [data, setData] = useState<UsageDashboard | null>(null)
  const [win, setWin] = useState<{ key: string; start: number; end: number; label: string } | null>(null)
  const dark = isDark()
  const enabled = s.settings.usageHistory?.enabled !== false
  useEffect(() => {
    let live = true
    const load = () => {
      const to = Date.now()
      const from = to - RANGES.find((r) => r.id === range)!.ms
      window.api
        .usageDashboard({ from, to })
        .then((d) => live && setData(d))
        .catch(reportError)
    }
    load()
    const t = setInterval(load, 2 * 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [range])
  const hasCodex = !!data?.windows.some((w) => w.provider === 'codex')
  const latest = (key: RegExp) => {
    const w = data?.windows.find((x) => x.provider === provider && key.test(x.key))
    return w?.points[w.points.length - 1]
  }
  const weekly = latest(/seven_day|codex:10080/)
  const hits = (data?.hits ?? []).filter((h) => (provider === 'codex' ? h.key.startsWith('codex:') : h.key.startsWith('claude:')))
  const openHit = (h: UsageHit) => {
    const len = h.start && h.resetsAt ? h.resetsAt - h.start : 5 * HOUR
    const start = h.start ?? h.t - len / 2
    setWin({ key: h.key, start, end: start + len, label: h.label })
  }
  const since = data && Math.min(data.firstReading ?? Infinity, data.firstResponse ?? Infinity)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="drag flex h-11 shrink-0 items-center gap-2 px-3">
        {!s.sidebarOpen && (
          <button title="Show sidebar" className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
        <div className="flex-1" />
        <button className="no-drag rounded-md border border-line px-3 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg" onClick={() => s.set({ modal: 'settings', settingsTab: 'usage' })}>
          Settings
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-10">
        <div className="mx-auto max-w-6xl">
          {win ? (
            <WindowView key={`${win.key}${win.start}`} hit={win} dark={dark} back={() => setWin(null)} />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <h1 className="text-[20px] font-[650] tracking-[-0.02em]">Usage</h1>
                <span className="text-[13px] text-muted">
                  {!enabled ? 'History is off in Settings' : since && Number.isFinite(since) ? `History since ${dayLabel(since)}` : 'History starts now'}
                </span>
                <div className="ml-auto flex overflow-hidden rounded-md border border-line">
                  {RANGES.map((r) => (
                    <button key={r.id} className={seg(range === r.id)} onClick={() => setRange(r.id)}>
                      {r.label}
                    </button>
                  ))}
                </div>
                {hasCodex && (
                  <div className="flex overflow-hidden rounded-md border border-line">
                    <button className={seg(provider === 'claude')} onClick={() => setProvider('claude')}>Claude</button>
                    <button className={seg(provider === 'codex')} onClick={() => setProvider('codex')}>Codex</button>
                  </div>
                )}
                <button className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg" disabled={!data} onClick={() => data && void window.api.exportUsageCsv({ from: data.from, to: data.to }).catch(reportError)}>
                  Export CSV
                </button>
              </div>
              {!data ? (
                <div className="py-20 text-center text-[13px] text-muted">Reading your usage history…</div>
              ) : (
                <>
                  <div className="mb-3.5 grid grid-cols-4 gap-3">
                    <Tile label="Weekly window" value={weekly ? `${Math.round(weekly.p)}%` : '–'} detail={weekly ? `Read ${dayTime(weekly.t)}` : 'No reading yet'} />
                    <Tile label="Hit a limit" value={`${hits.length} ${hits.length === 1 ? 'time' : 'times'}`} detail={hits.length ? `Last ${dayTime(hits[hits.length - 1].t)}` : 'In this range'} />
                    <Tile label="Time spent at a limit" value={hits.length ? dur(data.limitMs) : '0m'} detail="Waiting for a window to reset" />
                    <Tile label="API-equivalent value" value={money(data.totalCost)} detail={`${data.responses.toLocaleString()} responses in ${data.sessions} chats`} />
                  </div>
                  <Card
                    title="Plan windows"
                    sub="Percent of each window used, read every 2 minutes while Choo Choo is open"
                    right={
                      <Legend
                        items={[
                          ...data.windows.filter((w) => w.provider === provider && (/five_hour|seven_day/.test(w.key) || provider === 'codex')).slice(0, 4).map((w, i) => ({ label: w.label, color: slot(i, dark), line: true })),
                          { label: 'Cap', color: CRITICAL, line: true, dashed: true }
                        ]}
                      />
                    }
                  >
                    <WindowsChart data={data} provider={provider} dark={dark} openHit={openHit} />
                  </Card>
                  <div className="mt-3.5 grid grid-cols-2 gap-3.5">
                    <Card title="Where it went" sub="Share of usage, weighted by model price">
                      <WhereBars data={data} dark={dark} />
                    </Card>
                    <Card title="By model" sub={`API-equivalent cost per ${data.bucket}`}>
                      <ModelBars data={data} dark={dark} />
                    </Card>
                    <Card title="Busiest hours" sub="Your time zone">
                      <Heatmap data={data} dark={dark} />
                    </Card>
                    <Card title="Limit hits" sub={hits.length ? 'Click one to see what filled the window' : undefined}>
                      {!hits.length ? (
                        <div className="py-10 text-center text-[12.5px] text-muted">No limit hits in this range.</div>
                      ) : (
                        <table className="w-full text-[12.5px]">
                          <thead>
                            <tr className="border-b border-line text-left text-muted">
                              <th className="py-1.5 font-medium">When</th>
                              <th className="py-1.5 font-medium">Window</th>
                              <th className="py-1.5 font-medium">Reached</th>
                              <th className="py-1.5 font-medium">Waited</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...hits].reverse().slice(0, 8).map((h) => (
                              <tr key={`${h.key}${h.t}`} className="cursor-pointer border-b border-line/50 hover:bg-hover" onClick={() => openHit(h)}>
                                <td className="py-1.5">{dayTime(h.t)}</td>
                                <td className="py-1.5">
                                  <span className="mr-1 text-[10px]" style={{ color: CRITICAL }}>▲</span>
                                  {h.label}
                                </td>
                                <td className="py-1.5 text-muted">{h.start ? `${dur(h.t - h.start)} in` : '–'}</td>
                                <td className="py-1.5 tabular-nums">{h.waitedMs ? dur(h.waitedMs) : '–'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </Card>
                  </div>
                  <p className="mt-3 text-[11.5px] leading-[1.45] text-faint">
                    Window percentages come from Claude Code’s /usage, saved while Choo Choo is open. Everything else comes from Claude Code’s own transcripts on this Mac, including sessions run in a terminal; Choo Choo keeps a summary of each response (no message text) so history outlives Claude Code’s 30-day cleanup. API-equivalent value is what the tokens would cost at API list prices. Nothing leaves this Mac.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
