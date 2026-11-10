import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexLimits, parseCodexLimits } from '../src/main/limits'

const line = (ts: string, rl: unknown) => JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', rate_limits: rl } })

describe('Codex limits', () => {
  it('takes the newest snapshot that has windows, and names them', () => {
    const now = Date.now()
    const text = [
      line(new Date(now - 60_000).toISOString(), { primary: { used_percent: 10, window_minutes: 300, resets_at: 0 }, secondary: null, plan_type: 'pro' }),
      line(new Date(now - 30_000).toISOString(), { primary: { used_percent: 20, window_minutes: 300, resets_at: Math.round(now / 1000) + 3600 }, secondary: { used_percent: 58, window_minutes: 10080, resets_at: Math.round(now / 1000) + 86400 }, plan_type: 'pro' }),
      line(new Date(now).toISOString(), { primary: null, secondary: null, plan_type: 'pro' })
    ].join('\n')
    const r = parseCodexLimits(text)!
    expect(r.plan).toBe('pro')
    expect(r.windows.map((w) => [w.label, w.percent])).toEqual([
      ['5h', 20],
      ['Week', 58]
    ])
  })

  it('reads the newest rollout under the sessions folder and zeroes windows that already reset', () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-'))
    const d = join(root, '2026', '11', '10')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'rollout-a.jsonl'), line(new Date().toISOString(), { primary: { used_percent: 40, window_minutes: 300, resets_at: 1 }, secondary: null }))
    const r = codexLimits(root)!
    expect(r.provider).toBe('codex')
    expect(r.windows[0]).toMatchObject({ label: '5h', percent: 0 })
  })

  it('returns nothing when Codex has never run', () => {
    expect(codexLimits(join(mkdtempSync(join(tmpdir(), 'codex-none-')), 'sessions'))).toBeNull()
  })
})

describe('Codex hitting its limit', () => {
  it('reads when it frees up from the error message', async () => {
    const { parseRetryAt } = await import('../src/main/limits')
    const t = parseRetryAt('You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at Nov 16th, 2026 5:39 PM.')
    expect(new Date(t!).getFullYear()).toBe(2026)
    expect(new Date(t!).getDate()).toBe(16)
    expect(new Date(t!).getHours()).toBe(17)
  })

  it('marks the matching window full even when the last snapshot said 58%', () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-cap-'))
    const d = join(root, '2026', '11', '10')
    mkdirSync(d, { recursive: true })
    const now = Date.now()
    const until = new Date(now + 6 * 86400_000)
    const pretty = until.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    writeFileSync(
      join(d, 'rollout-b.jsonl'),
      [
        line(new Date(now - 2000).toISOString(), { primary: { used_percent: 58, window_minutes: 10080, resets_at: Math.round(until.getTime() / 1000) }, secondary: null, plan_type: 'pro' }),
        JSON.stringify({ timestamp: new Date(now - 1000).toISOString(), type: 'event_msg', payload: { type: 'task_complete', error: { message: `You’ve hit your usage limit. Try again at ${pretty}.`, codex_error_info: 'usage_limit_exceeded' } } })
      ].join('\n')
    )
    const r = codexLimits(root)!
    expect(r.capped).toBeTruthy()
    expect(r.windows[0]).toMatchObject({ label: 'Week', percent: 100 })
  })
})
