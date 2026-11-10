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
