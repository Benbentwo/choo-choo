import { useEffect, useRef, useState } from 'react'
import type { LimitWindow, SubscriptionLimits } from '@shared/types'
import { pace, paceText } from '@shared/limitPace'
import { LimitsChart } from './LimitsChart'
import { useStore, openContinuePage } from '../store'

const ROTATE_MS = 12000
const FADE_MS = 600

function resetsIn(ts?: number): string {
  if (!ts) return ''
  const m = Math.max(0, Math.round((ts - Date.now()) / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

const barColor = (p: number) => (p >= 90 ? 'bg-del' : p >= 70 ? 'bg-amber-400' : 'bg-accent')

/**
 * Plan limits for the AI subscriptions in use, in the sidebar footer. With more than one
 * (Claude and Codex) it fades between them every few seconds; hover pauses, click skips ahead.
 */
export function LimitsFooter() {
  const [limits, setLimits] = useState<SubscriptionLimits[]>([])
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(true)
  const paused = useRef(false)
  const [detail, setDetail] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const running = useStore((s) => s.chats.filter((c) => c.status === 'running').length)
  const queue = useStore((s) => s.continueQueue)
  const limitedUntil = useStore((s) => (s.usageLimit ? (s.usageLimit.until ?? 0) : null))
  const prevRunning = useRef(running)

  const load = (force = false) => void window.api.subscriptionLimits(force).then(setLimits, () => {})

  useEffect(() => {
    load()
    const t = setInterval(() => load(true), 2 * 60_000)
    return () => clearInterval(t)
  }, [])

  // A turn just finished somewhere: limits have probably moved.
  useEffect(() => {
    if (running < prevRunning.current) load(true)
    prevRunning.current = running
  }, [running])

  const detailRef = useRef(false)
  detailRef.current = detail
  const step = () => {
    setShown(false)
    setTimeout(() => {
      setI((n) => n + 1)
      setShown(true)
    }, FADE_MS)
  }

  useEffect(() => {
    if (limits.length < 2) return
    const t = setInterval(() => !paused.current && !detailRef.current && step(), ROTATE_MS)
    return () => clearInterval(t)
  }, [limits.length])

  // Close the detail card on a click elsewhere.
  useEffect(() => {
    if (!detail) return
    const down = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setDetail(false)
    window.addEventListener('mousedown', down)
    return () => window.removeEventListener('mousedown', down)
  }, [detail])

  if (!limits.length) return null
  const cur = limits[i % limits.length]
  const now = Date.now()
  // The graph follows the shortest window that has timing, since it moves first.
  const graphed = (l: SubscriptionLimits): LimitWindow | undefined => l.windows.find((w) => pace(w, now))
  const g = graphed(cur)
  const gp = g ? pace(g, now) : null
  // Keep the height of the tallest provider so the sidebar doesn't jump as it rotates.
  const rows = Math.max(...limits.map((l) => Math.min(3, l.windows.length)))
  const anyGraph = limits.some((l) => graphed(l))
  return (
    <div ref={box} className="relative">
      {detail && <LimitsDetail l={cur} now={now} />}
      <div
        className="block w-full cursor-pointer px-3 pt-2 pb-1 text-left"
        role="button"
        onMouseEnter={() => (paused.current = true)}
        onMouseLeave={() => (paused.current = false)}
        onClick={() => setDetail(!detail)}
        title="Plan limits. Click for details."
      >
        <div className="transition-opacity ease-out" style={{ opacity: shown ? 1 : 0, transitionDuration: `${FADE_MS}ms`, minHeight: 20 + rows * 20 + (anyGraph ? 64 : 0) }}>
          <div className="mb-1 flex items-baseline gap-1.5 text-[11px]">
            <span className="font-medium text-muted">{cur.name}</span>
            {cur.plan && <span className="text-faint capitalize">{cur.plan}</span>}
            {limits.length > 1 && (
              <span className="ml-auto flex gap-1.5">
                {limits.map((l, k) => (
                  <span
                    key={l.provider}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (k !== i % limits.length) step()
                    }}
                    className={`h-1.5 w-1.5 rounded-full ${k === i % limits.length ? 'bg-muted' : 'bg-line hover:bg-faint'}`}
                  />
                ))}
              </span>
            )}
          </div>
          {g && gp && (
            <div className="mb-1.5">
              <LimitsChart w={g} p={gp} height={40} now={now} />
              <div className={`mt-1 truncate text-[10.5px] ${gp.status === 'on-track' ? 'text-faint' : gp.status === 'ahead' ? 'text-amber-400' : 'text-del'}`} title={paceText(g, gp, now)}>
                {g.label}: {paceText(g, gp, now)}
              </div>
            </div>
          )}
          {cur.windows.slice(0, 3).map((w) => (
            <div key={w.key} className="mb-1 flex items-center gap-2 text-[11px] text-faint">
              <span className="w-[72px] shrink-0 truncate">{w.label}</span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                <span className={`block h-full rounded-full ${barColor(w.percent)}`} style={{ width: `${Math.min(100, Math.max(0, w.percent))}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums text-muted">{Math.round(w.percent)}%</span>
              <span className="w-7 shrink-0 text-right tabular-nums" title={w.resetsAt ? `Resets ${new Date(w.resetsAt).toLocaleString()}` : undefined}>
                {resetsIn(w.resetsAt)}
              </span>
            </div>
          ))}
        </div>
      </div>
      {(queue.length > 0 || limitedUntil !== null) && (
        <button className="block w-full truncate px-3 pb-1.5 text-left text-[11px] text-amber-400 hover:underline" onClick={openContinuePage} title="Open Up next">
          ❚❚ {[queue.filter((q) => q.source === 'paused').length ? `${queue.filter((q) => q.source === 'paused').length} paused` : '', `${queue.length} up next`].filter(Boolean).join(' · ')}
          {limitedUntil ? ` at ${new Date(limitedUntil + 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
        </button>
      )}
    </div>
  )
}

/** Bigger graphs for every window of one subscription, above the footer. */
function LimitsDetail({ l, now }: { l: SubscriptionLimits; now: number }) {
  return (
    <div className="absolute bottom-full left-2 z-40 mb-1 w-[340px] rounded-lg border border-line bg-raised p-3 shadow-2xl">
      <div className="mb-2 text-[12px]">
        <span className="font-medium">{l.name}</span> {l.plan && <span className="text-faint capitalize">{l.plan}</span>}
      </div>
      {l.windows.map((w) => {
        const p = pace(w, now)
        return (
          <div key={w.key} className="mb-3 last:mb-0">
            <div className="mb-1 flex items-baseline text-[11px]">
              <span className="text-muted">{w.label}</span>
              <span className="ml-auto tabular-nums">{Math.round(w.percent)}%</span>
              {w.resetsAt && <span className="ml-2 text-faint">resets {new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
            </div>
            {p ? (
              <>
                <LimitsChart w={w} p={p} height={88} now={now} labels />
                <div className={`mt-1 text-[11px] ${p.status === 'on-track' ? 'text-faint' : p.status === 'ahead' ? 'text-amber-400' : 'text-del'}`}>{paceText(w, p, now)}</div>
              </>
            ) : (
              <div className="text-[11px] text-faint">No reset time reported, so there's nothing to graph.</div>
            )}
          </div>
        )
      })}
      <div className="mt-2 border-t border-line pt-2 text-[10.5px] text-faint">
        Dotted diagonal: an even pace. Dashed: where the current rate leads. Red line: the cap. Graph fills in as readings are taken.
      </div>
    </div>
  )
}
