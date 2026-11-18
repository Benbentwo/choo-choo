import { describe, it, expect } from 'vitest'
import { DEFAULT_ROLE_MODELS, cleanRoleModels, pickFor } from '../src/shared/roleModels'

const settings = { defaultModel: 'opus' as const, defaultEffort: 'high' as const }

describe('models by role', () => {
  it('routes on Sonnet at low effort out of the box; threads and workspaces use the default', () => {
    expect(pickFor('router', settings)).toEqual({ model: 'sonnet', effort: 'low' })
    expect(pickFor('thread', settings)).toEqual({ model: 'opus', effort: 'high' })
    expect(pickFor('workspace', settings)).toEqual({ model: 'opus', effort: 'high' })
    expect(DEFAULT_ROLE_MODELS.router).toEqual({ model: 'sonnet', effort: 'low' })
  })
  it('lets Settings, then a project, override field by field', () => {
    const s = { ...settings, roleModels: { thread: { effort: 'medium' as const }, workspace: { model: 'fable' as const } } }
    expect(pickFor('router', s)).toEqual({ model: 'opus', effort: 'high' })
    expect(pickFor('thread', s)).toEqual({ model: 'opus', effort: 'medium' })
    const group = { models: { thread: { model: 'sonnet' as const }, workspace: { effort: 'max' as const } } }
    expect(pickFor('thread', s, group)).toEqual({ model: 'sonnet', effort: 'medium' })
    expect(pickFor('workspace', s, group)).toEqual({ model: 'fable', effort: 'max' })
  })
  it('never runs a project or thread chat on Codex', () => {
    const s = { defaultModel: 'codex' as const, defaultEffort: 'high' as const, roleModels: {} }
    expect(pickFor('thread', s).model).toBe('opus')
    expect(pickFor('workspace', s).model).toBe('codex')
  })
  it('keeps only known roles and values when saving', () => {
    const models = ['opus', 'sonnet'] as const
    const efforts = ['low', 'high'] as const
    expect(cleanRoleModels({ router: { model: 'sonnet', effort: 'turbo' }, thread: {}, nope: { model: 'opus' }, workspace: { effort: 'high' } }, models, efforts)).toEqual({ router: { model: 'sonnet' }, workspace: { effort: 'high' } })
    expect(cleanRoleModels(null, models, efforts)).toEqual({})
  })
})
