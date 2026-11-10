import { useEffect, useRef, useState } from 'react'
import type { SubscriptionLimits } from '@shared/types'
import { useStore } from '../store'

const ROTATE_MS = 5000
const FADE_MS = 300

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
  const running = useStore((s) => s.chats.filter((c) => c.status === 'running').length)
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

  const step = () => {
    setShown(false)
    setTimeout(() => {
      setI((n) => n + 1)
      setShown(true)
    }, FADE_MS)
  }

  useEffect(() => {
    if (limits.length < 2) return
    const t = setInterval(() => !paused.current && step(), ROTATE_MS)
    return () => clearInterval(t)
  }, [limits.length])

  if (!limits.length) return null
  const cur = limits[i % limits.length]
  // Keep the height of the tallest provider so the sidebar doesn't jump as it rotates.
  const rows = Math.max(...limits.map((l) => Math.min(3, l.windows.length)))
  return (
    <button
      className="block w-full px-3 pt-2 pb-1 text-left"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onClick={() => limits.length > 1 && step()}
      title={limits.length > 1 ? 'Plan limits. Click for the next one.' : 'Plan limits'}
    >
      <div className="transition-opacity ease-out" style={{ opacity: shown ? 1 : 0, transitionDuration: `${FADE_MS}ms`, minHeight: 20 + rows * 20 }}>
        <div className="mb-1 flex items-baseline gap-1.5 text-[11px]">
          <span className="font-medium text-muted">{cur.name}</span>
          {cur.plan && <span className="text-faint capitalize">{cur.plan}</span>}
          {limits.length > 1 && (
            <span className="ml-auto flex gap-1">
              {limits.map((l, k) => (
                <span key={l.provider} className={`h-1 w-1 rounded-full ${k === i % limits.length ? 'bg-muted' : 'bg-line'}`} />
              ))}
            </span>
          )}
        </div>
        {cur.windows.slice(0, 3).map((w) => (
          <div key={w.label} className="mb-1 flex items-center gap-2 text-[11px] text-faint">
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
    </button>
  )
}
