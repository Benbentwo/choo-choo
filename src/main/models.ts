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

async function load() {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  async function* idle() {
    await gate
  }
  const abort = new AbortController()
  const q = query({
    prompt: idle(),
    options: { abortController: abort, cwd: tmpdir(), pathToClaudeCodeExecutable: claudeExecutable(), persistSession: false, settingSources: [] } as never
  })
  try {
    const list = await Promise.race([q.supportedModels(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 30_000))])
    const out: Partial<Record<ModelId, ModelDetails>> = {}
    for (const m of list) {
      if (ALIASES.includes(m.value as ModelId)) out[m.value as ModelId] = { displayName: m.displayName, description: m.description, resolvedModel: m.resolvedModel }
    }
    return out
  } finally {
    release()
    abort.abort()
  }
}
