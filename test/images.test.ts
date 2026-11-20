import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as g from '../src/main/git'
import { imageMime, isImageFile, isSvgFile } from '../src/shared/images'

// Smallest valid PNG header bytes plus a NUL, so git treats it as binary.
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3])
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 9, 9, 9])

describe('image files', () => {
  it('recognizes PNG and SVG by extension, case-insensitively', () => {
    expect(imageMime('a/b.png')).toBe('image/png')
    expect(imageMime('ICON.PNG')).toBe('image/png')
    expect(imageMime('logo.svg')).toBe('image/svg+xml')
    expect(isSvgFile('x.SVG')).toBe(true)
    expect(isImageFile('photo.jpg')).toBe(false)
    expect(isImageFile('png')).toBe(false)
    expect(isImageFile('README.md')).toBe(false)
  })
})

describe('fileVersions', () => {
  let wt: string
  beforeAll(async () => {
    wt = mkdtempSync(join(tmpdir(), 'choo-img-'))
    await g.git(wt, ['init', '-q', '-b', 'main'])
    await g.git(wt, ['config', 'user.email', 't@t'])
    await g.git(wt, ['config', 'user.name', 'T'])
    mkdirSync(join(wt, 'img'))
    writeFileSync(join(wt, 'img', 'changed.png'), PNG_A)
    writeFileSync(join(wt, 'img', 'gone.png'), PNG_A)
    writeFileSync(join(wt, 'img', 'old-name.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>\n')
    await g.git(wt, ['add', '.'])
    await g.git(wt, ['commit', '-qm', 'init'])
    await g.git(wt, ['checkout', '-qb', 'feature'])
    writeFileSync(join(wt, 'img', 'changed.png'), PNG_B)
    rmSync(join(wt, 'img', 'gone.png'))
    await g.git(wt, ['mv', 'img/old-name.svg', 'img/new-name.svg'])
    writeFileSync(join(wt, 'img', 'added.png'), PNG_B)
  })

  it('reads a changed image at the base and in the worktree, byte for byte', async () => {
    const v = await g.fileVersions(wt, 'main', 'img/changed.png')
    expect(v.before?.equals(PNG_A)).toBe(true)
    expect(v.after?.equals(PNG_B)).toBe(true)
  })

  it('has no before for a new file and no after for a deleted one', async () => {
    const added = await g.fileVersions(wt, 'main', 'img/added.png')
    expect(added.before).toBeNull()
    expect(added.after?.equals(PNG_B)).toBe(true)
    const gone = await g.fileVersions(wt, 'main', 'img/gone.png')
    expect(gone.before?.equals(PNG_A)).toBe(true)
    expect(gone.after).toBeNull()
  })

  it('reads a renamed file from its old path', async () => {
    const v = await g.fileVersions(wt, 'main', 'img/new-name.svg')
    expect(v.before?.toString()).toContain('<svg')
    expect(v.after?.toString()).toContain('<svg')
  })
})
