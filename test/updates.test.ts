import { describe, it, expect } from 'vitest'
import { compareVersions, isNewer, parseVersion } from '../src/shared/updates'

describe('parseVersion', () => {
  it('reads claude --version output and release tags', () => {
    expect(parseVersion('2.1.318 (Claude Code)\n')).toBe('2.1.318')
    expect(parseVersion('v0.2.0')).toBe('0.2.0')
    expect(parseVersion('v1.0.0-beta.2')).toBe('1.0.0-beta.2')
    expect(parseVersion('no version here')).toBeUndefined()
  })
})

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('2.1.319', '2.1.318')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
  })
  it('puts pre-releases before the release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0)
  })
  it('isNewer needs both versions', () => {
    expect(isNewer('2.1.319', '2.1.318')).toBe(true)
    expect(isNewer('2.1.318', '2.1.318')).toBe(false)
    expect(isNewer(undefined, '2.1.318')).toBe(false)
    expect(isNewer('2.1.319', undefined)).toBe(false)
  })
})
