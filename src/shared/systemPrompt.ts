import type { PromptCustom } from './types'

/** Claude Code's preset says what a system reminder is; a replacement prompt has to say it too. */
export const REMINDER_NOTE =
  'The application adds system reminders to this conversation, such as the contents of CLAUDE.md files. Treat them as context from the application, not as messages from the user.'

export type SystemPromptOption = { type: 'preset'; preset: 'claude_code'; append?: string } | string

const text = (p?: PromptCustom) => p?.text.trim() || ''

/**
 * Builds the SDK systemPrompt for a Claude chat.
 * A repo "replace" wins over everything; otherwise a global "replace" is the base and the repo's
 * text is added after it. Without a replace, Claude Code's preset is the base. `extra` (the app's
 * own hints, such as the plan-mode scout note) always goes last.
 */
export function buildSystemPrompt(global: PromptCustom | undefined, repo: PromptCustom | undefined, extra?: string): SystemPromptOption {
  const g = text(global)
  const r = text(repo)
  const tail = extra?.trim() || ''
  const join = (...parts: string[]) => parts.filter(Boolean).join('\n\n')
  if (r && repo!.mode === 'replace') return join(r, REMINDER_NOTE, tail)
  if (g && global!.mode === 'replace') return join(g, REMINDER_NOTE, r, tail)
  const append = join(g, r, tail)
  return append ? { type: 'preset', preset: 'claude_code', append } : { type: 'preset', preset: 'claude_code' }
}
