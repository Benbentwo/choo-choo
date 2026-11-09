import { describe, expect, it } from 'vitest'
import { tidyMarkdown } from '../src/renderer/src/markdown'

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
