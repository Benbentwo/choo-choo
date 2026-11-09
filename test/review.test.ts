import { describe, it, expect } from 'vitest'
import { parseFindings, findingsFromItems, REVIEW_PROMPT, SECURITY_REVIEW_PROMPT } from '../src/renderer/src/review'

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


describe('review prompts', () => {
  it('adds the reviewer rules only in strict mode and keeps the JSON format', () => {
    expect(REVIEW_PROMPT('main')).not.toContain('Cross-boundary')
    expect(REVIEW_PROMPT('main', true)).toContain('Cross-boundary')
    expect(SECURITY_REVIEW_PROMPT('main')).toContain('```json')
  })
})

describe('splitFindings', () => {
  it('separates the prose from the findings block', async () => {
    const { splitFindings } = await import('../src/renderer/src/review')
    const text = 'Two problems.\n\n```json\n[{"file":"a.ts","line":3,"severity":"high","message":"Bad","fix":"Good"}]\n```'
    expect(splitFindings(text)).toEqual({ prose: 'Two problems.', findings: [{ file: 'a.ts', line: 3, severity: 'high', message: 'Bad', fix: 'Good' }] })
  })

  it('leaves replies without a findings block alone', async () => {
    const { splitFindings } = await import('../src/renderer/src/review')
    expect(splitFindings('No JSON here.\n\n```ts\nconst x = 1\n```')).toBeNull()
  })
})
