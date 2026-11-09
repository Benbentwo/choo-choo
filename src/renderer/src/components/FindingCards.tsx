import { useState } from 'react'
import type { Chat, ReviewFinding } from '@shared/types'
import { useStore, openDoc } from '../store'
import { SEVERITY_STYLE, sendFix } from './RightTabs'

const ORDER: Record<ReviewFinding['severity'], number> = { high: 0, medium: 1, low: 2 }

/** A review's findings in the chat, most severe first: where, what's wrong, the suggested fix, and a Fix button. */
export function FindingCards({ chat, findings }: { chat: Chat; findings: ReviewFinding[] }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === chat.workspaceId))
  const [sent, setSent] = useState<Set<number>>(new Set())
  if (findings.length === 0) return <div className="not-prose mt-2 text-[12px] text-faint">No findings.</div>
  const sorted = findings.map((f, i) => ({ f, i })).sort((a, b) => ORDER[a.f.severity] - ORDER[b.f.severity])
  return (
    <div className="not-prose mt-3 space-y-2 font-sans">
      {sorted.map(({ f, i }) => (
        <div key={i} className="rounded-lg border border-line bg-panel px-3 py-2.5 text-[13px]">
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-medium uppercase ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
            <button
              className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-muted hover:text-fg hover:underline"
              title="Show this file's changes"
              onClick={() => ws && openDoc(ws.id, { kind: 'diff', path: f.file })}
            >
              {f.file}
              {f.line ? `:${f.line}` : ''}
            </button>
            {ws && (
              <button
                className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
                disabled={sent.has(i)}
                onClick={() => {
                  setSent(new Set(sent).add(i))
                  void sendFix(ws, f)
                }}
              >
                {sent.has(i) ? 'Sent' : 'Fix'}
              </button>
            )}
          </div>
          <div className="selectable mt-1.5">{f.message}</div>
          {f.fix && <div className="selectable mt-1 text-muted">Fix: {f.fix}</div>}
        </div>
      ))}
    </div>
  )
}
