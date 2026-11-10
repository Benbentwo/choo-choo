import { describe, expect, it } from 'vitest'
import { inOpenFence, splitFences, tidyMarkdown } from '../src/renderer/src/markdown'

describe('tidyMarkdown', () => {
  it('separates a numbered list from the heading line above it', () => {
    expect(tidyMarkdown('**Worth fixing**\n4. One\n5. Two')).toBe('**Worth fixing**\n\n4. One\n5. Two')
  })

  it('leaves lists that already follow a blank line or another item alone', () => {
    const s = 'Intro\n\n1. One\n2. Two'
    expect(tidyMarkdown(s)).toBe(s)
  })

  it('leaves continuation lines and code blocks alone', () => {
    const s = '1. One\n   wrapped\n2. Two\n```\nx\n3. not a list\n```'
    expect(tidyMarkdown(s)).toBe(s)
  })
})

describe('splitFences', () => {
  it('pulls fenced blocks out of typed text and keeps their spacing', () => {
    expect(splitFences('```\n  + a = 1\n    b = 2\n```\n\nis fine?')).toEqual([
      { code: true, text: '  + a = 1\n    b = 2' },
      { code: false, text: 'is fine?' }
    ])
  })
  it('keeps the language, text on both sides, and text with no fence', () => {
    expect(splitFences('look:\n```hcl\nx = 1\n```\nok')).toEqual([
      { code: false, text: 'look:' },
      { code: true, text: 'x = 1', lang: 'hcl' },
      { code: false, text: 'ok' }
    ])
    expect(splitFences('just *text* with `ticks`')).toEqual([{ code: false, text: 'just *text* with `ticks`' }])
  })
  it('runs an unclosed block to the end and ignores a shorter fence inside', () => {
    expect(splitFences('````\n```\nx')).toEqual([{ code: true, text: '```\nx' }])
  })
})

describe('inOpenFence', () => {
  it('is true only between an opening fence and its close', () => {
    expect(inOpenFence('hi\n```')).toBe(true)
    expect(inOpenFence('hi\n```ts\nconst a = 1')).toBe(true)
    expect(inOpenFence('```\nx\n```')).toBe(false)
    expect(inOpenFence('```\nx\n```\nmore')).toBe(false)
    expect(inOpenFence('a `tick` and ``two``')).toBe(false)
  })
})
