import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { continueSettings, insertIndex, limitFromEvent, limitFromText, moveItem, parseQueueTarget, pickToStart, shouldWait, toMs, untilText, type QueueItem } from '../src/shared/continueWork'
import type { Chat, SubscriptionLimits } from '../src/shared/types'

const home = mkdtempSync(join(tmpdir(), 'choo-continue-'))
vi.mock('electron', () => ({ app: { getPath: () => home } }))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => home }))
const store = await import('../src/main/store')
const cw = await import('../src/main/continueWork')

const NOW = Date.UTC(2026, 10, 12, 22, 0)
const HOUR = 3600_000

describe('detecting a usage-limit stop', () => {
  it('reads a rejected rate_limit_event, in seconds or milliseconds', () => {
    const sec = Math.floor((NOW + HOUR) / 1000)
    expect(limitFromEvent({ rate_limit_info: { status: 'rejected', resetsAt: sec, rateLimitType: 'five_hour' } }, NOW)).toEqual({ kind: 'five_hour', resetsAt: sec * 1000, at: NOW })
    expect(limitFromEvent({ rate_limit_info: { status: 'rejected', resetsAt: NOW + HOUR, rateLimitType: 'seven_day' } }, NOW)?.resetsAt).toBe(NOW + HOUR)
    expect(toMs('1700000000')).toBe(1700000000000)
  })
  it('ignores warnings, allowed, and turns paid by extra usage', () => {
    expect(limitFromEvent({ rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour' } }, NOW)).toBeNull()
    expect(limitFromEvent({ rate_limit_info: { status: 'allowed' } }, NOW)).toBeNull()
    expect(limitFromEvent({ rate_limit_info: { status: 'rejected', isUsingOverage: true } }, NOW)).toBeNull()
    expect(limitFromEvent({}, NOW)).toBeNull()
  })
  it('reads the limit message Claude Code shows, but not spend limits', () => {
    expect(limitFromText("You've hit your session limit · resets 3:45pm", NOW)?.kind).toBe('five_hour')
    expect(limitFromText("You've hit your weekly limit · resets Mon 12:00am", NOW)?.kind).toBe('seven_day')
    expect(limitFromText("You've hit your Opus limit · resets 3:45pm", NOW)?.kind).toBe('seven_day_opus')
    expect(limitFromText("You've reached your usage limit", NOW)?.kind).toBe('unknown')
    expect(limitFromText("You've hit your monthly spend limit · raise it at https://claude.ai/settings/usage", NOW)).toBeNull()
    expect(limitFromText('API Error: Server is temporarily limiting requests (not your usage limit)', NOW)).toBeNull()
    expect(limitFromText(undefined, NOW)).toBeNull()
  })
  it('waits for the 5-hour window, and weekly ones only when under a day away', () => {
    const s = continueSettings({})
    expect(shouldWait({ kind: 'five_hour', at: NOW }, s, NOW)).toBe(true)
    expect(shouldWait({ kind: 'seven_day', resetsAt: NOW + 3 * HOUR, at: NOW }, s, NOW)).toBe(true)
    expect(shouldWait({ kind: 'seven_day', resetsAt: NOW + 30 * HOUR, at: NOW }, s, NOW)).toBe(false)
    expect(shouldWait({ kind: 'seven_day', resetsAt: NOW + 3 * HOUR, at: NOW }, { ...s, weekly: false }, NOW)).toBe(false)
    expect(shouldWait({ kind: 'five_hour', at: NOW }, { ...s, enabled: false }, NOW)).toBe(false)
  })
})

const item = (id: string, chatId = id, source: QueueItem['source'] = 'paused'): QueueItem => ({ id, chatId, source, addedAt: NOW })

describe('ordering Up next', () => {
  it('slots a paused chat in by project priority, else at the end', () => {
    const q = [item('a'), item('b'), item('c')]
    const proj: Record<string, string> = { a: 'p1', b: 'p2', c: 'p3' }
    const s = { order: 'project' as const, projectOrder: ['p1', 'p2', 'p3'] }
    expect(insertIndex(q, (c) => proj[c], 'p1', s)).toBe(1)
    expect(insertIndex(q, (c) => proj[c], 'p2', s)).toBe(2)
    expect(insertIndex(q, (c) => proj[c], 'other', s)).toBe(3)
    expect(insertIndex(q, (c) => proj[c], 'p1', { ...s, order: 'time' })).toBe(3)
  })
  it('moves items', () => {
    const q = [item('a'), item('b'), item('c')]
    expect(moveItem(q, 'c', 0).map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(moveItem(q, 'a', 99).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })
  it('starts up to the free slots, one per chat, and none past the stop threshold', () => {
    const q = [item('a'), item('b', 'x'), item('c', 'x'), item('d')]
    const s = { maxConcurrent: 2, stopAtPercent: 60 }
    expect(pickToStart(q, () => false, 0, s, 5).map((x) => x.id)).toEqual(['a', 'b'])
    expect(pickToStart(q, (c) => c === 'a', 0, s, 5).map((x) => x.id)).toEqual(['b', 'd'])
    expect(pickToStart(q, () => false, 1, s, 5).map((x) => x.id)).toEqual(['a'])
    expect(pickToStart(q, () => false, 0, s, 60)).toEqual([])
    expect(pickToStart(q, () => false, 0, s, undefined).length).toBe(2)
  })
  it('clamps settings', () => {
    const s = continueSettings({ maxConcurrent: 99, stopAtPercent: 5, prompt: '  ' })
    expect(s.maxConcurrent).toBe(5)
    expect(s.stopAtPercent).toBe(20)
    expect(s.prompt).toMatch(/usage limit/)
  })
  it('reads sidebar rows dropped on Up next', () => {
    expect(parseQueueTarget(JSON.stringify({ kind: 'ws', wsId: 'w1' }))).toEqual({ kind: 'ws', wsId: 'w1' })
    expect(parseQueueTarget(JSON.stringify({ kind: 'thread', chatId: 'c1' }))).toEqual({ kind: 'thread', chatId: 'c1' })
    expect(parseQueueTarget(JSON.stringify({ kind: 'project', groupId: 'g1', extra: 1 }))).toEqual({ kind: 'project', groupId: 'g1' })
    expect(parseQueueTarget(JSON.stringify({ kind: 'ws' }))).toBeNull()
    expect(parseQueueTarget('not json')).toBeNull()
  })
  it('formats countdowns', () => {
    expect(untilText(NOW + 83 * 60_000, NOW)).toBe('in 1h 23m')
    expect(untilText(NOW + 4 * 60_000, NOW)).toBe('in 4m')
    expect(untilText(NOW, NOW)).toBe('now')
  })
})

describe('the scheduler', () => {
  let sent: { chatId: string; text: string }[]
  let runningIds: Set<string>
  let five: { percent: number; resetsAt?: number }
  let resets: number

  const chat = (id: string): Chat => ({ id, workspaceId: `ws-${id}`, title: id, model: 'opus', effort: 'high', status: 'idle', createdAt: NOW })
  const limits = (): SubscriptionLimits => ({ provider: 'claude', name: 'Claude', windows: [{ key: 'claude:five_hour', label: '5h', ...five }], updatedAt: Date.now() })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    cw._reset()
    const s = store.get()
    s.chats = ['a', 'b', 'c'].map(chat)
    s.continueQueue = []
    s.usageLimit = undefined
    s.resetLog = []
    s.settings.continueWork = undefined
    sent = []
    runningIds = new Set()
    five = { percent: 100, resetsAt: NOW + HOUR }
    resets = 0
    cw.init({
      send: (c, text) => {
        // The agent clears the pause when the turn starts.
        c.paused = undefined
        sent.push({ chatId: c.id, text })
        runningIds.add(c.id)
      },
      isRunning: (id) => runningIds.has(id),
      limits: async () => limits(),
      projectOf: () => undefined,
      notify: () => {},
      keepAwake: () => {},
      onReset: () => resets++,
      changed: () => {}
    })
  })

  const pause = async (id: string, resetsAt = NOW + HOUR) => {
    const c = store.get().chats.find((x) => x.id === id)!
    c.paused = { kind: 'five_hour', resetsAt, at: Date.now() }
    cw.onTurnDone(c)
    await vi.advanceTimersByTimeAsync(0)
  }

  it('queues paused chats and waits for the reset', async () => {
    await pause('a')
    await pause('b')
    expect(store.get().continueQueue!.map((q) => q.chatId)).toEqual(['a', 'b'])
    expect(store.get().usageLimit?.until).toBe(NOW + HOUR)
    await cw.tick()
    expect(sent).toEqual([])
  })

  it('a message typed while limited waits in the queue', async () => {
    await pause('a')
    const { position } = cw.add('c', 'Write the tests')
    expect(position).toBe(2)
    await cw.tick()
    expect(sent).toEqual([])
  })

  it('a dragged-in chat with no prompt continues where it left off', async () => {
    await pause('a')
    const { item } = cw.add('c', '  ')
    expect(item.prompt).toMatch(/where you left off/)
    expect(item.source).toBe('queued')
    five = { percent: 0, resetsAt: NOW + 6 * HOUR }
    vi.setSystemTime(NOW + HOUR + 61_000)
    await cw.tick()
    expect(sent.find((x) => x.chatId === 'c')?.text).toMatch(/keep going/)
  })

  it('after the reset, starts two at a time, then the next when one finishes', async () => {
    await pause('a')
    await pause('b')
    cw.add('c', 'Write the tests')
    five = { percent: 0, resetsAt: NOW + 6 * HOUR }
    vi.setSystemTime(NOW + HOUR + 61_000)
    await cw.tick()
    expect(sent.map((x) => x.chatId)).toEqual(['a', 'b'])
    expect(sent[0].text).toMatch(/usage limit/)
    expect(store.get().usageLimit).toBeUndefined()
    expect(store.get().resetLog!.at(-1)).toMatchObject({ started: 2, held: 0 })
    expect(resets).toBe(1)
    runningIds.delete('a')
    cw.onTurnDone(store.get().chats.find((x) => x.id === 'a')!)
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.map((x) => x.chatId)).toEqual(['a', 'b', 'c'])
    expect(sent[2].text).toBe('Write the tests')
    expect(store.get().continueQueue).toEqual([])
  })

  it('does not resume while /usage still reads full after the reset time', async () => {
    await pause('a')
    five = { percent: 100, resetsAt: NOW + 2 * HOUR }
    vi.setSystemTime(NOW + HOUR + 61_000)
    await cw.tick()
    expect(sent).toEqual([])
    expect(store.get().usageLimit?.until).toBe(NOW + 2 * HOUR)
  })

  it('holds the rest once the new window passes the stop threshold', async () => {
    await pause('a')
    await pause('b')
    five = { percent: 65, resetsAt: NOW + 6 * HOUR }
    vi.setSystemTime(NOW + HOUR + 61_000)
    await cw.tick()
    expect(sent).toEqual([])
    expect(store.get().resetLog!.at(-1)).toMatchObject({ started: 0, held: 2 })
  })

  it('runs an item now on request, and stops re-queuing a chat that keeps hitting the limit', async () => {
    await pause('a')
    cw.runNow(store.get().continueQueue![0].id)
    expect(sent.map((x) => x.chatId)).toEqual(['a'])
    const c = store.get().chats.find((x) => x.id === 'a')!
    runningIds.delete('a')
    c.paused = { kind: 'five_hour', resetsAt: NOW + HOUR, at: NOW, retries: 3 }
    cw.onTurnDone(c)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.get().continueQueue).toEqual([])
  })
})
