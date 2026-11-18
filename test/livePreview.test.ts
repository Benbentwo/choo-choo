import { describe, expect, test } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { formatMessage, livePreviewSpans, type Span } from '../src/renderer/src/livePreview'

const state = (doc: string) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
const text = (doc: string, spans: Span[], kind: 'mark' | 'hide', cls?: string) =>
  spans.filter((s) => s.kind === kind && (!cls || (s.kind === 'mark' && s.cls === cls))).map((s) => (s.kind === 'line' ? '' : doc.slice(s.from, s.to)))

describe('live Markdown in the message box', () => {
  test('inline code formats only once the closing backtick is typed', () => {
    expect(text('run `npm test', livePreviewSpans(state('run `npm test'), null), 'mark', 'cm-md-code')).toEqual([])
    const doc = 'run `npm test` now'
    const spans = livePreviewSpans(state(doc), null)
    expect(text(doc, spans, 'mark', 'cm-md-code')).toEqual(['`npm test`'])
    expect(text(doc, spans, 'hide')).toEqual(['`', '`'])
  })

  test('syntax shows again, dimmed, while the caret is inside the span', () => {
    const doc = 'run `npm test` now'
    const spans = livePreviewSpans(state(doc), [{ from: 14, to: 14 }])
    expect(text(doc, spans, 'hide')).toEqual([])
    expect(text(doc, spans, 'mark', 'cm-md-syntax')).toEqual(['`', '`'])
    // Elsewhere in the text, it hides.
    expect(text(doc, livePreviewSpans(state(doc), [{ from: 18, to: 18 }]), 'hide')).toEqual(['`', '`'])
  })

  test('bold, italic, strikethrough and links', () => {
    const doc = '**bold** *it* ~~old~~ [docs](https://example.com) [WIP] https://example.org'
    const spans = livePreviewSpans(state(doc), null)
    expect(text(doc, spans, 'mark', 'cm-md-strong')).toEqual(['**bold**'])
    expect(text(doc, spans, 'mark', 'cm-md-em')).toEqual(['*it*'])
    expect(text(doc, spans, 'mark', 'cm-md-strike')).toEqual(['~~old~~'])
    // "[WIP]" alone is not a link; a bare URL is.
    expect(text(doc, spans, 'mark', 'cm-md-link')).toEqual(['[docs](https://example.com)', 'https://example.org'])
    expect(text(doc, spans, 'hide')).toEqual(['**', '**', '*', '*', '~~', '~~', '[', '](https://example.com)'])
  })

  test('code blocks, lists, quotes and headings style whole lines', () => {
    const doc = '# Plan\n- one\n1. two\n> note\n```ts\nconst a = 1\n```\nend'
    const spans = livePreviewSpans(state(doc), null)
    const lines = spans.filter((s) => s.kind === 'line').map((s) => s.kind === 'line' && `${doc.slice(s.at, doc.indexOf('\n', s.at) < 0 ? undefined : doc.indexOf('\n', s.at))}=${s.cls}`)
    expect(lines).toEqual([
      '# Plan=cm-md-h cm-md-h1',
      '> note=cm-md-quote',
      '```ts=cm-md-codeblock cm-md-codeblock-first',
      'const a = 1=cm-md-codeblock',
      '```=cm-md-codeblock cm-md-codeblock-last'
    ])
    expect(text(doc, spans, 'mark', 'cm-md-list')).toEqual(['-', '1.'])
    // Nothing in a code block is hidden or formatted as Markdown.
    expect(text(doc, spans, 'hide')).toEqual([])
  })

  test('an unclosed code block runs to the end of the text', () => {
    const doc = 'see\n```\nnpm test **not bold**'
    const spans = livePreviewSpans(state(doc), null)
    expect(spans.filter((s) => s.kind === 'line').length).toBe(2)
    expect(text(doc, spans, 'mark', 'cm-md-strong')).toEqual([])
  })
})

describe('sent messages look like the message box did', () => {
  test('syntax characters are hidden and spans styled', () => {
    const lines = formatMessage('Run `npm test` and see [docs](https://example.com)\n- **one**')
    expect(lines.map((l) => l.parts.map((p) => p.text).join(''))).toEqual(['Run npm test and see docs', '- one'])
    expect(lines[0].parts.find((p) => p.text === 'npm test')?.classes).toEqual(['cm-md-code'])
    expect(lines[0].parts.find((p) => p.text === 'docs')).toMatchObject({ href: 'https://example.com' })
    expect(lines[1].parts.find((p) => p.text === 'one')?.classes).toEqual(['cm-md-strong'])
  })

  test('blank lines and plain text survive', () => {
    expect(formatMessage('a\n\nb').map((l) => l.parts.map((p) => p.text).join(''))).toEqual(['a', '', 'b'])
    expect(formatMessage('3 * 4 = 12, see [WIP]')[0].parts.map((p) => p.text).join('')).toBe('3 * 4 = 12, see [WIP]')
  })
})
