import { describe, expect, it } from 'vitest'
import { ACCENTS, DEFAULT_APPEARANCE, THEMES, resolveAccent, resolveTheme } from '../src/shared/themes'

describe('themes', () => {
  it('gives every theme the same set of color tokens', () => {
    const keys = Object.keys(THEMES[0].tokens).sort()
    for (const t of THEMES) expect(Object.keys(t.tokens).sort()).toEqual(keys)
  })

  it('defaults to the Choo Choo brand look', () => {
    expect(DEFAULT_APPEARANCE).toMatchObject({ theme: 'choo', accent: 'choo', uiFont: 'manrope', monoFont: 'jetbrains' })
    expect(resolveTheme('choo', false).tokens.bg).toBe('#202226')
    expect(resolveAccent('choo', true)).toBe('#f4773d')
    expect(resolveAccent('choo', false)).toBe('#9c431a')
  })

  it('keeps the original dark palette available', () => {
    expect(resolveTheme('dark', false).tokens.bg).toBe('#1a1817')
  })

  it('follows the OS for the system theme and falls back for unknown ids', () => {
    expect(resolveTheme('system', true).id).toBe('choo')
    expect(resolveTheme('system', false).id).toBe('choo-light')
    expect(resolveTheme('nope', false).id).toBe('choo')
  })

  it('picks the accent shade for the theme and passes custom colors through', () => {
    const sky = ACCENTS.find((a) => a.id === 'sky')!
    expect(resolveAccent('sky', true)).toBe(sky.dark)
    expect(resolveAccent('sky', false)).toBe(sky.light)
    expect(resolveAccent('#123abc', true)).toBe('#123abc')
  })
})
