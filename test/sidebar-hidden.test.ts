import { describe, expect, it } from 'vitest'
import { orchestratorRowKey, parseRowKey, toggleHidden, viewRowKey } from '../src/shared/sidebarHidden'

describe('sidebar hidden rows', () => {
  it('builds and parses keys', () => {
    expect(parseRowKey(orchestratorRowKey('r1'))).toEqual({
      key: 'orchestrator:r1',
      kind: 'orchestrator',
      repoId: 'r1'
    })
    const k = viewRowKey('plan-board@choo-choo-addons', 'plans', 'r1')
    expect(parseRowKey(k)).toEqual({
      key: k,
      kind: 'view',
      repoId: 'r1',
      addonKey: 'plan-board@choo-choo-addons',
      viewId: 'plans'
    })
    const app = viewRowKey('a@m', 'home')
    expect(app).toBe('view::a@m/home')
    expect(parseRowKey(app)).toEqual({
      key: app,
      kind: 'view',
      repoId: undefined,
      addonKey: 'a@m',
      viewId: 'home'
    })
    expect(parseRowKey('junk')).toBeNull()
    expect(parseRowKey('orchestrator:')).toBeNull()
  })

  it('toggles without duplicates', () => {
    const a = toggleHidden(undefined, 'x', true)
    expect(a).toEqual(['x'])
    expect(toggleHidden(a, 'x', true)).toBe(a)
    expect(toggleHidden(a, 'x', false)).toEqual([])
    expect(toggleHidden(a, 'y', false)).toBe(a)
  })
})
