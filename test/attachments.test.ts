import { describe, expect, it } from 'vitest'
import { INLINE_IMAGE, MAX_ATTACHED_FILES, addAttachedFiles, fileName, withAttachedFiles } from '../src/shared/attachments'

describe('withAttachedFiles', () => {
  it('leaves a message without files alone', () => {
    expect(withAttachedFiles('hello', [])).toBe('hello')
  })
  it('lists the paths after the typed text', () => {
    expect(withAttachedFiles('Build this', ['/tmp/onboarding.excalidraw', '/tmp/notes.md'])).toBe(
      'Build this\n\nAttached files (read them from these paths):\n- /tmp/onboarding.excalidraw\n- /tmp/notes.md'
    )
  })
  it('writes a line when nothing was typed', () => {
    expect(withAttachedFiles('  ', ['/tmp/a.csv'])).toMatch(/^See the attached file\.\n\nAttached files/)
    expect(withAttachedFiles('', ['/tmp/a.csv', '/tmp/b.csv'])).toMatch(/^See the attached files\./)
  })
})

describe('addAttachedFiles', () => {
  it('skips duplicates and empty paths', () => {
    expect(addAttachedFiles(['/a'], ['/a', '', '/b'])).toEqual(['/a', '/b'])
  })
  it('caps the list', () => {
    const many = Array.from({ length: MAX_ATTACHED_FILES + 5 }, (_, i) => `/f${i}`)
    expect(addAttachedFiles([], many)).toHaveLength(MAX_ATTACHED_FILES)
  })
})

describe('fileName', () => {
  it('takes the last part of a path', () => {
    expect(fileName('/Users/me/diagram.excalidraw')).toBe('diagram.excalidraw')
    expect(fileName('/Users/me/folder/')).toBe('folder')
    expect(fileName('C:\\docs\\plan.pdf')).toBe('plan.pdf')
  })
})

describe('INLINE_IMAGE', () => {
  it('matches the image types sent as pictures', () => {
    expect(INLINE_IMAGE.test('image/png')).toBe(true)
    expect(INLINE_IMAGE.test('image/svg+xml')).toBe(false)
    expect(INLINE_IMAGE.test('application/json')).toBe(false)
  })
})
