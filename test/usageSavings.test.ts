import { describe, it, expect } from 'vitest'
import { HANDOFF_REPORT, MAX_BATCH_WAIT_MS, holdUpdate, memoryHash, memoryTurnPrefix, withHandoffReport } from '../src/shared/usageSavings'
import { orchestrationSplit, type UsageMsg } from '../src/shared/usageHistory'

describe('handoff report', () => {
  it('asks the workspace to end with a short report', () => {
    const t = withHandoffReport('Fix the login bug.\n\n')
    expect(t.startsWith('Fix the login bug.\n\n')).toBe(true)
    expect(t.endsWith(HANDOFF_REPORT)).toBe(true)
    expect(HANDOFF_REPORT).toContain('pull request link')
  })
})

describe('memory with the turn', () => {
  it('sends memory to a new session and when it changed, not otherwise', () => {
    const first = memoryTurnPrefix({ memory: '- small PRs', path: '/m.md', newSession: true })
    expect(first.prefix).toContain('- small PRs')
    expect(first.prefix).toContain('<project-memory path="/m.md">')
    expect(memoryTurnPrefix({ memory: '- small PRs', path: '/m.md', lastHash: first.hash, newSession: false }).prefix).toBeUndefined()
    expect(memoryTurnPrefix({ memory: '- small PRs', path: '/m.md', lastHash: first.hash, newSession: true }).prefix).toBeDefined()
    expect(memoryTurnPrefix({ memory: '- big PRs', path: '/m.md', lastHash: first.hash, newSession: false }).prefix).toContain('- big PRs')
    expect(memoryTurnPrefix({ memory: '', path: '/m.md', newSession: true }).prefix).toContain('(empty)')
  })
  it('hashes stably and tells versions apart', () => {
    expect(memoryHash('abc')).toBe(memoryHash('abc'))
    expect(memoryHash('abc')).not.toBe(memoryHash('abd'))
  })
})

describe('one update per batch', () => {
  const now = 1_000_000_000
  it('holds a finished workspace while others for the same chat still run', () => {
    expect(holdUpdate({ finished: [{ state: 'finished', at: now }], othersRunning: 2, now })).toEqual({ hold: true, recheckInMs: MAX_BATCH_WAIT_MS })
  })
  it('sends right away when nothing else runs, on an error, or after the longest wait', () => {
    expect(holdUpdate({ finished: [{ state: 'finished', at: now }], othersRunning: 0, now }).hold).toBe(false)
    expect(holdUpdate({ finished: [{ state: 'finished', at: now }, { state: 'error', at: now }], othersRunning: 1, now }).hold).toBe(false)
    expect(holdUpdate({ finished: [{ state: 'finished', at: now - MAX_BATCH_WAIT_MS }], othersRunning: 1, now }).hold).toBe(false)
    expect(holdUpdate({ finished: [], othersRunning: 1, now }).hold).toBe(false)
  })
})

describe('project work in the usage page', () => {
  const m = (s: string, o: Partial<UsageMsg> = {}): UsageMsg => ({ t: 0, id: s + Math.random(), s, m: 'claude-opus-5-5', i: 0, cw: 0, cr: 0, o: 1000, ...o })
  it('splits orchestrated work by role and measures cache writes in threads', () => {
    const roles: Record<string, 'router' | 'thread' | 'workspace'> = { r: 'router', t: 'thread', w: 'workspace' }
    const msgs = [m('r'), m('t', { o: 0, cw: 1_000_000 }), m('t'), m('w'), m('w'), m('x')]
    const total = msgs.reduce((a, x) => a + (x.o * 20 + x.cw * 5) / 1e6, 0)
    const split = orchestrationSplit(msgs, (x) => roles[x.s], total)!
    expect(split.parts.map((p) => p.role)).toEqual(['router', 'thread', 'workspace'])
    expect(split.parts.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1)
    // The thread wrote $5 of cache; router and thread used $5.04 in all.
    expect(split.cacheWriteShare).toBeCloseTo(5 / 5.04, 3)
    expect(split.shareOfAll).toBeCloseTo(split.cost / total)
    expect(orchestrationSplit([m('x')], () => undefined, 1)).toBeUndefined()
  })
})
