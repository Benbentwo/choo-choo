import { describe, expect, it } from 'vitest'
import { parseGhApi } from '../src/main/prWatch'

describe('parseGhApi', () => {
  it('reads status, ETag and body from gh api -i output', () => {
    const out = 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nEtag: W/"abc123"\r\n\r\n[{"n":54,"sha":"f797"}]\n'
    expect(parseGhApi(out)).toEqual({ status: 200, etag: 'W/"abc123"', body: '[{"n":54,"sha":"f797"}]\n' })
  })

  it('recognises 304 Not Modified with no body', () => {
    const out = 'HTTP/2.0 304 Not Modified\nX-Ratelimit-Remaining: 4972\n'
    expect(parseGhApi(out)).toMatchObject({ status: 304, etag: undefined, body: '' })
  })

  it('returns status 0 for output that is not an HTTP response', () => {
    expect(parseGhApi('gh: Not Found').status).toBe(0)
  })
})

describe('startPrWatch', () => {
  it('probes a known PR by number, and starts over when the workspace changes branch', async () => {
    const { mkdtempSync, writeFileSync, chmodSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { startPrWatch } = await import('../src/main/prWatch')
    const dir = mkdtempSync(join(tmpdir(), 'choo-prwatch-'))
    const log = join(dir, 'calls')
    // A gh that logs `gh api` paths and answers 200 with a fresh ETag.
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$@" >> ${log}\nprintf 'HTTP/2.0 200 OK\\r\\nEtag: "e'$$'"\\r\\n\\r\\n[{"n":5,"sha":"abc"}]\\n'\n`)
    chmodSync(join(dir, 'gh'), 0o755)
    const path = process.env.PATH
    process.env.PATH = `${dir}:${path}`
    let target = { id: 'w', path: dir, branch: 'feature', pr: undefined as number | undefined }
    let before = 0
    const changed: string[] = []
    const watch = startPrWatch({ targets: () => [target], focused: () => true, onChange: (id) => changed.push(id), beforeTick: async () => void before++ })
    const settle = async () => {
      for (let i = 0; i < 100 && !readFileSync(log, 'utf8').includes('check-runs'); i++) await new Promise((r) => setTimeout(r, 20))
      await new Promise((r) => setTimeout(r, 50))
    }
    try {
      writeFileSync(log, '')
      watch.poke()
      await settle()
      expect(readFileSync(log, 'utf8')).toContain('pulls?head={owner}:feature')
      expect(changed).toEqual([])
      target = { ...target, branch: 'contributor-fix', pr: 77 }
      writeFileSync(log, '')
      watch.poke()
      await settle()
      expect(readFileSync(log, 'utf8')).toContain('repos/{owner}/{repo}/pulls/77')
      // A new branch is refreshed right away.
      expect(changed).toEqual(['w'])
      expect(before).toBe(2)
    } finally {
      watch.stop()
      process.env.PATH = path
    }
  })
})
