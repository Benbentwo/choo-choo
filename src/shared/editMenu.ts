// Right-click menu for text fields (composer, inputs): spelling suggestions, Learn Spelling,
// then the usual edit items. Pure so it can be tested; main wires the actions to Electron.

export interface EditMenuParams {
  isEditable: boolean
  misspelledWord: string
  dictionarySuggestions: string[]
  selectionText: string
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

export interface EditMenuActions {
  replace(word: string): void
  learn(word: string): void
}

export interface EditMenuItem {
  label?: string
  type?: 'separator'
  role?: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'pasteAndMatchStyle' | 'selectAll'
  enabled?: boolean
  click?: () => void
}

/** Most suggestions shown at once, like macOS text fields. */
export const MAX_SUGGESTIONS = 5

export function editMenuItems(p: EditMenuParams, a: EditMenuActions): EditMenuItem[] {
  if (!p.isEditable) return []
  const items: EditMenuItem[] = []
  const word = p.misspelledWord.trim()
  if (word) {
    const suggestions = [...new Set(p.dictionarySuggestions)].filter((s) => s && s !== word).slice(0, MAX_SUGGESTIONS)
    if (suggestions.length) for (const s of suggestions) items.push({ label: s, click: () => a.replace(s) })
    else items.push({ label: 'No Guesses Found', enabled: false })
    items.push({ type: 'separator' }, { label: 'Learn Spelling', click: () => a.learn(word) }, { type: 'separator' })
  }
  const f = p.editFlags
  items.push(
    { role: 'undo', enabled: f.canUndo },
    { role: 'redo', enabled: f.canRedo },
    { type: 'separator' },
    { role: 'cut', enabled: f.canCut },
    { role: 'copy', enabled: f.canCopy },
    { role: 'paste', enabled: f.canPaste },
    { role: 'selectAll', enabled: f.canSelectAll }
  )
  return items
}
