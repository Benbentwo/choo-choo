import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDashboard, dedupeMsgs, findHits, msgCost, usageCsv, windowDetail, type Attributor, type UsageMsg, type UsageReading } from '../src/shared/usageHistory'
import * as uh from '../src/main/usageHistory'

const H = 3600_000
const T0 = new Date(2026, 10, 10, 14, 0).getTime() // Tue Nov 10, 2 PM local

const msg = (t: number, s: string, cwd: string, o = 1000, m = 'claude-opus-5-5', id = `${s}:${t}`): UsageMsg => ({ t, id, s, cwd, m, i: 10, cw: 0, cr: 0, o })

const attr: Attributor = {
  group: (m) => ({ id: m.cwd ?? 'x', label: m.cwd ?? 'x', kind: 'repo' }),
  chat: (s) => ({ title: `chat ${s}` })
}

describe('usage history: shared', () => {
  it('prices models against each other', () => {
    expect(msgCost({ m: 'claude-opus-5-5', i: 1e6, cw: 0, cr: 0, o: 0 })).toBeCloseTo(4)
    expect(msgCost({ m: 'claude-sonnet-4-6', i: 0, cw: 0, cr: 0, o: 1e6 })).toBeCloseTo(15)
    expect(msgCost({ m: 'claude-opus-5-5', i: 0, cw: 0, cr: 1e6, o: 0 })).toBeCloseTo(0.2)
    expect(msgCost({ m: 'claude-haiku-4-5', i: 0, cw: 1e6, cr: 0, o: 0 })).toBeCloseTo(1.25)
  })

  it('keeps one response per id, with the final output count', () => {
    const a = msg(T0, 's', '/a', 5, 'claude-opus-5-5', 'm1')
    const b = { ...a, o: 50 }
    expect(dedupeMsgs([a, b])).toEqual([{ ...a, o: 50 }])
  })

  it('finds the first full reading of each window period', () => {
    const r = T0 + 5 * H
    const rs: UsageReading[] = [
      { t: T0 + H, k: 'claude:five_hour', p: 60, r, w: 5 * H },
      { t: T0 + 2 * H, k: 'claude:five_hour', p: 100, r, w: 5 * H },
      { t: T0 + 3 * H, k: 'claude:five_hour', p: 100, r, w: 5 * H },
      { t: T0 + 6 * H, k: 'claude:five_hour', p: 100, r: r + 5 * H, w: 5 * H }
    ]
    const hits = findHits(rs)
    expect(hits.map((h) => [h.t, h.waitedMs, h.start])).toEqual([
      [T0 + 2 * H, 3 * H, T0],
      [T0 + 6 * H, 4 * H, T0 + 5 * H]
    ])
    expect(hits[0].label).toBe('5-hour')
  })

  it('builds the dashboard: groups by cost, buckets by day, heat by local hour', () => {
    const msgs = [msg(T0, 'a', 'webapp', 1000), msg(T0 + H, 'b', 'api', 3000), msg(T0 + 25 * H, 'a', 'webapp', 2000)]
    const d = buildDashboard({ readings: [{ t: T0, k: 'claude:seven_day', p: 30 }], msgs, from: T0 - 3 * 24 * H, to: T0 + 2 * 24 * H, attribute: attr })
    expect(d.bucket).toBe('day')
    expect(d.groups.map((g) => g.label)).toEqual(['webapp', 'api'])
    expect(d.groups[0].share + d.groups[1].share).toBeCloseTo(1)
    expect(d.responses).toBe(3)
    expect(d.sessions).toBe(2)
    expect(d.windows[0].label).toBe('Weekly')
    expect(d.heat[1][14]).toBeGreaterThan(0) // Tuesday 2 PM
    const tue = d.buckets.find((b) => b.start === new Date(2026, 10, 10).getTime())!
    expect(tue.costs.Opus).toBeGreaterThan(0)
  })

  it('folds the tail into Other', () => {
    const msgs = Array.from({ length: 9 }, (_, i) => msg(T0 + i, `s${i}`, `repo${i}`, 1000 * (i + 1)))
    const d = buildDashboard({ readings: [], msgs, from: T0 - H, to: T0 + H, attribute: attr, maxGroups: 6 })
    expect(d.groups).toHaveLength(7)
    expect(d.groups[6].label).toBe('Other (3)')
  })

  it('splits each rise between readings by cost, and unexplained rises go to Not on this Mac', () => {
    const k = 'claude:five_hour'
    const readings: UsageReading[] = [
      { t: T0 + H, k, p: 40, r: T0 + 5 * H, w: 5 * H },
      { t: T0 + 2 * H, k, p: 60, r: T0 + 5 * H, w: 5 * H },
      { t: T0 + 3 * H, k, p: 100, r: T0 + 5 * H, w: 5 * H }
    ]
    const msgs = [msg(T0 + 0.5 * H, 'a', 'webapp', 3000), msg(T0 + 0.6 * H, 'b', 'api', 1000), msg(T0 + 2.5 * H, 'a', 'webapp', 1000)]
    const d = windowDetail({ key: k, start: T0, end: T0 + 5 * H, readings, msgs, attribute: attr })
    const share = Object.fromEntries(d.groups.map((g) => [g.id, Math.round(g.share)]))
    expect(share).toEqual({ webapp: 70, api: 10, elsewhere: 20 })
    expect(d.hit?.t).toBe(T0 + 3 * H)
    expect(d.series.webapp.at(-1)).toBeCloseTo(70, 0)
    expect(d.chats[0]).toMatchObject({ session: 'a', title: 'chat a', responses: 2 })
    expect(d.responses).toBe(3)
  })

  it('writes CSV without message text', () => {
    const csv = usageCsv([msg(T0, 'a', 'web,app')], attr)
    expect(csv.split('\n')[1]).toContain('"web,app"')
  })
})

describe('usage history: store', () => {
  let data: string
  beforeEach(() => {
    uh._resetUsageHistoryForTests()
    data = mkdtempSync(join(tmpdir(), 'usage-'))
    uh.initUsageHistory(data, { enabled: true, keepMonths: 12 })
  })

  it('saves readings when they move or every 15 minutes, never going back in time', () => {
    const now = Date.now()
    uh.recordReading('claude:five_hour', now - 60 * 60_000, 10)
    uh.recordReading('claude:five_hour', now - 58 * 60_000, 10.2) // same, too soon
    uh.recordReading('claude:five_hour', now - 56 * 60_000, 12)
    uh.recordReading('claude:five_hour', now - 70 * 60_000, 50) // older
    uh.recordReading('claude:five_hour', now - 30 * 60_000, 12) // unchanged but 15+ min later
    expect(uh.readings(now - 2 * H, now).map((x) => x.p)).toEqual([10, 12, 12])
  })

  it('copies new transcript lines, once, and keeps going from where it stopped', async () => {
    const root = join(data, 'projects')
    mkdirSync(join(root, '-Users-me-webapp', 'sess1', 'subagents'), { recursive: true })
    const t = new Date().toISOString()
    const line = (id: string, out: number, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ type: 'assistant', timestamp: t, sessionId: 'sess1', cwd: '/Users/me/webapp', message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: out, cache_read_input_tokens: 100 }, content: [{ type: 'text', text: 'secret words' }] }, ...extra }) + '\n'
    const main = join(root, '-Users-me-webapp', 'sess1.jsonl')
    writeFileSync(main, line('m1', 1) + line('m1', 40) + JSON.stringify({ type: 'user', timestamp: t, message: { content: 'hi' } }) + '\n')
    writeFileSync(join(root, '-Users-me-webapp', 'sess1', 'subagents', 'agent-1.jsonl'), line('m2', 7))
    expect(await uh.syncTranscripts(root)).toBe(2)
    expect(await uh.syncTranscripts(root)).toBe(0)
    appendFileSync(main, line('m3', 9) + '{"type":"assistant","partial')
    expect(await uh.syncTranscripts(root)).toBe(1)
    const msgs = uh.messages(Date.now() - H, Date.now() + H)
    expect(msgs.map((m) => [m.id, m.o, m.sub ?? 0]).sort()).toEqual([
      ['m1', 40, 0],
      ['m2', 7, 1],
      ['m3', 9, 0]
    ])
    const files = readdirSync(join(data, 'usage'))
    expect(files.some((f) => f.startsWith('messages-'))).toBe(true)
    expect(JSON.stringify(msgs)).not.toContain('secret')
  })

  it('attributes by chat session, then by folder, else outside', () => {
    const a = uh.attributor({
      repos: [{ id: 'r1', name: 'webapp', path: '/src/webapp', defaultBranch: 'main' }],
      workspaces: [{ id: 'w1', repoId: 'r1', name: 'oslo', path: '/ws/webapp/oslo', title: 'Retry requests' } as never, { id: 'w2', repoId: 'r1', name: 'lima', path: '/ws/webapp/lima', title: 'Thread', orchestratorId: 'g1' } as never],
      chats: [{ id: 'c1', workspaceId: 'w1', title: 'Add backoff', sdkSessionId: 's1' } as never],
      groups: [{ id: 'g1', name: 'Launch', repoIds: ['r1'], createdAt: 0 }]
    })
    expect(a.group(msg(T0, 's1', '/elsewhere')).label).toBe('webapp')
    expect(a.group(msg(T0, 's9', '/ws/webapp/lima/src')).label).toBe('Project: Launch')
    expect(a.group(msg(T0, 's9', '/src/webapp')).label).toBe('webapp')
    expect(a.group(msg(T0, 's9', '/home/me/scratch')).label).toBe('Outside Choo Choo · scratch')
    expect(a.chat('s1')).toEqual({ title: 'Add backoff', workspace: 'Retry requests' })
    expect(a.chat('s9', '/home/me/scratch').title).toBe('Terminal session in scratch')
  })
})
