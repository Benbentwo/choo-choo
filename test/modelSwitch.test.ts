import { describe, it, expect } from 'vitest'
import type { ChatItem } from '../src/shared/types'
import { onModelPicked, onModelReported } from '../src/shared/modelSwitch'

const user: ChatItem = { id: 'u1', kind: 'user', text: 'hi', ts: 1 }

describe('switched-to-model divider', () => {
  it('adds a divider when the person picks another model mid-chat', () => {
    expect(onModelPicked([user], 'opus', 'sonnet', 'm1', 2)).toEqual({ put: { id: 'm1', kind: 'model', model: 'sonnet', from: 'opus', ts: 2 } })
  })

  it('skips empty chats and picking the same model', () => {
    expect(onModelPicked([], 'opus', 'sonnet', 'm1', 2)).toBeNull()
    expect(onModelPicked([user], 'opus', 'opus', 'm1', 2)).toBeNull()
  })

  it('updates an unsent divider, and drops it when switching back', () => {
    const div: ChatItem = { id: 'm1', kind: 'model', model: 'sonnet', from: 'opus', ts: 2 }
    expect(onModelPicked([user, div], 'sonnet', 'haiku', 'm2', 3)).toEqual({ put: { ...div, model: 'haiku', ts: 3 } })
    expect(onModelPicked([user, div], 'sonnet', 'opus', 'm2', 3)).toEqual({ remove: 'm1' })
  })

  it('confirms the pending divider with the model Claude Code reports', () => {
    const div: ChatItem = { id: 'm1', kind: 'model', model: 'sonnet', from: 'opus', ts: 2 }
    expect(onModelReported([user, div], 'sonnet', 'claude-sonnet-5-5', 'claude-opus-5-5', 'm2', 3)).toEqual({ put: { ...div, resolved: 'claude-sonnet-5-5' } })
  })

  it('adds a confirmed divider when the reported model changes without a pick', () => {
    expect(onModelReported([user], 'opus', 'claude-opus-5-6', 'claude-opus-5-5', 'm2', 3)).toEqual({
      put: { id: 'm2', kind: 'model', model: 'opus', resolved: 'claude-opus-5-6', ts: 3 }
    })
    expect(onModelReported([user], 'opus', 'claude-opus-5-5', 'claude-opus-5-5', 'm2', 3)).toBeNull()
    expect(onModelReported([user], 'opus', 'claude-opus-5-5', undefined, 'm2', 3)).toBeNull()
  })
})
