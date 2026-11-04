import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import type { SlashCommandInfo } from '@shared/types'

export const BUILTIN_COMMANDS: SlashCommandInfo[] = [
  { name: 'compact', description: 'Summarize the conversation to free up context' },
  { name: 'clear', description: 'Start the conversation over' },
  { name: 'review', description: 'Review the changes in this workspace' },
  { name: 'init', description: 'Write a CLAUDE.md for this repo' },
  { name: 'pr-comments', description: 'Address comments on the pull request' },
  { name: 'security-review', description: 'Security review of pending changes' },
  { name: 'cost', description: 'Show token usage and cost' },
  { name: 'context', description: 'Show context window usage' }
]

function description(file: string): string | undefined {
  try {
    const text = readFileSync(file, 'utf8')
    const fm = text.match(/^---\n([\s\S]*?)\n---/)
    const d = fm?.[1].match(/^description:\s*(.+)$/m)?.[1]
    if (d) return d.trim().replace(/^["']|["']$/g, '')
    return text.replace(/^---[\s\S]*?---/, '').trim().split('\n')[0]?.slice(0, 80) || undefined
  } catch {
    return undefined
  }
}

function scan(dir: string, out: Map<string, SlashCommandInfo>) {
  if (!existsSync(dir)) return
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (e.endsWith('.md')) {
        const name = relative(dir, p).replace(/\.md$/, '').split('/').join(':')
        if (!out.has(name)) out.set(name, { name, description: description(p) })
      }
    }
  }
  walk(dir)
}

/** Commands from the worktree, the user's ~/.claude, built-ins and whatever the agent last reported. */
export function listCommands(worktree: string, reported: string[] = []): SlashCommandInfo[] {
  const out = new Map<string, SlashCommandInfo>()
  scan(join(worktree, '.claude', 'commands'), out)
  scan(join(homedir(), '.claude', 'commands'), out)
  for (const skillsDir of [join(worktree, '.claude', 'skills'), join(homedir(), '.claude', 'skills')]) {
    if (!existsSync(skillsDir)) continue
    for (const e of readdirSync(skillsDir)) {
      const f = join(skillsDir, e, 'SKILL.md')
      if (existsSync(f) && !out.has(e)) out.set(e, { name: e, description: description(f) })
    }
  }
  for (const c of BUILTIN_COMMANDS) if (!out.has(c.name)) out.set(c.name, c)
  for (const r of reported) if (!out.has(r)) out.set(r, { name: r })
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}
