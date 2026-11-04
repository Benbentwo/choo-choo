import { tmpdir } from 'node:os'

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

/** Asks a small model for a short title and branch slug, like Conductor does. Falls back to heuristics. */
export async function suggestName(prompt: string): Promise<{ title: string; slug: string }> {
  const fallback = { title: fallbackTitle(prompt), slug: slugify(prompt) }
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const q = query({
      prompt:
        'Name this coding task. Reply with only JSON like {"title":"Automate photo upload","branch":"automate-photo-upload"}. ' +
        'Title: 2-5 words, sentence case. Branch: 2-5 lowercase words, kebab-case.\n\nTask:\n' +
        prompt.slice(0, 2000),
      options: { model: 'haiku', maxTurns: 1, tools: [], cwd: tmpdir(), persistSession: false, settingSources: [] } as never
    })
    let text = ''
    for await (const m of q as AsyncIterable<any>) {
      if (m.type === 'assistant') for (const b of m.message?.content ?? []) if (b.type === 'text') text += b.text
    }
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { title?: string; branch?: string }
    return {
      title: json.title?.trim() || fallback.title,
      slug: slugify(json.branch ?? '', 6) || fallback.slug
    }
  } catch {
    return fallback
  }
}
