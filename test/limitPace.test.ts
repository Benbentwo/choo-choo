import { describe, it, expect } from 'vitest'
import { pace, paceText } from '../src/shared/limitPace'
import type { LimitWindow } from '../src/shared/types'

const H = 3600_000
const now = Date.UTC(2026, 10, 10, 12)
const win = (percent: number, history: { t: number; p: number }[] = []): LimitWindow => ({ key: 'k', label: '5h', percent, resetsAt: now + 2.5 * H, windowMs: 5 * H, history })

describe('pace', () => {
  it('is on track when usage is below an even spread', () => {
    const p = pace(win(30), now)!
    expect(p.expected).toBeCloseTo(50)
    expect(p.status).toBe('on-track')
    expect(paceText(win(30), p, now)).toMatch(/^On track/)
  })
  it('flags a rate that hits the cap before reset', () => {
    // 60% in the last hour of readings: 1%/minute, so the remaining 20% goes in 20 minutes.
    const w = win(80, [
      { t: now - H, p: 20 },
      { t: now, p: 80 }
    ])
    const p = pace(w, now)!
    expect(p.status).toBe('ahead')
    expect(p.hitsCapAt).toBe(now + 20 * 60_000)
    expect(paceText(w, p, now)).toMatch(/^Ahead of pace/)
  })
  it('needs a reset time and window length', () => {
    expect(pace({ key: 'k', label: 'x', percent: 5 }, now)).toBeNull()
  })
})
