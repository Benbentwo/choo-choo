/** A run of a line's text, marked when it differs from the line it is paired with. */
export type Seg = { text: string; changed: boolean }

/** Words, runs of spaces, and single punctuation marks: the units GitHub highlights within a changed line. */
const tokens = (s: string): string[] => s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []

/** Past this many token pairs the table is too large to build per line; only the shared ends are matched. */
const MAX_CELLS = 400_000
/** Lines with less than this share of text in common are rewrites: highlighting pieces of them is noise. */
const MIN_SHARED = 0.3

function segs(toks: string[], keep: boolean[]): Seg[] {
  const out: Seg[] = []
  toks.forEach((t, i) => {
    const changed = !keep[i]
    const last = out[out.length - 1]
    if (last && last.changed === changed) last.text += t
    else out.push({ text: t, changed })
  })
  return out
}

/**
 * The parts of an old and a new line that differ, word by word. Returns null when the lines are the
 * same or share too little to be the same line edited.
 */
export function wordDiff(a: string, b: string): { old: Seg[]; new: Seg[] } | null {
  if (a === b) return null
  const x = tokens(a)
  const y = tokens(b)
  const keepX = new Array<boolean>(x.length).fill(false)
  const keepY = new Array<boolean>(y.length).fill(false)
  let pre = 0
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++
  let suf = 0
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++
  for (let i = 0; i < pre; i++) keepX[i] = keepY[i] = true
  for (let i = 0; i < suf; i++) keepX[x.length - 1 - i] = keepY[y.length - 1 - i] = true
  const n = x.length - pre - suf
  const m = y.length - pre - suf
  if (n > 0 && m > 0 && n * m <= MAX_CELLS) {
    // Longest common subsequence of the middles.
    const w = m + 1
    const t = new Uint16Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) t[i * w + j] = x[pre + i] === y[pre + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1])
    for (let i = 0, j = 0; i < n && j < m; ) {
      if (x[pre + i] === y[pre + j]) {
        keepX[pre + i] = keepY[pre + j] = true
        i++
        j++
      } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++
      else j++
    }
  }
  // Whitespace kept between two changed runs would chop one edit into many small boxes.
  const bridge = (toks: string[], keep: boolean[]) => {
    for (let i = 1; i < toks.length - 1; i++) if (keep[i] && !keep[i - 1] && !keep[i + 1] && /^\s+$/.test(toks[i])) keep[i] = false
  }
  bridge(x, keepX)
  bridge(y, keepY)
  const shared = (toks: string[], keep: boolean[]) => toks.reduce((s, tok, i) => s + (keep[i] && tok.trim() ? tok.length : 0), 0)
  const longest = Math.max(a.trim().length, b.trim().length)
  if (!longest || shared(x, keepX) / longest < MIN_SHARED) return null
  return { old: segs(x, keepX), new: segs(y, keepY) }
}

/**
 * Pairs removed lines with the added lines that replace them (the nth removed with the nth added in
 * each block, as GitHub does) and returns the word-level parts for each paired line, by line index.
 */
export function pairedSegs(lines: { kind: string; text: string }[]): Map<number, Seg[]> {
  const out = new Map<number, Seg[]>()
  for (let i = 0; i < lines.length; ) {
    if (lines[i].kind !== 'del') {
      i++
      continue
    }
    let d = i
    while (d < lines.length && lines[d].kind === 'del') d++
    let a = d
    while (a < lines.length && lines[a].kind === 'add') a++
    for (let k = 0; k < Math.min(d - i, a - d); k++) {
      const w = wordDiff(lines[i + k].text, lines[d + k].text)
      if (!w) continue
      out.set(i + k, w.old)
      out.set(d + k, w.new)
    }
    i = a
  }
  return out
}
