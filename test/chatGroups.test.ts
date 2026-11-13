import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../src/shared/types'
import { groupWork } from '../src/renderer/src/chatGroups'

const user = (id: string): ChatItem => ({ id, kind: 'user', text: 'hi', ts: 0 }) as ChatItem
const text = (id: string): ChatItem => ({ id, kind: 'assistant', text: id, ts: 0 }) as ChatItem
const tool = (id: string, name = 'Bash'): ChatItem => ({ id, kind: 'tool', name, input: {}, result: 'ok', ts: 0 })
const result = (id: string): ChatItem => ({ id, kind: 'result', ok: true, ts: 0 }) as ChatItem

const shape = (items: ChatItem[]) => groupWork(items).map((e) => (e.kind === 'item' ? e.item.id : `[${e.items.map((i) => i.id).join(',')}]`))

describe('groupWork', () => {
  it('folds tool calls and the text between them into one row, keeping the answer out', () => {
    expect(shape([user('u'), text('a1'), tool('t1'), tool('t2'), text('a2'), tool('t3'), text('answer'), result('r')])).toEqual([
      'u',
      '[a1,t1,t2,a2,t3]',
      'answer',
      'r'
    ])
  })

  it('leaves a turn with no tool calls alone', () => {
    expect(shape([user('u'), text('a'), result('r')])).toEqual(['u', 'a', 'r'])
  })

  it('starts a new row after each message and result', () => {
    expect(shape([user('u1'), tool('t1'), result('r1'), user('u2'), tool('t2')])).toEqual(['u1', '[t1]', 'r1', 'u2', '[t2]'])
  })

  it('keeps plan approvals and routing in view, splitting the work around them', () => {
    expect(shape([user('u'), tool('t1'), tool('p', 'ExitPlanMode'), tool('t2'), text('a')])).toEqual(['u', '[t1]', 'p', '[t2]', 'a'])
  })

  it('counts only the work tool calls', () => {
    const [, work] = groupWork([user('u'), text('a'), tool('t1'), tool('t2')])
    expect(work.kind === 'work' && work.tools.map((t) => t.id)).toEqual(['t1', 't2'])
  })
})
