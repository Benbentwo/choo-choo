import { describe, it, expect } from 'vitest'
import { pairedSegs, wordDiff } from '../src/renderer/src/wordDiff'

const changed = (s: { text: string; changed: boolean }[]) => s.filter((x) => x.changed).map((x) => x.text)

describe('wordDiff', () => {
  it('marks only the words that changed', () => {
    const w = wordDiff('keyed on the tested tag and the sha256', 'keyed on the tested image (index digest) and the sha256')!
    expect(changed(w.old)).toEqual(['tag'])
    expect(changed(w.new)).toEqual(['image (index digest)'])
    expect(w.new.map((s) => s.text).join('')).toBe('keyed on the tested image (index digest) and the sha256')
  })
  it('finds several separate edits in one line', () => {
    const w = wordDiff('const a = foo(1, 2)', 'let a = bar(1, 2)')!
    expect(changed(w.old)).toEqual(['const', 'foo'])
    expect(changed(w.new)).toEqual(['let', 'bar'])
  })
  it('marks a pure insertion on the new side only', () => {
    const w = wordDiff('echo "hi"', 'echo "hi" >&2')!
    expect(changed(w.old)).toEqual([])
    expect(changed(w.new)).toEqual([' >&2'])
  })
  it('gives up on identical lines and on rewrites', () => {
    expect(wordDiff('same', 'same')).toBeNull()
    expect(wordDiff('return compute(total)', 'if (!ready) throw new Error("x")')).toBeNull()
  })
})

describe('pairedSegs', () => {
  it('pairs the nth removed line with the nth added line of a block', () => {
    const lines = [
      { kind: 'ctx', text: 'top' },
      { kind: 'del', text: 'a = 1' },
      { kind: 'del', text: 'b = 2' },
      { kind: 'add', text: 'a = 10' },
      { kind: 'add', text: 'b = 20' },
      { kind: 'add', text: 'c = 30' },
      { kind: 'ctx', text: 'end' },
      { kind: 'add', text: 'lonely = 1' }
    ]
    const m = pairedSegs(lines)
    expect([...m.keys()].sort()).toEqual([1, 2, 3, 4])
    expect(changed(m.get(1)!)).toEqual(['1'])
    expect(changed(m.get(4)!)).toEqual(['20'])
  })
})
