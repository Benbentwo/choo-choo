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

export type TextPart = { code: boolean; text: string; lang?: string }

/**
 * Splits text a person typed into plain runs and fenced code blocks, so their messages can show
 * code in a block without the rest being read as Markdown. A fence left open runs to the end.
 */
export function splitFences(text: string): TextPart[] {
  const parts: TextPart[] = []
  let plain: string[] = []
  let code: string[] | null = null
  let fence = ''
  let lang = ''
  const flush = () => {
    const t = plain.join('\n')
    // The line breaks next to a block belong to the block's own spacing.
    if (t.trim()) parts.push({ code: false, text: t.replace(/^\n+|\n+$/g, '') })
    plain = []
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/)
    if (code === null) {
      if (m) {
        flush()
        code = []
        fence = m[1]
        lang = m[2]
      } else plain.push(line)
    } else if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(line.indexOf(m[1]) + m[1].length).trim()) {
      parts.push({ code: true, text: code.join('\n'), ...(lang ? { lang } : {}) })
      code = null
    } else code.push(line)
  }
  if (code !== null) parts.push({ code: true, text: code.join('\n'), ...(lang ? { lang } : {}) })
  else flush()
  return parts
}

/** Whether text ends inside a code fence that hasn't been closed: pass the text up to the cursor. */
export function inOpenFence(text: string): boolean {
  let open = ''
  for (const line of text.split('\n')) {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (!m) continue
    if (!open) open = m[1]
    else if (m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()) open = ''
  }
  return !!open
}
