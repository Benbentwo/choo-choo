import { describe, it, expect } from 'vitest'
import { moveId, sortWorkspaces } from '../src/shared/sidebarOrder'
import { namingContext } from '../src/main/naming'
import type { ChatItem } from '../src/shared/types'

const ws = (title: string, createdAt: number, order?: number) => ({ id: title, title, createdAt, order })

describe('sortWorkspaces', () => {
  const list = [ws('b', 1, 1), ws('a', 2, 0), ws('new', 5), ws('newer', 9)]
  it('puts never-placed workspaces on top, newest first, then the dragged order', () => {
    expect(sortWorkspaces(list, 'manual').map((w) => w.title)).toEqual(['newer', 'new', 'a', 'b'])
  })
  it('keeps the other sorts', () => {
    expect(sortWorkspaces(list, 'newest').map((w) => w.title)).toEqual(['newer', 'new', 'a', 'b'])
    expect(sortWorkspaces(list, 'oldest').map((w) => w.title)).toEqual(['b', 'a', 'new', 'newer'])
    expect(sortWorkspaces(list, 'name').map((w) => w.title)).toEqual(['a', 'b', 'new', 'newer'])
  })
})

describe('moveId', () => {
  it('moves before or after the target', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b'])
    expect(moveId(['a', 'b', 'c'], 'a', 'b', true)).toEqual(['b', 'a', 'c'])
  })
  it('leaves the list alone for a drop on itself or an id from elsewhere', () => {
    const ids = ['a', 'b']
    expect(moveId(ids, 'a', 'a', true)).toBe(ids)
    expect(moveId(ids, 'x', 'a', true)).toBe(ids)
  })
})

describe('namingContext', () => {
  const items: ChatItem[] = [
    { id: '1', kind: 'user', text: 'Fix the login page', ts: 1 },
    { id: '2', kind: 'tool', name: 'Bash', input: 'ls', ts: 2 },
    { id: '3', kind: 'assistant', text: 'Fixed it.', ts: 3 },
    { id: '4', kind: 'user', text: 'advisor says hi', fromAdvisor: true, ts: 4 }
  ]
  it('keeps the conversation and drops tool calls and advisor messages', () => {
    expect(namingContext([items])).toBe('USER: Fix the login page\nASSISTANT: Fixed it.')
  })
  it('keeps the most recent part when long', () => {
    const long: ChatItem[] = [{ id: '1', kind: 'user', text: 'old '.repeat(100), ts: 1 }, { id: '2', kind: 'user', text: 'recent', ts: 2 }]
    expect(namingContext([long], 20).endsWith('USER: recent')).toBe(true)
  })
})
