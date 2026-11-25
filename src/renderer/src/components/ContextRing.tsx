import { useEffect, useState } from 'react'
import type { Chat, ChatContext } from '@shared/types'
import { contextGauge, contextGaugeTitle } from '@shared/contextGauge'
import { useStore } from '../store'

const R = 6
const C = 2 * Math.PI * R
const TONE = { ok: 'text-muted', warn: 'text-amber-400', full: 'text-del' }

/**
 * How full this chat's context window is, as a ring in the composer.
 * Deliberately a ring (the plan usage gauges are bars) and neutral until 70%. See docs/prd/context-ring.md.
 */
export function ContextRing({ chat }: { chat: Chat }) {
  const [usage, setUsage] = useState<{ chatId: string; u: ChatContext | null } | null>(null)
  const itemCount = useStore((s) => s.items[chat.id]?.length ?? 0)
  const set = useStore((s) => s.set)

  // Refresh once the stream goes quiet for a moment (main reads only what was appended).
  useEffect(() => {
    let live = true
    const t = setTimeout(() => void window.api.getChatContext(chat.id).then((u) => live && setUsage({ chatId: chat.id, u })), usage?.chatId === chat.id ? 1500 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [chat.id, chat.status, itemCount])

  if (chat.model === 'codex') return null
  const g = contextGauge(usage?.chatId === chat.id ? usage.u : null)
  if (!g) return null
  return (
    <button
      data-testid="context-ring"
      className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-faint hover:bg-hover hover:text-fg"
      title={contextGaugeTitle(g)}
      aria-label={`Context ${g.percent}% used`}
      onClick={() => set({ modal: 'usage', usageChat: chat.id })}
    >
      <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
        <circle cx={8} cy={8} r={R} fill="none" stroke="var(--color-line)" strokeWidth={2} />
        <circle className={TONE[g.level]} cx={8} cy={8} r={R} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray={`${(g.percent / 100) * C} ${C}`} transform="rotate(-90 8 8)" />
        {g.compactions > 0 && <circle cx={8} cy={8} r={1.5} fill="var(--color-faint)" />}
      </svg>
      {/* Always labelled: a bare partial ring reads as a loading spinner. */}
      <span className={g.level === 'ok' ? '' : TONE[g.level]}>{g.percent}%</span>
    </button>
  )
}
