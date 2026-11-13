import { describe, expect, it } from 'vitest'
import { CHAT_MIN, RIGHT, SIDEBAR, SNAP, dragTo, rightMax, rightWidth, sidebarWidth } from '../src/shared/panelWidths'

describe('panel widths', () => {
  it('defaults and clamps the sidebar', () => {
    expect(sidebarWidth(undefined)).toBe(SIDEBAR.def)
    expect(sidebarWidth(NaN)).toBe(SIDEBAR.def)
    expect(sidebarWidth(100)).toBe(SIDEBAR.min)
    expect(sidebarWidth(900)).toBe(SIDEBAR.max)
    expect(sidebarWidth(333.4)).toBe(333)
  })

  it('keeps room for the chat beside the right panel', () => {
    expect(rightMax(1440, 280)).toBe(1440 - 280 - CHAT_MIN)
    expect(rightWidth(5000, 1440, 280)).toBe(1440 - 280 - CHAT_MIN)
    expect(rightWidth(5000, 1440, 0)).toBe(1440 - CHAT_MIN)
    expect(rightWidth(undefined, 1440, 280)).toBe(RIGHT.def)
    expect(rightWidth(100, 1440, 280)).toBe(RIGHT.min)
  })

  it('never goes below the minimum in a narrow window', () => {
    expect(rightMax(600, 280)).toBe(RIGHT.min)
    expect(rightWidth(undefined, 600, 280)).toBe(RIGHT.min)
  })

  it('closes a panel dragged well past its minimum', () => {
    expect(dragTo(SIDEBAR.min - 10, SIDEBAR.min)).toBe(SIDEBAR.min - 10)
    expect(dragTo(SIDEBAR.min - SNAP - 1, SIDEBAR.min)).toBe('close')
  })
})
