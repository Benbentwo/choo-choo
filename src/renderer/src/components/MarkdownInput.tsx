import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, placeholder as placeholderExt, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { deleteMarkupBackward, insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { livePreviewSpans } from '../livePreview'

/**
 * The message box: plain Markdown text, formatted live as it's typed (inline code once the closing
 * backtick is in, bold, italic, strikethrough, links, code blocks, lists, quotes, headings). The
 * value is always the exact text typed; formatting is only how it looks.
 */
export interface MarkdownInputHandle {
  focus(): void
  /** Caret offset in the text. */
  caret(): number
  setCaret(pos: number): void
}

export interface MarkdownInputProps {
  value: string
  placeholder: string
  /** The text changed (typing, paste, undo…). */
  onChange(text: string, caret: number): void
  /** The caret moved without the text changing. `pointer` is true for a click. */
  onCaret?(text: string, caret: number, pointer: boolean): void
  /** Runs before the editor's own keys. Return true when handled; call preventDefault yourself. */
  onKeyDown?(e: KeyboardEvent): boolean | void
  /** Return true when handled (such as a pasted image). */
  onPaste?(e: ClipboardEvent): boolean | void
  onBlur?(): void
  autoFocus?: boolean
  className?: string
  /** Lines of space before any text is typed. */
  minLines?: number
  testId?: string
}

const hidden = Decoration.replace({})
const markCache = new Map<string, Decoration>()
const lineCache = new Map<string, Decoration>()
const markOf = (cls: string) => markCache.get(cls) ?? markCache.set(cls, Decoration.mark({ class: cls })).get(cls)!
const lineOf = (cls: string) => lineCache.get(cls) ?? lineCache.set(cls, Decoration.line({ class: cls })).get(cls)!

function build(view: EditorView): { all: DecorationSet; hidden: DecorationSet } {
  const active = view.hasFocus ? view.state.selection.ranges : null
  const spans = livePreviewSpans(view.state, active)
  const ranges = spans.map((s) => (s.kind === 'line' ? lineOf(s.cls).range(s.at) : (s.kind === 'hide' ? hidden : markOf(s.cls)).range(s.from, s.to)))
  return { all: Decoration.set(ranges, true), hidden: Decoration.set(ranges.filter((r) => r.value === hidden), true) }
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    hidden: DecorationSet
    constructor(view: EditorView) {
      ;({ all: this.decorations, hidden: this.hidden } = build(view))
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.focusChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState))
        ({ all: this.decorations, hidden: this.hidden } = build(u.view))
    }
  },
  { decorations: (v) => v.decorations }
)

/** Ranges hidden by live formatting are skipped as one step by the arrow keys. */
const atomic = EditorView.atomicRanges.of((view) => view.plugin(livePreview)?.hidden ?? Decoration.none)

/** ⌘B / ⌘I / ⌘E wrap the selection (or the caret) in **, * or `. */
function wrap(mark: string) {
  return (view: EditorView) => {
    view.dispatch(
      view.state.changeByRange((r) => {
        const text = view.state.sliceDoc(r.from, r.to)
        const before = view.state.sliceDoc(r.from - mark.length, r.from)
        const after = view.state.sliceDoc(r.to, r.to + mark.length)
        // Already wrapped: unwrap.
        if (before === mark && after === mark)
          return { changes: [{ from: r.from - mark.length, to: r.from }, { from: r.to, to: r.to + mark.length }], range: EditorSelection.range(r.from - mark.length, r.to - mark.length) }
        return { changes: { from: r.from, to: r.to, insert: mark + text + mark }, range: EditorSelection.range(r.from + mark.length, r.to + mark.length) }
      }),
      { userEvent: 'input.format' }
    )
    return true
  }
}

const theme = EditorView.theme({
  '&': { fontSize: 'inherit', color: 'var(--color-fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.55', maxHeight: '18rem', overflow: 'auto' },
  '.cm-content': { padding: '12px 16px 6px', caretColor: 'var(--color-fg)', minHeight: 'var(--md-min)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--color-fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { background: 'color-mix(in srgb, var(--color-accent) 30%, transparent)' },
  '.cm-placeholder': { color: 'var(--color-faint)' },
  '.cm-md-syntax': { color: 'var(--color-faint)' },
  '.cm-md-code': {
    fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    fontSize: '0.92em',
    background: 'var(--color-raised)',
    border: '1px solid var(--color-line)',
    borderRadius: '4px',
    padding: '0 3px'
  },
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through', color: 'var(--color-muted)' },
  '.cm-md-link': { color: 'var(--color-accent)', textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.cm-md-list': { color: 'var(--color-accent)' },
  '.cm-md-quote': { borderLeft: '3px solid var(--color-line)', paddingLeft: '10px !important', color: 'var(--color-muted)' },
  '.cm-md-h': { fontWeight: '700' },
  '.cm-md-h1': { fontSize: '1.3em' },
  '.cm-md-h2': { fontSize: '1.15em' },
  '.cm-md-codeblock': {
    fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    fontSize: '0.92em',
    background: 'var(--color-code)',
    padding: '0 10px !important'
  },
  '.cm-md-codeblock-first': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px', paddingTop: '4px !important' },
  '.cm-md-codeblock-last': { borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', paddingBottom: '4px !important' }
})

export const MarkdownInput = forwardRef<MarkdownInputHandle, MarkdownInputProps>(function MarkdownInput(props, ref) {
  const box = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(props)
  latest.current = props
  const ph = useRef(new Compartment())

  useEffect(() => {
    const handlers: Extension = Prec.highest(
      EditorView.domEventHandlers({
        keydown: (e) => !!latest.current.onKeyDown?.(e),
        paste: (e) => !!latest.current.onPaste?.(e),
        // Dropped files are attachments for the message, handled by the box around the editor. Without
        // this the editor would paste their bytes in as text.
        drop: (e) => !!e.dataTransfer?.files.length,
        blur: () => {
          latest.current.onBlur?.()
          return false
        }
      })
    )
    const v = new EditorView({
      parent: box.current!,
      state: EditorState.create({
        doc: props.value,
        selection: EditorSelection.cursor(props.value.length),
        extensions: [
          handlers,
          history(),
          keymap.of([
            { key: 'Enter', run: insertNewlineContinueMarkup },
            { key: 'Shift-Enter', run: insertNewlineContinueMarkup },
            { key: 'Backspace', run: deleteMarkupBackward },
            { key: 'Mod-b', run: wrap('**') },
            { key: 'Mod-i', run: wrap('*') },
            { key: 'Mod-e', run: wrap('`') },
            ...historyKeymap,
            ...defaultKeymap
          ]),
          markdown({ base: markdownLanguage, addKeymap: false }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': 'Message', 'data-testid': props.testId ?? 'composer-input' }),
          ph.current.of(placeholderExt(props.placeholder)),
          livePreview,
          atomic,
          theme,
          EditorView.updateListener.of((u) => {
            const caret = u.state.selection.main.head
            if (u.docChanged) latest.current.onChange(u.state.doc.toString(), caret)
            else if (u.selectionSet) latest.current.onCaret?.(u.state.doc.toString(), caret, u.transactions.some((t) => t.isUserEvent('select.pointer')))
          })
        ]
      })
    })
    view.current = v
    if (props.autoFocus) v.focus()
    return () => {
      v.destroy()
      view.current = null
    }
  }, [])

  // Text set from outside (a draft put back, a completion, the box cleared after sending).
  useEffect(() => {
    const v = view.current
    if (!v) return
    const cur = v.state.doc.toString()
    if (cur === props.value) return
    v.dispatch({ changes: { from: 0, to: cur.length, insert: props.value }, selection: EditorSelection.cursor(props.value.length) })
  }, [props.value])

  useEffect(() => {
    view.current?.dispatch({ effects: ph.current.reconfigure(placeholderExt(props.placeholder)) })
  }, [props.placeholder])

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    caret: () => view.current?.state.selection.main.head ?? 0,
    setCaret: (pos: number) => {
      const v = view.current
      if (!v) return
      v.dispatch({ selection: EditorSelection.cursor(Math.min(pos, v.state.doc.length)), scrollIntoView: true })
    }
  }))

  // .cm-content's padding (12px + 6px) plus the lines; the line height is 1.55em.
  const min = `calc(${(props.minLines ?? 3) * 1.55}em + 18px)`
  return <div ref={box} className={`selectable ${props.className ?? ''}`} style={{ ['--md-min' as string]: min }} />
})
