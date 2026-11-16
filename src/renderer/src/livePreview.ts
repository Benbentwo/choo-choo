import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

/**
 * Live Markdown formatting for the message box: what to style and which syntax characters to hide.
 * The text itself never changes, so what's sent is the plain Markdown that was typed.
 *
 * - `mark`: style a range (bold, inline code, a link…) with `cls`.
 * - `hide`: hide syntax characters (backticks, asterisks, a link's URL) while the caret is outside
 *   their span, as Slack and Linear do. With the caret inside, they show again, dimmed, so they can
 *   be edited.
 * - `line`: style a whole line (code block, heading, quote).
 */
export type Span =
  | { kind: 'mark'; from: number; to: number; cls: string; href?: string }
  | { kind: 'hide'; from: number; to: number }
  | { kind: 'line'; at: number; cls: string }

/** Inline spans whose syntax characters hide while the caret is elsewhere. */
const INLINE: Record<string, string> = {
  InlineCode: 'cm-md-code',
  StrongEmphasis: 'cm-md-strong',
  Emphasis: 'cm-md-em',
  Strikethrough: 'cm-md-strike',
  Link: 'cm-md-link'
}
const INLINE_MARKS = new Set(['CodeMark', 'EmphasisMark', 'StrikethroughMark', 'LinkMark', 'URL', 'LinkTitle'])

type Range = { from: number; to: number }

/** The caret (or selection) touches the span, so its syntax stays visible for editing. */
function touches(sel: readonly Range[], from: number, to: number) {
  return sel.some((r) => r.from <= to && r.to >= from)
}

/**
 * Spans for the document. `active` is the selection when the box has focus; pass null when it
 * doesn't, so everything shows formatted.
 */
export function livePreviewSpans(state: EditorState, active: readonly Range[] | null, range?: Range): Span[] {
  const spans: Span[] = []
  const doc = state.doc
  const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state)
  const sel = active ?? []
  const lines = (from: number, to: number, cls: (i: number, n: number) => string) => {
    const first = doc.lineAt(from).number
    const last = doc.lineAt(Math.max(from, to - (to > from && doc.sliceString(to - 1, to) === '\n' ? 1 : 0))).number
    for (let n = first; n <= last; n++) spans.push({ kind: 'line', at: doc.line(n).from, cls: cls(n - first, last - first) })
  }
  tree.iterate({
    from: range?.from ?? 0,
    to: range?.to ?? doc.length,
    enter: (ref) => {
      const name = ref.name
      const node = ref.node
      if (name === 'FencedCode' || name === 'CodeBlock') {
        lines(ref.from, ref.to, (i, n) => `cm-md-codeblock${i === 0 ? ' cm-md-codeblock-first' : ''}${i === n ? ' cm-md-codeblock-last' : ''}`)
        for (const c of children(node)) if (c.name === 'CodeMark' || c.name === 'CodeInfo') spans.push({ kind: 'mark', from: c.from, to: c.to, cls: 'cm-md-syntax' })
        return false
      }
      if (/^(ATX|Setext)Heading\d$/.test(name)) {
        lines(ref.from, ref.to, () => `cm-md-h cm-md-h${name.slice(-1)}`)
        for (const c of children(node)) if (c.name === 'HeaderMark') spans.push({ kind: 'mark', from: c.from, to: c.to, cls: 'cm-md-syntax' })
        return
      }
      if (name === 'Blockquote') {
        lines(ref.from, ref.to, () => 'cm-md-quote')
        return
      }
      if (name === 'QuoteMark') spans.push({ kind: 'mark', from: ref.from, to: ref.to, cls: 'cm-md-syntax' })
      if (name === 'ListMark') spans.push({ kind: 'mark', from: ref.from, to: ref.to, cls: 'cm-md-list' })
      if (name === 'TaskMarker') spans.push({ kind: 'mark', from: ref.from, to: ref.to, cls: 'cm-md-list' })
      if (name === 'HorizontalRule') spans.push({ kind: 'mark', from: ref.from, to: ref.to, cls: 'cm-md-syntax' })
      if (name === 'URL' && node.parent?.name !== 'Link' && node.parent?.name !== 'Image') spans.push({ kind: 'mark', from: ref.from, to: ref.to, cls: 'cm-md-link' })
      if (name === 'Autolink') spans.push({ kind: 'mark', from: ref.from, to: ref.to, cls: 'cm-md-link' })
      const cls = INLINE[name]
      if (!cls) return
      // "[WIP]" on its own is plain text, not a link.
      if (name === 'Link' && !node.getChild('URL')) return
      const url = name === 'Link' ? node.getChild('URL') : null
      spans.push({ kind: 'mark', from: ref.from, to: ref.to, cls, ...(url ? { href: doc.sliceString(url.from, url.to) } : {}) })
      const editing = touches(sel, ref.from, ref.to)
      for (const m of syntaxOf(node, name)) spans.push(editing ? { kind: 'mark', from: m.from, to: m.to, cls: 'cm-md-syntax' } : { kind: 'hide', from: m.from, to: m.to })
    }
  })
  return spans
}

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c)
  return out
}

/** The syntax characters of an inline span: its marks, and for a link everything after the text. */
function syntaxOf(node: SyntaxNode, name: string): Range[] {
  const marks = children(node).filter((c) => INLINE_MARKS.has(c.name))
  if (name !== 'Link') return marks.filter((c) => c.name !== 'URL' && c.name !== 'LinkTitle')
  // [text](url "title"): hide "[" and everything from "]" on. A reference link [text][ref] works the same.
  const close = marks.find((c, i) => i > 0 && c.name === 'LinkMark')
  if (!marks.length || !close) return []
  return [{ from: marks[0].from, to: marks[0].to }, { from: close.from, to: node.to }]
}

export type Segment = { text: string; classes: string[]; href?: string }
export type FormattedLine = { cls: string; parts: Segment[] }

const parser = markdown({ base: markdownLanguage })

/**
 * Text the person sent, formatted the way the message box showed it while they typed: syntax
 * characters hidden, spans styled, one entry per line.
 */
export function formatMessage(text: string): FormattedLine[] {
  const state = EditorState.create({ doc: text, extensions: [parser] })
  const spans = livePreviewSpans(state, null)
  const lineCls = new Map<number, string[]>()
  const cuts = new Set<number>([0, text.length])
  for (const s of spans) {
    if (s.kind === 'line') lineCls.set(s.at, [...(lineCls.get(s.at) ?? []), s.cls])
    else cuts.add(s.from).add(s.to)
  }
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) cuts.add(i).add(i + 1)
  const points = [...cuts].sort((a, b) => a - b)
  const lines: FormattedLine[] = [{ cls: (lineCls.get(0) ?? []).join(' '), parts: [] }]
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    const piece = text.slice(from, to)
    if (piece === '\n') {
      lines.push({ cls: (lineCls.get(to) ?? []).join(' '), parts: [] })
      continue
    }
    const over = spans.filter((s) => s.kind !== 'line' && s.from <= from && s.to >= to)
    if (over.some((s) => s.kind === 'hide')) continue
    const marks = over.filter((s): s is Extract<Span, { kind: 'mark' }> => s.kind === 'mark')
    const href = marks.find((m) => m.href)?.href
    lines[lines.length - 1].parts.push({ text: piece, classes: marks.map((m) => m.cls), ...(href ? { href } : {}) })
  }
  return lines
}
