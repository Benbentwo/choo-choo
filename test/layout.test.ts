import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  boxes,
  closeDoc,
  closeDocs,
  docTarget,
  docsRightOf,
  focusGroupIn,
  moveDoc,
  openDoc,
  closeLeaf,
  docTabs,
  dragDivider,
  dropView,
  focusedLeaf,
  groupOf,
  hasDocs,
  isLayout,
  isSplit,
  layoutLabel,
  leafOfWorkspace,
  leaves,
  leavesOf,
  mergeGroups,
  moveLeaf,
  moveTab,
  neighbor,
  openBeside,
  prune,
  show,
  showDoc,
  splitFocused,
  syncWorkspace,
  workspaceView,
  type Layout,
  type PaneView
} from '../src/shared/layout'

const ws = (id: string, chats = [`${id}-c1`]) => workspaceView(id, chats)
const addon: PaneView = { kind: 'addon', key: 'plan-board@m', viewId: 'plans', repoId: 'r1' }
const wsIds = (l: Layout) => leaves(l).map((x) => (x.view.kind === 'workspace' ? x.view.wsId : x.view.kind))

describe('split panels layout', () => {
  it('opens in the focused pane, or beside it', () => {
    let l = show(null, ws('a'))
    expect(wsIds(l)).toEqual(['a'])
    l = show(l, ws('b'))
    expect(wsIds(l)).toEqual(['b'])
    l = show(l, ws('a'), 'right')
    expect(wsIds(l)).toEqual(['b', 'a'])
    expect(focusedLeaf(l).view).toMatchObject({ wsId: 'a' })
    expect(layoutLabel(l)).toBe('Side by side')
  })

  it('shows a workspace in at most one pane', () => {
    let l = show(null, ws('a'))
    l = show(l, ws('b'), 'right')
    const before = leaves(l).length
    l = show(l, ws('a'))
    expect(leaves(l).length).toBe(before)
    expect(focusedLeaf(l).view).toMatchObject({ wsId: 'a' })
  })

  it('merges same-direction splits and closes panes back down', () => {
    let l = show(null, ws('a'))
    l = show(l, ws('b'), 'right')
    l = show(l, ws('c'), 'right')
    expect(isSplit(l.root) && l.root.children.length).toBe(3)
    expect(isSplit(l.root) && l.root.sizes.reduce((x, y) => x + y)).toBeCloseTo(1)
    l = closeLeaf(l, leafOfWorkspace(l, 'b')!.id)!
    expect(wsIds(l)).toEqual(['a', 'c'])
    l = closeLeaf(l, leafOfWorkspace(l, 'c')!.id)!
    expect(l.root.kind).toBe('leaf')
    expect(closeLeaf(l, l.root.id)).toBeNull()
  })

  it('splits down into a column inside a row', () => {
    let l = show(null, ws('a'))
    l = show(l, ws('b'), 'right')
    l = splitFocused(l, 'bottom')
    expect(focusedLeaf(l).view.kind).toBe('empty')
    const { leaves: b } = boxes(l.root)
    const empty = b.get(l.focus)!
    expect(empty).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
    expect(neighbor(l, 'top')).toBe(leafOfWorkspace(l, 'b')!.id)
    expect(neighbor(l, 'left')).toBe(leafOfWorkspace(l, 'a')!.id)
  })

  it('drops a workspace on an edge, swaps panes dropped in the middle', () => {
    let l = show(null, ws('a'))
    const target = l.focus
    l = dropView(l, ws('b'), target, 'left')
    expect(wsIds(l)).toEqual(['b', 'a'])
    l = moveLeaf(l, leafOfWorkspace(l, 'b')!.id, leafOfWorkspace(l, 'a')!.id)
    expect(wsIds(l)).toEqual(['a', 'b'])
    // Dropping a workspace that's already open moves its pane.
    l = dropView(l, ws('a'), leafOfWorkspace(l, 'b')!.id, 'bottom')
    expect(l.root.kind).toBe('split')
    expect(isSplit(l.root) && l.root.dir).toBe('col')
  })

  it('stacks workspaces opened beside an add-on page', () => {
    let l = show(null, addon)
    const page = l.focus
    l = openBeside(l, page, ws('a'))
    l = openBeside(l, page, ws('b'))
    l = openBeside(l, page, ws('c'))
    expect(wsIds(l)).toEqual(['addon', 'a', 'b', 'c'])
    l = openBeside(l, page, ws('d'))
    expect(wsIds(l)).toEqual(['addon', 'a', 'b', 'd'])
    // Already open: just focus it.
    l = openBeside(l, page, ws('a'))
    expect(focusedLeaf(l).view).toMatchObject({ wsId: 'a' })
    const { leaves: b } = boxes(l.root)
    expect(b.get(page)).toMatchObject({ x: 0, w: 0.5, h: 1 })
  })

  it('keeps divider drags inside bounds', () => {
    expect(dragDivider([0.5, 0.5], 0, 0.2)).toEqual([0.7, 0.30000000000000004])
    expect(dragDivider([0.5, 0.5], 0, -0.9)[0]).toBeCloseTo(0.08)
  })

  it('moves chats between groups and splits them out', () => {
    const v = ws('a', ['c1', 'c2', 'c3'])
    const g = v.focusGroup
    let r = moveTab(v.inner, 'c2', g, 'right')
    expect(leavesOf(r.inner).map((x) => x.chats)).toEqual([['c1', 'c3'], ['c2']])
    r = moveTab(r.inner, 'c3', r.group)
    expect(leavesOf(r.inner).map((x) => x.chats)).toEqual([['c1'], ['c2', 'c3']])
    expect(groupOf(r.inner, 'c3')!.active).toBe('c3')
    // Moving the last chat out of a group closes the group.
    r = moveTab(r.inner, 'c1', r.group)
    expect(leavesOf(r.inner).map((x) => x.chats)).toEqual([['c2', 'c3', 'c1']])
    // Splitting a group's only tab beside itself changes nothing.
    const one = ws('b', ['x'])
    expect(moveTab(one.inner, 'x', one.focusGroup, 'right').inner).toBe(one.inner)
  })

  it('merges groups back into one', () => {
    const v = ws('a', ['c1', 'c2'])
    const r = moveTab(v.inner, 'c2', v.focusGroup, 'bottom')
    expect(mergeGroups(r.inner).chats).toEqual(['c1', 'c2'])
  })

  it('keeps panes in step with chats', () => {
    let v = ws('a', ['c1', 'c2'])
    v = { ...v, inner: moveTab(v.inner, 'c2', v.focusGroup, 'right').inner }
    // c2 closed, c3 opened: c2's group goes away and c3 joins the focused group.
    const s = syncWorkspace(v, ['c1', 'c3'])
    expect(leavesOf(s.inner).map((x) => x.chats)).toEqual([['c1', 'c3']])
    expect(syncWorkspace(s, ['c1', 'c3'])).toBe(s)
  })

  it('prunes archived workspaces and broken saves', () => {
    let l = show(null, ws('a'))
    l = show(l, ws('b'), 'right')
    const p = prune(l, { workspaces: new Set(['a']), chatsOf: (id) => [`${id}-c1`] })!
    expect(wsIds(p)).toEqual(['a'])
    expect(prune(l, { workspaces: new Set(), chatsOf: () => [] })).toBeNull()
    expect(isLayout(l)).toBe(true)
    expect(isLayout({ root: { kind: 'leaf', id: 'x', view: { kind: 'workspace', wsId: 'a' } }, focus: 'x' })).toBe(false)
    expect(isLayout(null)).toBe(false)
  })

  it('applies presets around the focused pane', () => {
    let l = show(null, ws('a'))
    l = applyPreset(l, 'columns-3')
    expect(wsIds(l)).toEqual(['a', 'empty', 'empty'])
    l = applyPreset(l, 'single')
    expect(wsIds(l)).toEqual(['a'])
  })
})

describe('file tabs in a group', () => {
  const diff = (path: string, line?: number) => ({ kind: 'diff' as const, path, ...(line ? { line } : {}) })
  const group = () => leavesOf(workspaceView('w', ['c1']).inner)[0]

  it('keeps diff and file tabs open when going back to the chat', () => {
    let g = showDoc(group(), diff('a.ts'))
    g = showDoc(g, { kind: 'file', path: 'b.ts' })
    g = showDoc(g, null)
    expect(g.doc).toBeNull()
    expect(docTabs(g).map((d) => d.path)).toEqual(['a.ts', 'b.ts'])
    g = showDoc(g, diff('a.ts'))
    expect(g.doc).toEqual(diff('a.ts'))
    expect(docTabs(g)).toHaveLength(2)
  })

  it('reopening a tab reuses it and takes the new line', () => {
    let g = showDoc(group(), diff('a.ts'))
    g = showDoc(g, diff('a.ts', 12))
    expect(docTabs(g)).toEqual([diff('a.ts', 12)])
  })

  it('closing the shown tab shows its neighbor, then the chat', () => {
    let g = showDoc(showDoc(showDoc(group(), diff('a')), diff('b')), diff('c'))
    g = showDoc(g, diff('b'))
    g = closeDoc(g, diff('b'))
    expect(g.doc?.path).toBe('c')
    g = closeDoc(g, diff('a'))
    expect(g.doc?.path).toBe('c')
    g = closeDoc(g, diff('c'))
    expect(g.doc).toBeNull()
    expect(hasDocs(g)).toBe(false)
  })

  it('a group with only background file tabs is not dropped, and older saves without docs still load', () => {
    const g = showDoc(showDoc(group(), diff('a')), null)
    expect(hasDocs({ ...g, chats: [] })).toBe(true)
    const old = { ...group(), doc: diff('x') }
    delete (old as { docs?: unknown }).docs
    expect(docTabs(old)).toEqual([diff('x')])
    expect(isLayout({ root: { kind: 'leaf', id: 'p', view: { ...workspaceView('w', ['c1']), inner: old } }, focus: 'p', maximized: null })).toBe(true)
  })

  it('merging groups keeps every open tab once', () => {
    const v = workspaceView('w', ['c1', 'c2'])
    const g1 = showDoc(leavesOf(v.inner)[0], diff('a'))
    const { inner } = moveTab(g1, 'c2', g1.id, 'right')
    const groups = leavesOf(inner)
    const withB = { ...inner, children: (inner as any).children.map((c: any) => (c.id === groups[1].id ? showDoc(c, diff('b')) : c)) }
    expect(docTabs(mergeGroups(withB)).map((d) => d.path)).toEqual(['a', 'b'])
  })
})

describe('where files open, and moving and closing their tabs', () => {
  const diff = (path: string) => ({ kind: 'diff' as const, path })
  const wsView = (v: ReturnType<typeof workspaceView>) => v
  /** A chat group on the left and a group showing `a` on the right, with the chat focused. */
  const sideBySide = () => {
    const v = workspaceView('w', ['c1'])
    const chat = leavesOf(v.inner)[0]
    const opened = openDoc(v, diff('a'))
    const { inner, group } = moveDoc(opened.inner, chat.id, diff('a'), chat.id, 'right')
    return { view: wsView({ ...opened, inner, focusGroup: chat.id, docGroup: group }), chat: chat.id, files: group }
  }
  const groupIn = (v: ReturnType<typeof workspaceView>, id: string) => leavesOf(v.inner).find((g) => g.id === id)!

  it('opens in the only group when nothing is split', () => {
    const v = openDoc(workspaceView('w', ['c1']), diff('a'))
    expect(leavesOf(v.inner)).toHaveLength(1)
    expect(leavesOf(v.inner)[0].doc).toEqual(diff('a'))
  })

  it('opens on the file side even when the chat side was clicked last', () => {
    const { view, chat, files } = sideBySide()
    expect(view.focusGroup).toBe(chat)
    const v = openDoc(view, diff('b'))
    expect(groupIn(v, files).doc).toEqual(diff('b'))
    expect(docTabs(groupIn(v, files)).map((d) => d.path)).toEqual(['a', 'b'])
    expect(groupIn(v, chat).doc).toBeNull()
    expect(v.focusGroup).toBe(files)
  })

  it('follows the file group clicked last when there are several', () => {
    const { view, files } = sideBySide()
    const two = moveDoc(openDoc(view, diff('b')).inner, files, diff('b'), files, 'bottom')
    let v = wsView({ ...view, inner: two.inner, docGroup: two.group })
    expect(groupIn(openDoc(v, diff('c')), two.group).doc).toEqual(diff('c'))
    v = focusGroupIn(v, files)
    expect(groupIn(openDoc(v, diff('c')), files).doc).toEqual(diff('c'))
  })

  it('clicking a group that shows a chat does not change where files open', () => {
    const { view, chat, files } = sideBySide()
    const v = focusGroupIn(view, chat)
    expect(v.docGroup).toBe(files)
    expect(docTarget(v)).toBe(files)
  })

  it('falls back to the focused group when the file group is gone', () => {
    const v = workspaceView('w', ['c1'])
    expect(docTarget({ ...v, docGroup: 'gone' })).toBe(v.focusGroup)
  })

  it('Reflect and going back to the chat stay in the focused group', () => {
    const { view, chat, files } = sideBySide()
    const v = openDoc(view, { kind: 'reflect', path: 'Reflect' })
    expect(groupIn(v, chat).doc?.kind).toBe('reflect')
    expect(groupIn(v, files).doc).toEqual(diff('a'))
  })

  it('moves a file tab into another group and drops the group it emptied', () => {
    const { view, chat, files } = sideBySide()
    const { inner, group } = moveDoc(view.inner, files, diff('a'), chat)
    expect(group).toBe(chat)
    expect(leavesOf(inner)).toHaveLength(1)
    expect(leavesOf(inner)[0].doc).toEqual(diff('a'))
    expect(leavesOf(inner)[0].chats).toEqual(['c1'])
  })

  it("doesn't split a group's only tab beside itself, or move a tab onto its own group", () => {
    const { view, files } = sideBySide()
    expect(moveDoc(view.inner, files, diff('a'), files, 'right').inner).toBe(view.inner)
    expect(moveDoc(view.inner, files, diff('a'), files).inner).toBe(view.inner)
    expect(moveDoc(view.inner, files, diff('nope'), files, 'right').inner).toBe(view.inner)
  })

  it('closes others, to the right, and all', () => {
    const g = ['a', 'b', 'c', 'd'].reduce((x, p) => showDoc(x, diff(p)), leavesOf(workspaceView('w', ['c1']).inner)[0])
    expect(docsRightOf(g, diff('b')).map((d) => d.path)).toEqual(['c', 'd'])
    const right = closeDocs(g, docsRightOf(g, diff('b')))
    expect(docTabs(right).map((d) => d.path)).toEqual(['a', 'b'])
    expect(right.doc?.path).toBe('b')
    const others = closeDocs(g, docTabs(g).filter((d) => d.path !== 'c'))
    expect(docTabs(others).map((d) => d.path)).toEqual(['c'])
    expect(others.doc?.path).toBe('c')
    const none = closeDocs(g, docTabs(g))
    expect(hasDocs(none)).toBe(false)
    expect(none.chats).toEqual(['c1'])
  })
})
