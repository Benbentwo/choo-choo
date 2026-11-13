import { describe, expect, it, vi } from 'vitest'
import { editMenuItems, MAX_SUGGESTIONS, type EditMenuParams } from '../src/shared/editMenu'

const flags = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
const base: EditMenuParams = { isEditable: true, misspelledWord: '', dictionarySuggestions: [], selectionText: '', editFlags: flags }
const actions = () => ({ replace: vi.fn(), learn: vi.fn() })

describe('editMenuItems', () => {
  it('shows nothing outside text fields', () => {
    expect(editMenuItems({ ...base, isEditable: false, misspelledWord: 'teh' }, actions())).toEqual([])
  })

  it('shows only edit items for a correctly spelled field', () => {
    const items = editMenuItems(base, actions())
    expect(items.map((i) => i.role ?? i.type)).toEqual(['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'selectAll'])
    expect(items.find((i) => i.role === 'redo')?.enabled).toBe(false)
    expect(items.some((i) => i.label === 'Learn Spelling')).toBe(false)
  })

  it('puts suggestions and Learn Spelling first for a misspelled word', () => {
    const a = actions()
    const items = editMenuItems({ ...base, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten', 'the'] }, a)
    expect(items.slice(0, 5).map((i) => i.label ?? i.type)).toEqual(['the', 'ten', 'separator', 'Learn Spelling', 'separator'])
    items[0].click?.()
    expect(a.replace).toHaveBeenCalledWith('the')
    items[3].click?.()
    expect(a.learn).toHaveBeenCalledWith('teh')
    expect(items.at(-1)?.role).toBe('selectAll')
  })

  it('caps suggestions', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const items = editMenuItems({ ...base, misspelledWord: 'x', dictionarySuggestions: many }, actions())
    expect(items.indexOf(items.find((i) => i.type === 'separator')!)).toBe(MAX_SUGGESTIONS)
  })

  it('says when there are no guesses but still offers Learn Spelling', () => {
    const items = editMenuItems({ ...base, misspelledWord: 'choochoo' }, actions())
    expect(items[0]).toEqual({ label: 'No Guesses Found', enabled: false })
    expect(items[2].label).toBe('Learn Spelling')
  })
})
