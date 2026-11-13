import { describe, expect, it } from 'vitest'
import { resolveHref } from '../src/shared/linkHref'

const ctx = { slug: 'acme/app', ref: 'main', root: '/Users/me/ws/app' }

describe('resolveHref', () => {
  it('keeps web and mail links', () => {
    expect(resolveHref('https://example.com/x?y=1')).toBe('https://example.com/x?y=1')
    expect(resolveHref('mailto:a@example.com')).toBe('mailto:a@example.com')
    expect(resolveHref('www.example.com')).toBe('https://www.example.com')
  })

  it('maps repo paths to GitHub, with lines', () => {
    expect(resolveHref('src/a.ts', ctx)).toBe('https://github.com/acme/app/blob/main/src/a.ts')
    expect(resolveHref('./src/a.ts:12', ctx)).toBe('https://github.com/acme/app/blob/main/src/a.ts#L12')
    expect(resolveHref('src/a.ts:12-20', ctx)).toBe('https://github.com/acme/app/blob/main/src/a.ts#L12-L20')
    expect(resolveHref('src/a.ts#L3-L4', ctx)).toBe('https://github.com/acme/app/blob/main/src/a.ts#L3-L4')
    expect(resolveHref('docs/', ctx)).toBe('https://github.com/acme/app/tree/main/docs')
    expect(resolveHref('docs/My%20Notes.md', ctx)).toBe('https://github.com/acme/app/blob/main/docs/My%20Notes.md')
    expect(resolveHref('/Users/me/ws/app/src/b.ts', ctx)).toBe('https://github.com/acme/app/blob/main/src/b.ts')
    expect(resolveHref('file:///Users/me/ws/app/src/b.ts', ctx)).toBe('https://github.com/acme/app/blob/main/src/b.ts')
    expect(resolveHref('src/a.ts', { ...ctx, ref: 'feat/x' })).toBe('https://github.com/acme/app/blob/feat/x/src/a.ts')
  })

  it('drops links with no target outside the app', () => {
    expect(resolveHref('#section', ctx)).toBeNull()
    expect(resolveHref('javascript:alert(1)', ctx)).toBeNull()
    expect(resolveHref('/etc/hosts', ctx)).toBeNull()
    expect(resolveHref('../other/x.ts', ctx)).toBeNull()
    expect(resolveHref('src/a.ts', {})).toBeNull()
  })
})
