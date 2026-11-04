import { useEffect, useMemo } from 'react'
import type { ChatItem, ReviewFinding } from '@shared/types'
import { useStore } from './store'

const SEVERITIES = new Set(['high', 'medium', 'low'])

/** Pulls findings out of the last ```json block in a review reply. */
export function parseFindings(text: string): ReviewFinding[] | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)]
  const raw = blocks.length ? blocks[blocks.length - 1][1] : null
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    const list = Array.isArray(data) ? data : Array.isArray(data?.findings) ? data.findings : null
    if (!list) return null
    return list
      .filter((f: any) => f && typeof f.file === 'string' && typeof f.message === 'string')
      .map((f: any) => ({
        file: f.file.replace(/^\.?\//, ''),
        line: Number.isInteger(f.line) && f.line > 0 ? f.line : undefined,
        severity: SEVERITIES.has(f.severity) ? f.severity : 'medium',
        message: f.message,
        fix: typeof f.fix === 'string' ? f.fix : undefined
      }))
  } catch {
    return null
  }
}

export function findingsFromItems(items: ChatItem[]): ReviewFinding[] | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'user') return null // the latest turn had no findings yet
    if (it.kind === 'assistant') {
      const f = parseFindings(it.text)
      if (f) return f
    }
  }
  return null
}

export const REVIEW_PROMPT = (base: string) =>
  [
    `Review the changes on this branch compared to \`${base}\` (use \`git diff $(git merge-base HEAD ${base})\` plus uncommitted and untracked files).`,
    'Look for bugs, missed edge cases, security problems, and code that does not match the conventions of this repo. Do not change any files.',
    'Summarize briefly, then end your reply with every finding in a single ```json block: an array of',
    '{"file": "path/from/repo/root", "line": <line number in the new file>, "severity": "high" | "medium" | "low", "message": "what is wrong", "fix": "how to fix it"}.',
    'Use [] when there are no findings.'
  ].join('\n')

/** The most recent review chat in a workspace and its parsed findings. */
export function useReview(wsId: string) {
  const chat = useStore((s) =>
    s.chats.filter((c) => c.workspaceId === wsId && c.review).sort((a, b) => b.createdAt - a.createdAt)[0]
  )
  const items = useStore((s) => (chat ? s.items[chat.id] : undefined))
  useEffect(() => {
    if (chat && !items) void window.api.getChatItems(chat.id).then((it) => useStore.getState().setItems(chat.id, it))
  }, [chat?.id, !!items])
  const findings = useMemo(() => (items ? findingsFromItems(items) : null), [items])
  return { chat, findings, running: chat?.status === 'running' }
}
