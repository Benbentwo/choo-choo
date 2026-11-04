import { describe, it, expect } from 'vitest'
import { parseFindings, findingsFromItems } from '../src/renderer/src/review'

describe('review findings', () => {
  it('parses the last json block and normalizes fields', () => {
    const text = 'Summary.\n```json\n[{"file":"x"}]\n```\nMore\n```json\n[{"file":"./src/a.ts","line":12,"severity":"high","message":"Null deref","fix":"Guard it"},{"file":"b.ts","severity":"weird","message":"m","line":0},{"nope":1}]\n```'
    expect(parseFindings(text)).toEqual([
      { file: 'src/a.ts', line: 12, severity: 'high', message: 'Null deref', fix: 'Guard it' },
      { file: 'b.ts', line: undefined, severity: 'medium', message: 'm', fix: undefined }
    ])
  })
  it('accepts an object with findings and returns null without a block', () => {
    expect(parseFindings('```json\n{"findings":[]}\n```')).toEqual([])
    expect(parseFindings('no json here')).toBeNull()
    expect(parseFindings('```json\nnot json\n```')).toBeNull()
  })
  it('only reads findings from the latest turn', () => {
    const a = { id: '1', kind: 'assistant' as const, text: '```json\n[]\n```', ts: 1 }
    const u = { id: '2', kind: 'user' as const, text: 'again', ts: 2 }
    expect(findingsFromItems([a])).toEqual([])
    expect(findingsFromItems([a, u])).toBeNull()
  })
})
