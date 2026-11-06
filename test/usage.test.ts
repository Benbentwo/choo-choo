import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contextTokens, guessContextWindow, parseTranscript, sessionUsage } from '../src/main/usage'

const assistant = (id: string, ts: string, usage: Record<string, number>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: ts, requestedModel: 'claude-opus-5-5', message: { id, model: 'claude-opus-5-5', usage }, ...extra })

const transcript = [
  JSON.stringify({ type: 'user', timestamp: '2026-11-06T20:00:00Z', message: { content: 'hi' } }),
  assistant('m1', '2026-11-06T20:00:01Z', { input_tokens: 3, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 10 }),
  // Same response, a later content block with the final output count.
  assistant('m1', '2026-11-06T20:00:02Z', { input_tokens: 3, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 50 }),
  assistant('m2', '2026-11-06T20:00:05Z', { input_tokens: 1, cache_creation_input_tokens: 200, cache_read_input_tokens: 1000, output_tokens: 20 }),
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-11-06T20:01:00Z' }),
  assistant('m3', '2026-11-06T20:01:05Z', { input_tokens: 5, output_tokens: 1 }, { isSidechain: true }),
  JSON.stringify({ type: 'assistant', timestamp: '2026-11-06T20:01:06Z', message: { id: 'x', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } }),
  'not json',
  ''
].join('\n')

describe('parseTranscript', () => {
  it('merges lines of one response and keeps the final output count', () => {
    const { points, compactions } = parseTranscript(transcript)
    expect(points).toHaveLength(3)
    expect(points[0]).toMatchObject({ input: 3, cacheWrite: 1000, cacheRead: 0, output: 50, model: 'claude-opus-5-5' })
    expect(points[0].subagent).toBeUndefined()
    expect(contextTokens(points[1])).toBe(1221)
    expect(points[2].subagent).toBe(true)
    expect(compactions).toEqual([Date.parse('2026-11-06T20:01:00Z')])
  })

  it('guesses the context window', () => {
    const { points } = parseTranscript(transcript)
    expect(guessContextWindow(points, ['claude-opus-5-5'])).toBe(200_000)
    expect(guessContextWindow(points, ['claude-opus-5-5[1m]'])).toBe(1_000_000)
    expect(guessContextWindow([{ ...points[0], cacheRead: 300_000 }], [])).toBe(1_000_000)
  })
})

describe('sessionUsage', () => {
  it('finds the transcript and its subagents in any project folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'usage-'))
    const proj = join(root, '-Users-me-repo')
    mkdirSync(join(proj, 'sess-1', 'subagents'), { recursive: true })
    writeFileSync(join(proj, 'sess-1.jsonl'), transcript)
    writeFileSync(join(proj, 'sess-1', 'subagents', 'agent-a.jsonl'), assistant('s1', '2026-11-06T20:00:03Z', { input_tokens: 9, output_tokens: 9 }))
    const u = sessionUsage('sess-1', { root, costUsd: 1.5 })
    expect(u.points.map((p) => p.ts)).toEqual([...u.points.map((p) => p.ts)].sort((a, b) => a - b))
    expect(u.points).toHaveLength(4)
    expect(u.points[1]).toMatchObject({ input: 9, subagent: true })
    expect(u.contextWindow).toBe(200_000)
    expect(u.costUsd).toBe(1.5)
    expect(u.empty).toBeUndefined()
  })

  it('explains an empty result', () => {
    expect(sessionUsage(undefined).empty).toMatch(/first reply/)
    expect(sessionUsage('missing', { root: mkdtempSync(join(tmpdir(), 'usage-')) }).empty).toMatch(/wasn't found/)
    expect(sessionUsage('../etc', { root: tmpdir() }).points).toEqual([])
  })
})
