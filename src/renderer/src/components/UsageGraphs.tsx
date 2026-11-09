import { useEffect, useMemo, useState } from 'react'
import type { Chat, SessionUsage, UsagePoint } from '@shared/types'
import { useStore } from '../store'
import { fmt as fmtK } from './Stats'

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : fmtK(n))

/** Usage and context graphs for one chat, built from Claude Code's own transcript. */

type Series = 'input' | 'cacheWrite' | 'cacheRead' | 'output'
const SERIES: { id: Series; label: string; light: string; dark: string }[] = [
  { id: 'input', label: 'Input', light: '#2a78d6', dark: '#3987e5' },
  { id: 'cacheWrite', label: 'Cache write', light: '#eb6834', dark: '#d95926' },
  { id: 'cacheRead', label: 'Cache read', light: '#1baf7a', dark: '#199e70' },
  { id: 'output', label: 'Output', light: '#eda100', dark: '#c98500' }
]
const CONTEXT = { light: '#2a78d6', dark: '#3987e5' }

const W = 720
const H = 170
const M = { l: 44, r: 12, t: 10, b: 22 }
const IW = W - M.l - M.r
const IH = H - M.t - M.b

const ctx = (p: UsagePoint) => p.input + p.cacheWrite + p.cacheRead + p.output
const total = (p: UsagePoint, on: Set<Series>) => SERIES.reduce((n, s) => n + (on.has(s.id) ? p[s.id] : 0), 0)
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** A round axis maximum and its ticks, about four of them. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  const out: number[] = []
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(v)
  return out
}

type Mode = 'turn' | 'time'
type View = Mode | 'table'

function useScale(points: UsagePoint[], mode: Mode) {
  return useMemo(() => {
    const n = points.length
    const t0 = points[0]?.ts ?? 0
    const t1 = points[n - 1]?.ts ?? 0
    const band = IW / Math.max(1, n)
    const x = (i: number) => (mode === 'turn' || t1 === t0 ? M.l + (i + 0.5) * band : M.l + ((points[i].ts - t0) / (t1 - t0)) * IW)
    const xAt = (ts: number) => {
      if (mode === 'time') return t1 === t0 ? M.l + IW / 2 : M.l + ((ts - t0) / (t1 - t0)) * IW
      const i = points.findIndex((p) => p.ts >= ts)
      return M.l + (i < 0 ? n : i) * band
    }
    const barW = mode === 'turn' ? Math.max(1, Math.min(24, band - 2)) : 3
    const nearest = (px: number) => {
      let best = 0
      for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
      return best
    }
    const ticks: { at: number; label: string }[] = []
    if (n) {
      if (mode === 'turn') {
        const step = Math.max(1, Math.ceil(n / 6))
        for (let i = 0; i < n; i += step) ticks.push({ at: x(i), label: String(i + 1) })
      } else {
        for (let k = 0; k <= 4; k++) ticks.push({ at: M.l + (k / 4) * IW, label: clock(t0 + ((t1 - t0) * k) / 4) })
      }
    }
    // Responses that answer something you just sent, marked on the x axis.
    const messages = points.flatMap((p, i) => (p.afterMessage ? [x(i)] : []))
    return { x, xAt, barW, nearest, ticks, edgeTicks: mode === 'time', messages }
  }, [points, mode])
}

type Scale = ReturnType<typeof useScale>

function Frame({ yTicks, yMax, scale, hover, setHover, children, label }: { yTicks: number[]; yMax: number; scale: Scale; hover: number | null; setHover: (i: number | null) => void; children: React.ReactNode; label: string }) {
  const y = (v: number) => M.t + IH - (v / yMax) * IH
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className="block select-none"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setHover(scale.nearest(((e.clientX - r.left) / r.width) * W))
      }}
      onPointerLeave={() => setHover(null)}
    >
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} opacity={v === 0 ? 1 : 0.5} />
          <text x={M.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--color-faint)">
            {fmt(Math.round(v))}
          </text>
        </g>
      ))}
      {scale.ticks.map((t, i) => (
        <text key={i} x={t.at} y={H - 6} textAnchor={scale.edgeTicks && i === 0 ? 'start' : scale.edgeTicks && i === scale.ticks.length - 1 ? 'end' : 'middle'} fontSize={10} fill="var(--color-faint)">
          {t.label}
        </text>
      ))}
      {scale.messages.map((at, i) => (
        <path key={`m${i}`} d={`M${at.toFixed(1)},${M.t + IH + 1}l4,6h-8z`} fill="var(--color-accent)">
          <title>You sent a message</title>
        </path>
      ))}
      {children}
      {hover != null && <line x1={scale.x(hover)} x2={scale.x(hover)} y1={M.t} y2={M.t + IH} stroke="var(--color-muted)" strokeWidth={1} pointerEvents="none" />}
    </svg>
  )
}

function UsageChart({ points, scale, on, dark, hover, setHover }: { points: UsagePoint[]; scale: Scale; on: Set<Series>; dark: boolean; hover: number | null; setHover: (i: number | null) => void }) {
  const ticks = niceTicks(Math.max(1, ...points.map((p) => total(p, on))))
  const yMax = ticks[ticks.length - 1]
  const h = (v: number) => (v / yMax) * IH
  return (
    <Frame yTicks={ticks} yMax={yMax} scale={scale} hover={hover} setHover={setHover} label="Tokens per Claude response">
      {points.map((p, i) => {
        let top = M.t + IH
        const segs = SERIES.filter((s) => on.has(s.id) && p[s.id] > 0)
        return (
          <g key={i} opacity={p.subagent ? 0.55 : hover == null || hover === i ? 1 : 0.75}>
            {segs.map((s, k) => {
              const hh = h(p[s.id])
              top -= hh
              // A 1px gap between stacked segments keeps them apart.
              const gap = k < segs.length - 1 && hh > 2 ? 1 : 0
              return <rect key={s.id} x={scale.x(i) - scale.barW / 2} y={top + gap} width={scale.barW} height={Math.max(0, hh - gap)} rx={k === segs.length - 1 ? Math.min(2, scale.barW / 2) : 0} fill={dark ? s.dark : s.light} />
            })}
          </g>
        )
      })}
    </Frame>
  )
}

function ContextChart({ points, usage, scale, dark, hover, setHover }: { points: UsagePoint[]; usage: SessionUsage; scale: Scale; dark: boolean; hover: number | null; setHover: (i: number | null) => void }) {
  const main = points.map((p, i) => ({ p, i })).filter(({ p }) => !p.subagent)
  const peak = Math.max(0, ...main.map(({ p }) => ctx(p)))
  const ticks = niceTicks(Math.max(usage.contextWindow, peak))
  const yMax = ticks[ticks.length - 1]
  const y = (v: number) => M.t + IH - (v / yMax) * IH
  const color = dark ? CONTEXT.dark : CONTEXT.light
  const line = main.map(({ p, i }, k) => `${k ? 'L' : 'M'}${scale.x(i).toFixed(1)},${y(ctx(p)).toFixed(1)}`).join('')
  const area = main.length ? `${line}L${scale.x(main[main.length - 1].i).toFixed(1)},${y(0)}L${scale.x(main[0].i).toFixed(1)},${y(0)}Z` : ''
  const hp = hover != null ? points[hover] : null
  return (
    <Frame yTicks={ticks} yMax={yMax} scale={scale} hover={hover} setHover={setHover} label="Context window fill per Claude response">
      <line x1={M.l} x2={W - M.r} y1={y(usage.contextWindow)} y2={y(usage.contextWindow)} stroke="var(--color-del)" strokeWidth={1} strokeDasharray="4 3" />
      <text x={M.l + 4} y={y(usage.contextWindow) + 12} textAnchor="start" fontSize={10} fill="var(--color-muted)">
        Limit {fmt(usage.contextWindow)}
      </text>
      {usage.compactions.map((ts) => (
        <g key={ts}>
          <line x1={scale.xAt(ts)} x2={scale.xAt(ts)} y1={M.t} y2={M.t + IH} stroke="var(--color-muted)" strokeWidth={1} strokeDasharray="2 3" />
          <text x={scale.xAt(ts) + 3} y={M.t + 9} fontSize={10} fill="var(--color-muted)">
            Compacted
          </text>
        </g>
      ))}
      <path d={area} fill={color} opacity={0.15} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {hp && !hp.subagent && <circle cx={scale.x(hover!)} cy={y(ctx(hp))} r={4} fill={color} stroke="var(--color-panel)" strokeWidth={2} />}
    </Frame>
  )
}

/** What a response was about, shown over the usage chart while hovering it. */
function TurnPopup({ p, i, left }: { p: UsagePoint; i: number; left: number }) {
  if (!p.prompt && !p.did) return null
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 w-[300px] rounded-md border border-line bg-raised px-3 py-2 text-[12px] [overflow-wrap:anywhere] shadow-xl"
      style={left > 55 ? { right: `${100 - left + 2}%` } : { left: `${left + 2}%` }}
    >
      <div className="mb-1 text-faint">
        Response {i + 1} · {clock(p.ts)}
        {p.subagent && ' · subagent'}
        {p.afterMessage && <span className="text-accent"> · after your message</span>}
      </div>
      {p.prompt && (
        <div className="mb-1">
          <span className="text-faint">You: </span>
          {p.prompt}
        </div>
      )}
      {p.did && (
        <div className="text-muted">
          <span className="text-faint">Claude: </span>
          {p.did}
        </div>
      )}
    </div>
  )
}

function Tooltip({ p, i, usage }: { p: UsagePoint; i: number; usage: SessionUsage }) {
  const rows: [string, number][] = [
    ['Input', p.input],
    ['Cache write', p.cacheWrite],
    ['Cache read', p.cacheRead],
    ['Output', p.output]
  ]
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[12px]">
      <span className="text-muted">
        Response {i + 1} · {clock(p.ts)} · {p.model.replace(/^claude-/, '')}
        {p.subagent && ' · subagent'}
      </span>
      {rows.map(([k, v]) => (
        <span key={k}>
          <b className="font-medium">{v.toLocaleString()}</b> <span className="text-faint">{k.toLowerCase()}</span>
        </span>
      ))}
      {!p.subagent && (
        <span>
          <b className="font-medium">{Math.round((ctx(p) / usage.contextWindow) * 100)}%</b> <span className="text-faint">of context</span>
        </span>
      )}
    </div>
  )
}

export function UsageGraphs({ chat, compact }: { chat: Chat; compact?: boolean }) {
  const [usage, setUsage] = useState<SessionUsage | null>(null)
  const [view, setView] = useState<View>('turn')
  const mode: Mode = view === 'time' ? 'time' : 'turn'
  const [on, setOn] = useState<Set<Series>>(() => new Set(SERIES.map((s) => s.id)))
  const [hover, setHover] = useState<number | null>(null)
  const itemCount = useStore((s) => s.items[chat.id]?.length ?? 0)
  const dark = document.documentElement.style.colorScheme !== 'light'

  // Refresh as the chat runs: each new item usually means a new response.
  useEffect(() => {
    let live = true
    const t = setTimeout(() => void window.api.getChatUsage(chat.id).then((u) => live && setUsage(u)), usage ? 400 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [chat.id, chat.status, itemCount])

  const points = usage?.points ?? []
  const scale = useScale(points, mode)
  if (!usage) return <div className="px-5 py-10 text-center text-faint">Loading…</div>
  if (!points.length) return <div className="px-5 py-10 text-center text-faint">{usage.empty}</div>

  const sum = (k: Series) => points.reduce((n, p) => n + p[k], 0)
  const main = points.filter((p) => !p.subagent)
  const lastCtx = main.length ? ctx(main[main.length - 1]) : 0
  const toggle = (id: Series) => {
    const next = new Set(on)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (next.size) setOn(next)
  }
  const btn = (active: boolean) => `rounded px-2 py-0.5 ${active ? 'bg-hover text-fg' : 'text-muted hover:text-fg'}`

  return (
    <div className={compact ? 'px-3 py-3' : 'px-5 py-4'}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <Stat label="responses" value={String(points.length)} />
        <Stat label="tokens" value={fmt(SERIES.reduce((n, s) => n + sum(s.id), 0))} />
        <Stat label="output" value={fmt(sum('output'))} />
        {usage.costUsd != null && <Stat label="at API prices" value={`$${usage.costUsd.toFixed(2)}`} title={API_PRICE_NOTE} />}
        <Stat label="context now" value={`${Math.round((lastCtx / usage.contextWindow) * 100)}%`} />
        <div className="ml-auto flex gap-1 text-[12px]" role="tablist" aria-label="X axis">
          <button className={btn(view === 'turn')} onClick={() => setView('turn')}>
            By response
          </button>
          <button className={btn(view === 'time')} onClick={() => setView('time')}>
            By time
          </button>
          <button className={btn(view === 'table')} onClick={() => setView('table')}>
            Table
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <UsageTable points={points} usage={usage} />
      ) : (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className="font-medium">Usage</span>
            <span className="text-faint">tokens per Claude response</span>
            <div className="ml-auto flex gap-3">
              {SERIES.map((s) => (
                <button key={s.id} className={`flex items-center gap-1.5 ${on.has(s.id) ? 'text-muted' : 'text-faint line-through'}`} onClick={() => toggle(s.id)} title="Show or hide">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: dark ? s.dark : s.light, opacity: on.has(s.id) ? 1 : 0.3 }} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <UsageChart points={points} scale={scale} on={on} dark={dark} hover={hover} setHover={setHover} />
            {hover != null && <TurnPopup p={points[hover]} i={hover} left={(scale.x(hover) / W) * 100} />}
          </div>
          <div className="mt-4 mb-1 flex items-center gap-3 text-[12px]">
            <span className="font-medium">Context</span>
            <span className="text-faint">tokens in the window after each response</span>
          </div>
          <ContextChart points={points} usage={usage} scale={scale} dark={dark} hover={hover} setHover={setHover} />
          <div className="mt-2 min-h-[20px]">
            {hover != null ? <Tooltip p={points[hover]} i={hover} usage={usage} /> : <span className="text-[12px] text-faint">Hover a graph for details. ▲ on the axis marks the first response after each of your messages. Faded bars are subagent responses, which don't fill this chat's context.</span>}
          </div>
        </>
      )}
    </div>
  )
}

/** Claude Code's total_cost_usd is priced at API list rates; a subscription isn't billed it. */
export const API_PRICE_NOTE = "Claude Code's estimate at API list prices. On a Claude subscription you aren't charged this; usage counts toward your plan's limits instead."

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span title={title}>
      <span className="text-[15px] font-medium">{value}</span> <span className="text-[12px] text-faint">{label}</span>
    </span>
  )
}

function UsageTable({ points, usage }: { points: UsagePoint[]; usage: SessionUsage }) {
  const td = 'px-2 py-1 text-right tabular-nums'
  return (
    <div className="max-h-[360px] overflow-y-auto rounded-md border border-line">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-raised text-faint">
          <tr>
            <th className="px-2 py-1 text-left font-normal">#</th>
            <th className="px-2 py-1 text-left font-normal">Time</th>
            <th className="px-2 py-1 text-left font-normal">Model</th>
            <th className={`${td} font-normal`}>Input</th>
            <th className={`${td} font-normal`}>Cache write</th>
            <th className={`${td} font-normal`}>Cache read</th>
            <th className={`${td} font-normal`}>Output</th>
            <th className={`${td} font-normal`}>Context</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i} className="border-t border-line">
              <td className="px-2 py-1 text-faint">{i + 1}</td>
              <td className="px-2 py-1">{clock(p.ts)}</td>
              <td className="px-2 py-1">
                {p.model.replace(/^claude-/, '')}
                {p.subagent && <span className="text-faint"> · subagent</span>}
              </td>
              <td className={td}>{p.input.toLocaleString()}</td>
              <td className={td}>{p.cacheWrite.toLocaleString()}</td>
              <td className={td}>{p.cacheRead.toLocaleString()}</td>
              <td className={td}>{p.output.toLocaleString()}</td>
              <td className={td}>{p.subagent ? '–' : `${Math.round((ctx(p) / usage.contextWindow) * 100)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
