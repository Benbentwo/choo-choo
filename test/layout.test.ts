import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  boxes,
  closeLeaf,
  dragDivider,
  dropView,
  focusedLeaf,
  groupOf,
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
