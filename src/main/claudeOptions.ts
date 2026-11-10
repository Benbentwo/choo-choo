/**
 * Claude Code features exposed per chat: permission mode, fast mode, output style, spend cap,
 * /goal state and background tasks. Pure helpers, so they are easy to test.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { BackgroundTask, Chat, ChatGoal, Extras, OutputStyleInfo, Settings } from '@shared/types'
import { claudeAdvisorOptions } from './extras'

/** The SDK permission mode for a chat. */
export function permissionMode(chat: Pick<Chat, 'planMode' | 'permission'>): string {
  if (chat.planMode) return 'plan'
  if (!chat.permission || chat.permission === 'full') return 'bypassPermissions'
  if (chat.permission === 'auto') return 'auto'
  return 'default'
}

/**
 * What canUseTool returns once the user has answered (or skipped) an AskUserQuestion card.
 * Claude Code reads the picks from `answers` (question text -> answer, several picks comma-separated).
 */
export function questionReply(
  input: Record<string, unknown>,
  decision: string,
  answers: Record<string, string> | undefined
): { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string } {
  const given = Object.fromEntries(Object.entries(answers ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()))
  if (decision === 'deny' || !Object.keys(given).length) {
    return { behavior: 'deny', message: 'The user skipped the question without answering. Ask in chat if you still need an answer, or carry on with your best judgment.' }
  }
  return { behavior: 'allow', updatedInput: { ...input, answers: given } }
}

/** Session settings for a chat (the SDK's `settings` option and extra env), or nothing to pass. */
export function chatSettings(chat: Pick<Chat, 'fast' | 'outputStyle'>, extras: Extras): { settings?: Record<string, unknown>; env: Record<string, string> } {
  const advisor = claudeAdvisorOptions(extras.claudeAdvisor)
  const settings: Record<string, unknown> = { ...advisor.settings }
  if (chat.fast) settings.fastMode = true
  if (chat.outputStyle) settings.outputStyle = chat.outputStyle
  return { settings: Object.keys(settings).length ? settings : undefined, env: { ...advisor.env } }
}

/** The spend cap for one message, in dollars, or undefined for none. */
export function budgetFor(chat: Pick<Chat, 'budgetUsd'>, settings: Pick<Settings, 'defaultBudgetUsd'>): number | undefined {
  const b = chat.budgetUsd ?? settings.defaultBudgetUsd
  return b && b > 0 ? b : undefined
}

const GOAL_CLEAR = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel'])

/** For a `/goal …` message: the condition it sets, null when it clears the goal, undefined otherwise (including a bare status check). */
export function goalCommand(text: string): string | null | undefined {
  const m = text.trim().match(/^\/goal(?:\s+([\s\S]*))?$/)
  if (!m) return undefined
  const arg = (m[1] ?? '').trim()
  if (!arg) return undefined
  return GOAL_CLEAR.has(arg.toLowerCase()) ? null : arg
}

/** The goal from an SDK active_goal message; undefined when it was cleared or met. */
export function goalFrom(value: unknown): ChatGoal | undefined {
  const v = value as { condition?: string; set_at?: number; iterations?: number; last_reason?: string } | null
  if (!v?.condition) return undefined
  return { condition: v.condition, setAt: v.set_at ?? Date.now(), iterations: v.iterations ?? 0, ...(v.last_reason ? { lastReason: v.last_reason } : {}) }
}

/** Applies a task_started / task_updated / task_progress / task_notification message. Returns true when the list changed. */
export function applyTaskEvent(tasks: Map<string, BackgroundTask>, msg: any): boolean {
  if (msg?.type !== 'system' || typeof msg.task_id !== 'string') return false
  if (msg.ambient || msg.skip_transcript) return false
  const t = tasks.get(msg.task_id)
  switch (msg.subtype) {
    case 'task_started':
      tasks.set(msg.task_id, { id: msg.task_id, description: msg.description || msg.workflow_name || 'Task', type: msg.task_type, status: 'running', startedAt: Date.now() })
      return true
    case 'task_progress':
      if (!t || !msg.summary || msg.summary === t.summary) return false
      t.summary = msg.summary
      return true
    case 'task_updated': {
      if (!t) return false
      const s = msg.patch?.status
      if (msg.patch?.description) t.description = msg.patch.description
      if (s === 'completed' || s === 'failed') t.status = s
      else if (s === 'killed') t.status = 'stopped'
      return true
    }
    case 'task_notification':
      if (!t) return false
      t.status = msg.status === 'completed' || msg.status === 'failed' ? msg.status : 'stopped'
      if (msg.summary) t.summary = msg.summary
      return true
  }
  return false
}

/** Tasks still running, oldest first. */
export function runningTasks(tasks: Map<string, BackgroundTask>): BackgroundTask[] {
  return [...tasks.values()].filter((t) => t.status === 'running').sort((a, b) => a.startedAt - b.startedAt)
}

export const BUILTIN_OUTPUT_STYLES: OutputStyleInfo[] = [
  { name: 'Explanatory', description: 'Explains its choices and the codebase as it works', source: 'built-in' },
  { name: 'Learning', description: 'Pauses to have you write small pieces yourself', source: 'built-in' }
]

/** Reads name and description from an output style file's frontmatter. */
export function parseOutputStyle(file: string, text: string, source: 'user' | 'project'): OutputStyleInfo {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? ''
  const field = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')
  return { name: field('name') || basename(file, '.md'), description: field('description') || '', source }
}

/** Output styles for a checkout: built-in, then ~/.claude/output-styles, then the repo's .claude/output-styles. */
export function listOutputStyles(cwd: string, home = homedir()): OutputStyleInfo[] {
  const out = [...BUILTIN_OUTPUT_STYLES]
  for (const [dir, source] of [
    [join(home, '.claude', 'output-styles'), 'user'],
    [join(cwd, '.claude', 'output-styles'), 'project']
  ] as const) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
      try {
        const style = parseOutputStyle(f, readFileSync(join(dir, f), 'utf8'), source)
        const i = out.findIndex((o) => o.name === style.name)
        if (i >= 0) out[i] = style
        else out.push(style)
      } catch {
        // unreadable file: skip
      }
    }
  }
  return out
}
