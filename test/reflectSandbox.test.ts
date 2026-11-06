import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
import { insideDir } from '../src/main/reflect'

describe('reflect agent read sandbox', () => {
  const root = '/w/repo'
  it('allows reads inside the workspace', () => {
    expect(insideDir(root, 'Read', { file_path: '/w/repo/CLAUDE.md' })).toBe(true)
    expect(insideDir(root, 'Glob', { pattern: '**/*.md' })).toBe(true)
    expect(insideDir(root, 'Grep', { pattern: '/api/..', path: 'src', glob: '*.ts' })).toBe(true)
  })
  it('blocks anything that escapes it', () => {
    expect(insideDir(root, 'Read', { file_path: '/etc/passwd' })).toBe(false)
    expect(insideDir(root, 'Read', { file_path: '../other/.env' })).toBe(false)
    expect(insideDir(root, 'Glob', { pattern: '/Users/me/**' })).toBe(false)
    expect(insideDir(root, 'Glob', { pattern: '../**/*' })).toBe(false)
    expect(insideDir(root, 'Grep', { pattern: 'x', glob: '~/.ssh/*' })).toBe(false)
    expect(insideDir(root, 'Grep', { pattern: 'x', path: ['a'] })).toBe(false)
  })
})
