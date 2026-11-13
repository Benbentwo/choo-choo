import { describe, expect, it } from 'vitest'
import { busyLine, chatsToResume, interruptNote, waitingLine } from '../src/shared/restart'
import type { Chat, Workspace } from '../src/shared/types'

const chat = (id: string, ws: string, extra: Partial<Chat> = {}): Chat =>
  ({ id, workspaceId: ws, title: id, model: 'opus', effort: 'high', status: 'idle', createdAt: 0, ...extra }) as Chat
const ws = (id: string, extra: Partial<Workspace> = {}): Workspace => ({ id, path: `/work/${id}`, ...extra }) as Workspace

describe('chatsToResume', () => {
  const cut = { reason: 'update' as const, at: 1 }
  it('picks interrupted chats whose workspace is still there', () => {
    const chats = [
      chat('a', 'w1', { interrupted: cut }),
      chat('b', 'w1'),
      chat('c', 'w2', { interrupted: cut }),
      chat('d', 'w3', { interrupted: cut }),
      chat('e', 'gone', { interrupted: cut }),
      chat('f', 'w1', { interrupted: cut, remote: { kind: 'phone', startedAt: 0 } })
    ]
    const workspaces = [ws('w1'), ws('w2', { archived: true }), ws('w3')]
    const exists = (p: string) => p !== '/work/w3'
    expect(chatsToResume(chats, workspaces, exists).map((c) => c.id)).toEqual(['a'])
  })
})

describe('restart copy', () => {
  it('says what is waiting', () => {
    expect(waitingLine(1)).toBe('Restarts when the running chat finishes.')
    expect(waitingLine(3)).toBe('Restarts when 3 running chats finish.')
    expect(waitingLine(0)).toBe('Restarting…')
    expect(busyLine(1)).toContain('1 chat is running')
    expect(busyLine(2)).toContain('2 chats are running')
  })
  it('explains a turn that was cut off', () => {
    expect(interruptNote('update')).toContain('restarted to update')
    expect(interruptNote('crash')).toContain('closed unexpectedly')
  })
})
