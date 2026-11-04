import { describe, it, expect } from 'vitest'
import { pickCityName, CITIES } from '../src/main/names'
import { parseDiff } from '../src/renderer/src/components/DiffView'

describe('pickCityName', () => {
  it('avoids taken names', () => {
    const taken = new Set(CITIES.slice(1))
    expect(pickCityName(taken)).toBe(CITIES[0])
  })
  it('adds a suffix when every city is taken', () => {
    expect(pickCityName(new Set(CITIES), () => 0)).toBe(`${CITIES[0]}-2`)
  })
})

describe('parseDiff', () => {
  it('numbers lines', () => {
    const d = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', ' a', '-b', '+c', ''].join('\n')
    const l = parseDiff(d)
    expect(l.map((x) => x.kind)).toEqual(['hunk', 'ctx', 'del', 'add'])
    expect(l[1]).toMatchObject({ oldNo: 1, newNo: 1 })
    expect(l[2]).toMatchObject({ oldNo: 2 })
    expect(l[3]).toMatchObject({ newNo: 2 })
  })
})
