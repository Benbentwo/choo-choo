import { parser as mdParser, GFM } from '@lezer/markdown'

/**
 * The rendered Markdown diff: both versions of a file split into Markdown blocks (paragraphs,
 * headings, list items, tables, code blocks…), each marked by how the diff touched it. Built from
 * a diff with the whole file as context, so every line of both versions is in it.
 */

/** A diff row, as DiffView's parseDiff returns them. */
export interface PreviewRow {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
  text: string
  oldNo?: number
  newNo?: number
}

export type BlockStatus = 'same' | 'add' | 'del' | 'changed'

export interface PreviewBlock {
  /** Which version of the file the block is from: removed and old versions of changed blocks are 'old'. */
  side: 'new' | 'old'
  status: BlockStatus
  /** First and last line of the block in that version of the file. */
  start: number
  end: number
  /** The block's Markdown source. */
  source: string
  /** The diff rows the block covers, in order. */
  rows: number[]
}

const md = mdParser.configure(GFM)

/** Lines (0-based, inclusive) of each Markdown block in `text`. List items are blocks of their own. */
export function markdownBlocks(text: string): { from: number; to: number }[] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  const lineOf = (pos: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const out: { from: number; to: number }[] = []
  const add = (from: number, to: number) => {
    // A node's end can sit just past its last newline; the block ends on the line before.
    const a = lineOf(from)
    let b = lineOf(Math.max(from, to - 1))
    while (b > a && !text.slice(starts[b], b + 1 < starts.length ? starts[b + 1] - 1 : text.length).trim()) b--
    if (out.length && a <= out[out.length - 1].to) return
    out.push({ from: a, to: b })
  }
  const top = md.parse(text).topNode
  for (let c = top.firstChild; c; c = c.nextSibling) {
    if (c.name === 'BulletList' || c.name === 'OrderedList') {
      for (let item = c.firstChild; item; item = item.nextSibling) if (item.name === 'ListItem') add(item.from, item.to)
    } else add(c.from, c.to)
  }
  return out
}

/** The blocks to draw, in reading order: every block of the new version plus removed and replaced blocks of the old one. */
export function previewBlocks(rows: PreviewRow[]): PreviewBlock[] {
  const sideRows = (side: 'new' | 'old') => rows.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === 'ctx' || r.kind === (side === 'new' ? 'add' : 'del'))
  const out: { b: PreviewBlock; at: number }[] = []
  for (const side of ['new', 'old'] as const) {
    const own = sideRows(side)
    const text = own.map(({ r }) => r.text).join('\n')
    for (const { from, to } of markdownBlocks(text)) {
      const picked = own.slice(from, to + 1)
      if (!picked.length) continue
      const idx = picked.map((p) => p.i)
      const first = idx[0]
      const last = idx[idx.length - 1]
      // Rows of the other side inside the block's span mean it was edited even if its own lines are context.
      const touched = rows.slice(first, last + 1).some((r) => r.kind === (side === 'new' ? 'del' : 'add'))
      const mine = picked.map((p) => p.r.kind)
      const status: BlockStatus = mine.every((k) => k === 'ctx') && !touched ? 'same' : mine.every((k) => k !== 'ctx') ? (side === 'new' ? 'add' : 'del') : 'changed'
      // An unchanged block is the same text in both versions: draw it once, from the new side.
      if (side === 'old' && status === 'same') continue
      const no = (p: { r: PreviewRow }) => (side === 'new' ? p.r.newNo : p.r.oldNo) ?? 0
      out.push({
        b: { side, status, start: no(picked[0]), end: no(picked[picked.length - 1]), source: picked.map((p) => p.r.text).join('\n'), rows: idx },
        // The old version of a changed block reads before its new version.
        at: first * 2 + (side === 'old' ? 0 : 1)
      })
    }
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.b)
}

/** Narrows a block's lines to the ones GitHub can take a comment on (those in the PR's diff), when there are any. */
export function clampToDiff(start: number, end: number, allowed: number[] | undefined): { start: number; end: number } {
  const inside = (allowed ?? []).filter((n) => n >= start && n <= end)
  if (!inside.length) return { start, end }
  return { start: Math.min(...inside), end: Math.max(...inside) }
}

export const isMarkdownFile = (file: string) => /\.(md|markdown|mdx|mdown|mkd)$/i.test(file)

export type MdView = 'preview' | 'code'
const MD_VIEW_KEY = 'choo.markdownDiffView'
/** Markdown files (diffs and plain file tabs) open rendered unless the person last picked Code. */
export const getMdView = (): MdView => (typeof localStorage !== 'undefined' && localStorage.getItem(MD_VIEW_KEY) === 'code' ? 'code' : 'preview')
export const saveMdView = (v: MdView) => localStorage.setItem(MD_VIEW_KEY, v)
