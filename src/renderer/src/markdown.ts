const ORDERED = /^ {0,3}\d{1,9}[.)]\s/
const BULLET = /^ {0,3}[-*+]\s/
const FENCE = /^ {0,3}(```|~~~)/

/**
 * Markdown fixes before rendering. In CommonMark a numbered list that doesn't start at 1 can't
 * interrupt a paragraph, so Claude's "**Worth fixing**\n4. …" ran into one block. This puts a
 * blank line before such a list, leaving code blocks alone.
 */
export function tidyMarkdown(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let fenced = false
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced
    const prev = out[out.length - 1]
    if (!fenced && ORDERED.test(line) && prev !== undefined && prev.trim() !== '' && !ORDERED.test(prev) && !BULLET.test(prev) && !/^\s/.test(prev)) out.push('')
    out.push(line)
  }
  return out.join('\n')
}
