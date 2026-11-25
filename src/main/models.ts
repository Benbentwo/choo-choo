import { query } from '@anthropic-ai/claude-agent-sdk'
import { tmpdir } from 'node:os'
import type { ModelDetails, ModelId } from '@shared/types'
import { claudeExecutable } from './claudeBinary'

const ALIASES: ModelId[] = ['opus', 'fable', 'sonnet', 'haiku']
let cached: Promise<Partial<Record<ModelId, ModelDetails>>> | null = null

/** Asks the Agent SDK which model each alias points at (e.g. opus → Opus 5.5). Runs once per launch. */
export function modelDetails() {
  cached ??= load().catch(() => {
    cached = null // try again next time
    return {}
  })
  return cached
}

let stylesCached: Promise<string[]> | null = null

/**
 * Asks Claude Code which output styles it has: its built-ins and those from your plugins and
 * ~/.claude. Runs once per launch; an empty list when it can't be asked.
 */
export function cliOutputStyles() {
  stylesCached ??= probe(['user'], async (q) => ((await q.initializationResult()) as { available_output_styles?: string[] }).available_output_styles ?? []).catch(() => {
    stylesCached = null
    return []
  })
  return stylesCached
}

/** Starts an idle Claude Code session, asks it one thing, then stops it. */
async function probe<T>(settingSources: string[], ask: (q: any) => Promise<T>): Promise<T> {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  async function* idle() {
    await gate
  }
  const abort = new AbortController()
  const q = query({
    prompt: idle(),
    // No hooks or MCP servers: this session only answers a question, it should have no side effects.
    options: {
      abortController: abort,
      cwd: tmpdir(),
      pathToClaudeCodeExecutable: claudeExecutable(),
      persistSession: false,
      settingSources,
      settings: { disableAllHooks: true },
      strictMcpConfig: true
    } as never
  })
  try {
    return await Promise.race([ask(q), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 30_000))])
  } finally {
    release()
    abort.abort()
  }
}

async function load() {
  const list: { value: string; displayName: string; description: string; resolvedModel?: string }[] = await probe([], (q) => q.supportedModels())
  const out: Partial<Record<ModelId, ModelDetails>> = {}
  for (const m of list) {
    if (ALIASES.includes(m.value as ModelId)) out[m.value as ModelId] = { displayName: m.displayName, description: m.description, resolvedModel: m.resolvedModel }
  }
  return out
}
