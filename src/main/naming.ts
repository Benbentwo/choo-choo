import { tmpdir } from 'node:os'
import type { ChatItem } from '@shared/types'
import { redactSecrets } from '@shared/reflect'
import { claudeExecutable } from './claudeBinary'

const STOP = new Set(['the', 'a', 'an', 'to', 'and', 'or', 'of', 'for', 'in', 'on', 'with', 'please', 'can', 'you', 'we', 'i', 'it', 'this', 'that', 'my', 'our', 'be', 'is', 'are', 'make', 'let', "let's"])

/** Kebab-case branch slug from free text. */
export function slugify(text: string, maxWords = 5): string {
  const words = text
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
  return words.slice(0, maxWords).join('-').slice(0, 48).replace(/-+$/, '')
}

export function fallbackTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 40 ? `${t.slice(0, 40).trim()}…` : t
}

/**
 * Sends one prompt to Haiku with no tools and returns the JSON object in its reply, or null when the
 * reply has none. Failures to run at all (no Claude binary, signed out, network) throw.
 */
async function askHaiku(prompt: string): Promise<Record<string, unknown> | null> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const q = query({
    prompt,
    options: { pathToClaudeCodeExecutable: claudeExecutable(), model: 'haiku', maxTurns: 1, tools: [], cwd: tmpdir(), persistSession: false, settingSources: [] } as never
  })
  let text = ''
  for await (const m of q as AsyncIterable<any>) {
    if (m.type === 'assistant') for (const b of m.message?.content ?? []) if (b.type === 'text') text += b.text
  }
  try {
    const json: unknown = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Asks a small model for a short title and branch slug, like Conductor does. Falls back to heuristics. */
export async function suggestName(prompt: string): Promise<{ title: string; slug: string }> {
  const fallback = { title: fallbackTitle(prompt), slug: slugify(prompt) }
  try {
    const json = ((await askHaiku(
      'Name this coding task. Reply with only JSON like {"title":"Automate photo upload","branch":"automate-photo-upload"}. ' +
        'Title: 2-5 words, sentence case. Branch: 2-5 lowercase words, kebab-case.\n\nTask:\n' +
        prompt.slice(0, 2000)
    )) ?? {}) as { title?: string; branch?: string }
    return {
      title: json.title?.trim() || fallback.title,
      slug: slugify(json.branch ?? '', 6) || fallback.slug
    }
  } catch {
    return fallback
  }
}

/**
 * What a workspace's chats are about, for renaming it: the person's messages and the agent's replies,
 * oldest first, keeping the most recent part when it's long. Tool calls are left out.
 */
export function namingContext(chats: ChatItem[][], maxChars = 6000): string {
  const lines: string[] = []
  for (const items of chats) {
    for (const it of items) {
      if (it.kind === 'user' && !it.fromAdvisor) lines.push(`USER: ${it.text.slice(0, 1500)}`)
      else if (it.kind === 'assistant' && !it.streaming) lines.push(`ASSISTANT: ${it.text.slice(0, 600)}`)
    }
  }
  const text = redactSecrets(lines.join('\n'))
  return text.length > maxChars ? text.slice(text.length - maxChars) : text
}

/** A fresh title for a workspace from what its chats are about now. Null when there's nothing to go on; throws when the model can't answer. */
export async function suggestTitleFromChats(chats: ChatItem[][]): Promise<string | null> {
  const context = namingContext(chats)
  if (!context.trim()) return null
  let json: Record<string, unknown> | null
  try {
    json = await askHaiku(
      'Below is a coding session. Give it a short title that says what the work is about now; if the focus moved, name where it ended up. ' +
        'Reply with only JSON like {"title":"Automate photo upload"}. Title: 2-5 words, sentence case.\n\n<session>\n' +
        context +
        '\n</session>'
    )
  } catch (e) {
    // Running the model failed (no binary, signed out, network): keep the real cause, in the log and the message.
    console.error('[naming] regenerate name failed:', e)
    throw new Error(`Couldn't reach Claude to name this workspace: ${e instanceof Error ? e.message : String(e)}`)
  }
  const title = typeof json?.title === 'string' ? json.title.trim().slice(0, 80) : ''
  if (!title) throw new Error("Couldn't come up with a name. Try again, or rename it yourself.")
  return title
}
