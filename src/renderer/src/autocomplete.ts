export interface Trigger {
  kind: '@' | '/'
  query: string
  /** Index in the text where the trigger character sits. */
  start: number
}

/** Finds an @mention or /command being typed at the caret. Commands only count at the start of the message. */
export function findTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret)
  const m = before.match(/(^|\s)([@/])([^\s@]*)$/)
  if (!m) return null
  const start = before.length - m[3].length - 1
  if (m[2] === '/' && before.slice(0, start).trim() !== '') return null
  return { kind: m[2] as '@' | '/', query: m[3], start }
}

/** Ranks candidates: exact basename prefix, then path prefix, then substring, then subsequence. */
export function rank(items: string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase()
  if (!q) return items.slice(0, limit)
  const scored: [number, string][] = []
  for (const it of items) {
    const l = it.toLowerCase()
    const base = l.slice(l.lastIndexOf('/') + 1)
    let score = -1
    if (base.startsWith(q)) score = 0
    else if (l.startsWith(q)) score = 1
    else if (base.includes(q)) score = 2
    else if (l.includes(q)) score = 3
    else if (isSubsequence(q, l)) score = 4
    if (score >= 0) scored.push([score * 10000 + it.length, it])
  }
  return scored
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map((x) => x[1])
}

function isSubsequence(q: string, s: string) {
  let i = 0
  for (const c of s) if (c === q[i]) i++
  return i === q.length
}

export function applyCompletion(text: string, caret: number, t: Trigger, value: string): { text: string; caret: number } {
  const insert = `${t.kind}${value} `
  const next = text.slice(0, t.start) + insert + text.slice(caret)
  return { text: next, caret: t.start + insert.length }
}
