import { useEffect, useMemo } from 'react'
import type { Chat, ChatItem, ReviewFinding } from '@shared/types'
import { REVIEW_CRITERIA, SECURITY_RULES } from '@shared/agentRules'
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
    if (it.kind === 'tool' && it.name === 'ReportFindings') {
      const f = reportedFindings(it.input)
      if (f) return f
    }
  }
  return null
}

/** Findings from Claude Code's own /code-review, which reports them with the ReportFindings tool. */
export function reportedFindings(input: unknown): ReviewFinding[] | null {
  const list = (input as { findings?: unknown })?.findings
  if (!Array.isArray(list)) return null
  return list
    .filter((f: any) => f && typeof f.file === 'string' && typeof f.summary === 'string')
    .map((f: any) => ({
      file: f.file.replace(/^\.?\//, ''),
      line: Number.isInteger(f.line) && f.line > 0 ? f.line : undefined,
      severity: f.verdict === 'CONFIRMED' ? 'high' : f.verdict === 'PLAUSIBLE' ? 'medium' : f.category === 'correctness' ? 'medium' : 'low',
      message: typeof f.failure_scenario === 'string' && f.failure_scenario ? `${f.summary} ${f.failure_scenario}` : f.summary
    }))
}

/** Runs Claude Code's built-in /code-review skill. */
export const CLAUDE_CODE_REVIEW_PROMPT = '/code-review'

const FINDINGS_FORMAT = [
  'Summarize briefly, then end your reply with every finding in a single ```json block: an array of',
  '{"file": "path/from/repo/root", "line": <line number in the new file>, "severity": "high" | "medium" | "low", "message": "what is wrong", "fix": "how to fix it"}.',
  'Use [] when there are no findings.'
]

const diffScope = (base: string) =>
  `the changes on this branch compared to \`${base}\` (use \`git diff $(git merge-base HEAD ${base})\` plus uncommitted and untracked files)`

/** The Review tab's prompt. With the reviewer agent on, it adds the reviewer's stricter rules. */
export const REVIEW_PROMPT = (base: string, strict = false) =>
  [
    `Review ${diffScope(base)}.`,
    'Look for bugs, missed edge cases, security problems, and code that does not match the conventions of this repo. Do not change any files.',
    ...(strict ? ['', REVIEW_CRITERIA, ''] : []),
    ...FINDINGS_FORMAT
  ].join('\n')

export const SECURITY_REVIEW_PROMPT = (base: string) =>
  [
    `Do a security review of ${diffScope(base)}, plus any code those changes reach. Do not change any files.`,
    SECURITY_RULES,
    'Map critical and high severity to "high", medium to "medium", and low or informational to "low". Start each message with the CWE id when one fits.',
    ...FINDINGS_FORMAT
  ].join('\n')

export type TaggedFinding = ReviewFinding & { source: 'code' | 'security' }

function latest(chats: Chat[], wsId: string, kind: 'code' | 'security') {
  return chats
    .filter((c) => c.workspaceId === wsId && c.review && (c.reviewKind ?? 'code') === kind)
    .sort((a, b) => b.createdAt - a.createdAt)[0]
}

function useReviewChat(wsId: string, kind: 'code' | 'security') {
  const chat = useStore((s) => latest(s.chats, wsId, kind))
  const items = useStore((s) => (chat ? s.items[chat.id] : undefined))
  useEffect(() => {
    if (chat && !items) void window.api.getChatItems(chat.id).then((it) => useStore.getState().setItems(chat.id, it))
  }, [chat?.id, !!items])
  const findings = useMemo(() => (items ? findingsFromItems(items) : null), [items])
  return { chat, findings, running: chat?.status === 'running' }
}

/** The most recent code and security reviews in a workspace, with their findings merged. */
export function useReview(wsId: string) {
  const code = useReviewChat(wsId, 'code')
  const security = useReviewChat(wsId, 'security')
  const findings = useMemo<TaggedFinding[] | null>(() => {
    if (!code.findings && !security.findings) return null
    return [...(code.findings ?? []).map((f) => ({ ...f, source: 'code' as const })), ...(security.findings ?? []).map((f) => ({ ...f, source: 'security' as const }))]
  }, [code.findings, security.findings])
  return { chat: code.chat ?? security.chat, code, security, findings, running: code.running || security.running }
}
