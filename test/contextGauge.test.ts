import { describe, expect, it } from 'vitest'
import { contextGauge, contextGaugeTitle } from '../src/shared/contextGauge'

const ctx = (used: number, compactions = 0, contextWindow = 200_000) => ({ used, contextWindow, compactions })

describe('contextGauge', () => {
  it('is null with nothing to show', () => {
    expect(contextGauge(null)).toBeNull()
    expect(contextGauge(ctx(10, 0, 0))).toBeNull()
  })

  it('matches the sidebar bar thresholds and caps at 100%', () => {
    expect(contextGauge(ctx(100_000))).toMatchObject({ percent: 50, level: 'ok' })
    expect(contextGauge(ctx(138_000))?.level).toBe('ok')
    expect(contextGauge(ctx(140_000))?.level).toBe('warn')
    expect(contextGauge(ctx(180_000))?.level).toBe('full')
    expect(contextGauge(ctx(250_000))?.percent).toBe(100)
  })

  it('says what it measures, what is left and how often it compacted', () => {
    const t = contextGaugeTitle(contextGauge(ctx(150_000, 2))!)
    expect(t).toContain('150k of 200k (75% used, 25% left)')
    expect(t).toContain('Compacted 2 times')
    expect(t).toContain('This chat only')
  })
})
