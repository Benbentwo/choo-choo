import { describe, expect, it } from 'vitest'
import { clampToDiff, markdownBlocks, previewBlocks, type PreviewRow } from '../src/renderer/src/mdPreview'
import { highlightDiff, highlightLines, mergeRuns } from '../src/renderer/src/syntax'
import { parser as jsParser } from '@lezer/javascript'

/** Rows for a full-context diff, written as lines starting with ' ', '+' or '-'. */
function rows(lines: string[]): PreviewRow[] {
  let o = 1
  let n = 1
  return lines.map((l) => {
    const text = l.slice(1)
    if (l[0] === '+') return { kind: 'add', text, newNo: n++ }
    if (l[0] === '-') return { kind: 'del', text, oldNo: o++ }
    return { kind: 'ctx', text, oldNo: o++, newNo: n++ }
  })
}

describe('markdownBlocks', () => {
  it('splits headings, paragraphs, code and list items', () => {
    const text = ['# Title', '', 'One line', 'two lines', '', '- a', '- b', '', '```js', 'x()', '```'].join('\n')
    expect(markdownBlocks(text)).toEqual([
      { from: 0, to: 0 },
      { from: 2, to: 3 },
      { from: 5, to: 5 },
      { from: 6, to: 6 },
      { from: 8, to: 10 }
    ])
  })
})

describe('previewBlocks', () => {
  it('marks added, removed and changed blocks in reading order', () => {
    const r = rows([' # Title', ' ', '-Old para', '+New para', ' ', ' Kept', '-', '-Gone', '+', '+Added'])
    const b = previewBlocks(r).map((x) => [x.side, x.status, x.start, x.end, x.source])
    expect(b).toEqual([
      ['new', 'same', 1, 1, '# Title'],
      ['old', 'del', 3, 3, 'Old para'],
      ['new', 'add', 3, 3, 'New para'],
      ['new', 'same', 5, 5, 'Kept'],
      ['old', 'del', 7, 7, 'Gone'],
      ['new', 'add', 7, 7, 'Added']
    ])
  })

  it('shows the old version of an edited paragraph before the new one', () => {
    const r = rows([' First line', '-second', '+second, edited', ' third'])
    const b = previewBlocks(r)
    expect(b.map((x) => [x.side, x.status, x.start, x.end])).toEqual([
      ['old', 'changed', 1, 3],
      ['new', 'changed', 1, 3]
    ])
  })

  it('counts a removed line inside a block as a change to it', () => {
    const r = rows([' a', '-b', ' c'])
    expect(previewBlocks(r).map((x) => [x.side, x.status])).toEqual([
      ['old', 'changed'],
      ['new', 'changed']
    ])
  })

  it('splits a list so one changed item is marked alone', () => {
    const r = rows([' - one', '-- two', '+- TWO', ' - three'])
    expect(previewBlocks(r).map((x) => [x.side, x.status, x.source])).toEqual([
      ['new', 'same', '- one'],
      ['old', 'del', '- two'],
      ['new', 'add', '- TWO'],
      ['new', 'same', '- three']
    ])
  })
})

describe('clampToDiff', () => {
  it('narrows to the lines in the PR diff', () => {
    expect(clampToDiff(10, 20, [8, 9, 12, 13, 14])).toEqual({ start: 12, end: 14 })
    expect(clampToDiff(10, 20, [1, 2])).toEqual({ start: 10, end: 20 })
  })
})

describe('syntax colors', () => {
  it('colors keywords, strings and comments, across lines', () => {
    const toks = highlightLines('const a = "x" /* one\ntwo */', jsParser)
    expect(toks[0].find((t) => t.from === 0)?.cls).toBe('syn-keyword')
    expect(toks[0].some((t) => t.cls === 'syn-string')).toBe(true)
    expect(toks[1]).toEqual([{ from: 0, to: 6, cls: 'syn-comment' }])
  })

  it('colors each side of a hunk in its own code', () => {
    const r = [
      { kind: 'hunk' as const, text: '@@ -1,2 +1,2 @@' },
      { kind: 'del' as const, text: 'let a = 1' },
      { kind: 'add' as const, text: 'const a = 2' }
    ]
    const m = highlightDiff(r, jsParser)
    expect(m.get(1)?.[0]).toEqual({ from: 0, to: 3, cls: 'syn-keyword' })
    expect(m.get(2)?.[0]).toEqual({ from: 0, to: 5, cls: 'syn-keyword' })
  })

  it('merges syntax runs with word-diff marks', () => {
    const runs = mergeRuns('const a = 2', [{ from: 0, to: 5, cls: 'syn-keyword' }, { from: 10, to: 11, cls: 'syn-number' }], [
      { text: 'const a = ', changed: false },
      { text: '2', changed: true }
    ])
    expect(runs).toEqual([
      { text: 'const', cls: 'syn-keyword' },
      { text: ' a = ' },
      { text: '2', cls: 'syn-number', changed: true }
    ])
  })
})
