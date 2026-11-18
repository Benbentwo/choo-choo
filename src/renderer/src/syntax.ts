import { useEffect, useState } from 'react'
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight'
import type { Parser } from '@lezer/common'
import type { Seg } from './wordDiff'

/**
 * Syntax colors for diffs. Lezer (the parser behind CodeMirror) tokenizes each side of a hunk, and
 * the tokens are drawn as `syn-*` classes whose colors come from `--syn-*` variables set per theme
 * (SYNTAX_DARK / SYNTAX_LIGHT in @shared/themes), so they read on the green and red diff rows.
 */
const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], class: 'syn-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape, t.character], class: 'syn-string' },
  { tag: [t.number, t.bool, t.null, t.atom, t.literal, t.unit], class: 'syn-number' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'syn-comment' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], class: 'syn-type' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: 'syn-function' },
  { tag: [t.propertyName, t.attributeName, t.labelName], class: 'syn-property' },
  { tag: [t.tagName, t.heading], class: 'syn-tag' },
  { tag: [t.meta, t.processingInstruction, t.annotation, t.documentMeta], class: 'syn-meta' },
  { tag: [t.link, t.url], class: 'syn-link' },
  { tag: t.strong, class: 'syn-strong' },
  { tag: t.emphasis, class: 'syn-em' },
  { tag: t.inserted, class: 'syn-inserted' },
  { tag: t.deleted, class: 'syn-deleted' },
  { tag: t.invalid, class: 'syn-invalid' }
])

/** A colored run within one line: character offsets and the class to draw it with. */
export type Tok = { from: number; to: number; cls: string }

/** Past this many characters on one side of a hunk, the diff is drawn without colors. */
const MAX_CHARS = 400_000

/** Tokens for each line of `text`, by tokenizing it as a whole so strings and comments that span lines stay colored. */
export function highlightLines(text: string, parser: Parser): Tok[][] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  const out: Tok[][] = starts.map(() => [])
  if (!text || text.length > MAX_CHARS) return out
  const tree = parser.parse(text)
  let line = 0
  highlightTree(tree, highlighter, (from, to, cls) => {
    while (from < to) {
      while (line + 1 < starts.length && starts[line + 1] <= from) line++
      const end = line + 1 < starts.length ? Math.min(to, starts[line + 1] - 1) : to
      if (end > from) out[line].push({ from: from - starts[line], to: end - starts[line], cls })
      from = Math.max(end, line + 1 < starts.length ? starts[line + 1] : to)
    }
  })
  return out
}

/** A piece of a diff line: its text, syntax class, and whether word diff marks it changed. */
export type Run = { text: string; cls?: string; changed?: boolean }

/** Cuts a line at every syntax token and word-diff boundary so both can be drawn together. */
export function mergeRuns(text: string, toks: Tok[] | undefined, words: Seg[] | undefined): Run[] {
  const cuts = new Set<number>([0, text.length])
  for (const k of toks ?? []) cuts.add(k.from).add(k.to)
  const changed: [number, number][] = []
  let at = 0
  for (const w of words ?? []) {
    if (w.changed) changed.push([at, at + w.text.length])
    cuts.add(at)
    at += w.text.length
  }
  const points = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b)
  const out: Run[] = []
  let ti = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (a === b) continue
    while (toks && ti < toks.length && toks[ti].to <= a) ti++
    const tok = toks && ti < toks.length && toks[ti].from <= a ? toks[ti] : undefined
    const run: Run = { text: text.slice(a, b) }
    if (tok) run.cls = tok.cls
    if (changed.some(([x, y]) => a >= x && b <= y)) run.changed = true
    const last = out[out.length - 1]
    if (last && last.cls === run.cls && !!last.changed === !!run.changed) last.text += run.text
    else out.push(run)
  }
  return out
}

/** The diff rows the colors are for: what parseDiff in DiffView returns. */
export interface DiffRow {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
  text: string
}

/**
 * Syntax tokens for every row of a parsed diff, by row index. Each hunk is tokenized twice: the new
 * side (context and added lines) and the old side (context and removed lines), so a line is colored
 * in the code around it rather than on its own.
 */
export function highlightDiff(rows: DiffRow[], parser: Parser): Map<number, Tok[]> {
  const out = new Map<number, Tok[]>()
  const flush = (idx: number[]) => {
    if (!idx.length) return
    const toks = highlightLines(idx.map((i) => rows[i].text).join('\n'), parser)
    idx.forEach((i, k) => {
      if (toks[k].length && !out.has(i)) out.set(i, toks[k])
    })
  }
  let side: { new: number[]; old: number[] } = { new: [], old: [] }
  rows.forEach((r, i) => {
    if (r.kind === 'hunk') {
      flush(side.new)
      flush(side.old)
      side = { new: [], old: [] }
    } else if (r.kind === 'add') side.new.push(i)
    else if (r.kind === 'del') side.old.push(i)
    else if (r.kind === 'ctx') {
      side.new.push(i)
      side.old.push(i)
    }
  })
  flush(side.new)
  flush(side.old)
  return out
}

const cache = new Map<string, Promise<Parser | null>>()

/** The Lezer parser for a file name, loaded on first use (each language is its own chunk). Null when none fits. */
export function parserFor(file: string): Promise<Parser | null> {
  const name = file.split('/').pop() ?? file
  const key = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : name
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      const { languages } = await import('@codemirror/language-data')
      const { LanguageDescription } = await import('@codemirror/language')
      const desc = LanguageDescription.matchFilename(languages, name)
      return desc ? (await desc.load()).language.parser : null
    })().catch(() => null)
    cache.set(key, p)
  }
  return p
}

/** Syntax tokens for a parsed diff, filled in once the file's language has loaded. */
export function useDiffHighlight(file: string, rows: DiffRow[]): Map<number, Tok[]> | null {
  const [state, setState] = useState<{ rows: DiffRow[]; toks: Map<number, Tok[]> } | null>(null)
  useEffect(() => {
    let live = true
    void parserFor(file).then((parser) => {
      if (!live) return
      setState(parser ? { rows, toks: highlightDiff(rows, parser) } : null)
    })
    return () => {
      live = false
    }
  }, [file, rows])
  return state && state.rows === rows ? state.toks : null
}

const langCache = new Map<string, Promise<Parser | null>>()

/** The parser for a fenced code block's language (```ts, ```python…), or null. */
export function parserForLang(lang: string): Promise<Parser | null> {
  const key = lang.toLowerCase()
  let p = langCache.get(key)
  if (!p) {
    p = (async () => {
      const { languages } = await import('@codemirror/language-data')
      const { LanguageDescription } = await import('@codemirror/language')
      const desc = LanguageDescription.matchLanguageName(languages, key, true) ?? LanguageDescription.matchFilename(languages, `x.${key}`)
      return desc ? (await desc.load()).language.parser : null
    })().catch(() => null)
    langCache.set(key, p)
  }
  return p
}
