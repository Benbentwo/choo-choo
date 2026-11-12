import { describe, it, expect } from 'vitest'
import { findMatches } from '../src/renderer/src/findText'

describe('findMatches', () => {
  it('finds every occurrence, ignoring case and without overlaps', () => {
    expect(findMatches('Run: run the RUNNER', 'run')).toEqual([0, 5, 13])
    expect(findMatches('aaaa', 'aa')).toEqual([0, 2])
  })
  it('returns nothing for an empty query or no match, and stops at the limit', () => {
    expect(findMatches('abc', '')).toEqual([])
    expect(findMatches('abc', 'x')).toEqual([])
    expect(findMatches('a a a a', 'a', 2)).toEqual([0, 2])
  })
  it('treats the query as plain text, not a pattern', () => {
    expect(findMatches('${{ steps.x }} and a.b', '.')).toEqual([9, 20])
    expect(findMatches('if [ -n "$A" ]', '[ -n')).toEqual([3])
  })
})
