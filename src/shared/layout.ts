/**
 * Split panels: how the center of the window is divided. Pure data and functions, no React, so the
 * renderer store and the tests share them. See docs/prd/split-panels.md.
 *
 * Two levels of the same kind of tree:
 * - The outer tree arranges panes. A pane shows a workspace, an add-on page, or nothing yet.
 * - A workspace pane has its own inner tree of groups. A group has chat and terminal tabs and can
 *   show a diff, file or Reflect in place of the chat, like the center did before splits.
 * Chats never leave their workspace's pane, because the agent runs in that worktree.
 */

export type Dir = 'row' | 'col'
export type Side = 'left' | 'right' | 'top' | 'bottom'

export interface Doc {
  /** reflect: the workspace's Reflect tab. */
  kind: 'diff' | 'file' | 'reflect'
  path: string
  /** Line to scroll to in a file. */
  line?: number
}

export interface Split<T> {
  kind: 'split'
  id: string
  dir: Dir
  /** Share of the parent for each child, adding up to 1. */
  sizes: number[]
  children: (T | Split<T>)[]
}

export interface Group {
  kind: 'group'
  id: string
  chats: string[]
  /** Terminal ids (pty ids) shown as tabs. */
  terms: string[]
  /** The selected chat or terminal tab. */
  active: string | null
  /** A diff, file or Reflect shown instead of the active tab. */
  doc: Doc | null
}
export type GNode = Group | Split<Group>

export type PaneView =
  | { kind: 'workspace'; wsId: string; inner: GNode; focusGroup: string }
  | { kind: 'addon'; key: string; viewId: string; repoId?: string }
  | { kind: 'empty' }

export interface Leaf {
  kind: 'leaf'
  id: string
  view: PaneView
  /** The add-on page pane this one was opened beside, so later opens stack under it. */
  besideOf?: string
}
export type LNode = Leaf | Split<Leaf>

export interface Layout {
  root: LNode
  /** The focused pane's id. */
  focus: string
  /** A pane shown alone until toggled back. */
  maximized?: string | null
}

export interface SavedLayout {
  name: string
  layout: Layout
}

type AnyNode = { kind: string; id: string }
type Tree<T extends AnyNode> = T | Split<T>

let seq = 0
export const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

// ---------- generic tree helpers ----------

export function isSplit<T extends AnyNode>(n: Tree<T>): n is Split<T> {
  return n.kind === 'split'
}

export function leavesOf<T extends AnyNode>(n: Tree<T>): T[] {
  return isSplit(n) ? n.children.flatMap((c) => leavesOf(c)) : [n]
}

export function findNode<T extends AnyNode>(n: Tree<T>, id: string): Tree<T> | null {
  if (n.id === id) return n
  if (!isSplit(n)) return null
  for (const c of n.children) {
    const f = findNode(c, id)
    if (f) return f
  }
  return null
}

/** Replaces the node with `id` by what `fn` returns. Returns the same tree when nothing changed. */
export function mapNode<T extends AnyNode>(n: Tree<T>, id: string, fn: (n: Tree<T>) => Tree<T>): Tree<T> {
  if (n.id === id) return fn(n)
  if (!isSplit(n)) return n
  let changed = false
  const children = n.children.map((c) => {
    const m = mapNode(c, id, fn)
    if (m !== c) changed = true
    return m
  })
  return changed ? { ...n, children } : n
}

/** Equal sizes that add up to 1. */
export const even = (k: number) => Array.from({ length: k }, () => 1 / k)

function normSizes(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0)
  return total > 0 ? sizes.map((s) => s / total) : even(sizes.length)
}

/** Drops empty splits, lifts single children and merges a split into a parent going the same way. */
export function tidy<T extends AnyNode>(n: Tree<T>): Tree<T> | null {
  if (!isSplit(n)) return n
  const kids: Tree<T>[] = []
  const sizes: number[] = []
  n.children.forEach((c, i) => {
    const t = tidy(c)
    if (!t) return
    const sz = n.sizes[i] ?? 1 / n.children.length
    if (isSplit(t) && t.dir === n.dir) {
      t.children.forEach((cc, j) => {
        kids.push(cc)
        sizes.push(sz * t.sizes[j])
      })
    } else {
      kids.push(t)
      sizes.push(sz)
    }
  })
  if (kids.length === 0) return null
  if (kids.length === 1) return kids[0]
  return { ...n, children: kids, sizes: normSizes(sizes) }
}

export function removeNode<T extends AnyNode>(n: Tree<T>, id: string): Tree<T> | null {
  if (n.id === id) return null
  if (!isSplit(n)) return n
  if (!findNode(n, id)) return n
  const children: Tree<T>[] = []
  const sizes: number[] = []
  n.children.forEach((c, i) => {
    const r = removeNode(c, id)
    if (r) {
      children.push(r)
      sizes.push(n.sizes[i])
    }
  })
  return tidy({ ...n, children, sizes: normSizes(sizes) })
}

const sideDir = (side: Side): Dir => (side === 'left' || side === 'right' ? 'row' : 'col')
const sideBefore = (side: Side) => side === 'left' || side === 'top'

/** Puts `node` next to the node with `targetId`, taking half of its space. */
export function insertBeside<T extends AnyNode>(root: Tree<T>, targetId: string, side: Side, node: Tree<T>): Tree<T> {
  const dir = sideDir(side)
  const before = sideBefore(side)
  const parent = parentOf(root, targetId)
  if (parent && parent.dir === dir) {
    const i = parent.children.findIndex((c) => c.id === targetId)
    const half = parent.sizes[i] / 2
    const children = [...parent.children]
    const sizes = [...parent.sizes]
    children.splice(before ? i : i + 1, 0, node)
    sizes.splice(i, 1, half, half)
    return mapNode(root, parent.id, () => ({ ...parent, children, sizes }))
  }
  return mapNode(root, targetId, (t) => ({ kind: 'split', id: newId('s'), dir, sizes: [0.5, 0.5], children: before ? [node, t] : [t, node] }) as Split<T>)
}

export function parentOf<T extends AnyNode>(n: Tree<T>, id: string): Split<T> | null {
  if (!isSplit(n)) return null
  for (const c of n.children) {
    if (c.id === id) return n
    const p = parentOf(c, id)
    if (p) return p
  }
  return null
}

export function setSizes<T extends AnyNode>(root: Tree<T>, splitId: string, sizes: number[]): Tree<T> {
  return mapNode(root, splitId, (n) => (isSplit(n) && n.sizes.length === sizes.length ? { ...n, sizes: normSizes(sizes) } : n))
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Divider {
  splitId: string
  /** The divider sits after child `index`. */
  index: number
  dir: Dir
  /** The split's own box, to turn pointer movement into sizes. */
  parent: Box
  /** Position along the split's axis, as a share of the whole area. */
  at: number
}

/** Where every leaf and divider goes, as shares of the whole area (0 to 1). */
export function boxes<T extends AnyNode>(n: Tree<T>, box: Box = { x: 0, y: 0, w: 1, h: 1 }, out: { leaves: Map<string, Box>; dividers: Divider[] } = { leaves: new Map(), dividers: [] }) {
  if (!isSplit(n)) {
    out.leaves.set(n.id, box)
    return out
  }
  let at = n.dir === 'row' ? box.x : box.y
  n.children.forEach((c, i) => {
    const len = (n.dir === 'row' ? box.w : box.h) * n.sizes[i]
    const b = n.dir === 'row' ? { x: at, y: box.y, w: len, h: box.h } : { x: box.x, y: at, w: box.w, h: len }
    boxes(c, b, out)
    at += len
    if (i < n.children.length - 1) out.dividers.push({ splitId: n.id, index: i, dir: n.dir, parent: box, at })
  })
  return out
}

/** Moves the divider after child `index` of a split by `delta` (share of the split), keeping each side at least `min`. */
export function dragDivider(sizes: number[], index: number, delta: number, min = 0.08): number[] {
  const next = [...sizes]
  const pair = next[index] + next[index + 1]
  const a = Math.min(pair - min, Math.max(min, next[index] + delta))
  next[index] = a
  next[index + 1] = pair - a
  return next
}

// ---------- groups (inside a workspace pane) ----------

export function newGroup(chats: string[] = [], active: string | null = chats[0] ?? null): Group {
  return { kind: 'group', id: newId('g'), chats, terms: [], active, doc: null }
}

export function groupOf(inner: GNode, tabId: string): Group | null {
  return leavesOf(inner).find((g) => g.chats.includes(tabId) || g.terms.includes(tabId)) ?? null
}

/**
 * Makes a workspace pane agree with the workspace's chats: every chat in exactly one group (new
 * ones join the focused group), closed chats gone, and empty groups dropped.
 */
export function syncWorkspace(view: Extract<PaneView, { kind: 'workspace' }>, chatIds: string[]): Extract<PaneView, { kind: 'workspace' }> {
  const live = new Set(chatIds)
  const seen = new Set<string>()
  let inner: GNode | null = view.inner
  let changed = false
  for (const g of leavesOf(view.inner)) {
    const chats = g.chats.filter((c) => live.has(c) && !seen.has(c))
    chats.forEach((c) => seen.add(c))
    if (chats.length !== g.chats.length) {
      changed = true
      const active = g.active && (chats.includes(g.active) || g.terms.includes(g.active)) ? g.active : (chats[0] ?? g.terms[0] ?? null)
      inner = mapNode(inner!, g.id, () => ({ ...g, chats, active }))
    }
  }
  const missing = chatIds.filter((c) => !seen.has(c))
  const groups = leavesOf(inner!)
  const focus = groups.find((g) => g.id === view.focusGroup) ?? groups[0]
  if (missing.length) {
    changed = true
    inner = mapNode(inner!, focus.id, (g) => {
      const gg = g as Group
      return { ...gg, chats: [...gg.chats, ...missing], active: gg.active ?? missing[0] }
    })
  }
  // A group with nothing left to show goes away, unless it's the only one.
  for (const g of leavesOf(inner!)) {
    if (g.chats.length || g.terms.length || g.doc) continue
    if (leavesOf(inner!).length <= 1) break
    changed = true
    inner = removeNode(inner!, g.id) ?? inner
  }
  if (!changed) return view
  const after = leavesOf(inner!)
  const focusGroup = after.some((g) => g.id === view.focusGroup) ? view.focusGroup : after[0].id
  return { ...view, inner: inner!, focusGroup }
}

/** Moves a chat or terminal tab into another group of the same workspace, or splits it out beside one. */
export function moveTab(inner: GNode, tabId: string, targetGroup: string, side?: Side): { inner: GNode; group: string } {
  const from = groupOf(inner, tabId)
  if (!from) return { inner, group: targetGroup }
  const isTerm = from.terms.includes(tabId)
  if (!side && from.id === targetGroup) return { inner, group: targetGroup }
  // Splitting the only tab of a group beside itself changes nothing.
  if (side && from.id === targetGroup && from.chats.length + from.terms.length === 1 && !from.doc) return { inner, group: targetGroup }
  const take = (g: Group): Group => {
    const chats = g.chats.filter((c) => c !== tabId)
    const terms = g.terms.filter((t) => t !== tabId)
    return { ...g, chats, terms, active: g.active === tabId ? (chats[0] ?? terms[0] ?? null) : g.active }
  }
  let next = mapNode(inner, from.id, (g) => take(g as Group))
  let dest: string
  if (side) {
    const g: Group = { ...newGroup(), chats: isTerm ? [] : [tabId], terms: isTerm ? [tabId] : [], active: tabId }
    next = insertBeside(next, targetGroup, side, g)
    dest = g.id
  } else {
    next = mapNode(next, targetGroup, (g) => {
      const gg = g as Group
      return { ...gg, chats: isTerm ? gg.chats : [...gg.chats, tabId], terms: isTerm ? [...gg.terms, tabId] : gg.terms, active: tabId, doc: null }
    })
    dest = targetGroup
  }
  // The group the tab left may now be empty.
  const left = findNode(next, from.id) as Group | null
  if (left && !left.chats.length && !left.terms.length && !left.doc) next = removeNode(next, from.id) ?? next
  return { inner: next, group: dest }
}

/** Puts every tab back into one group. */
export function mergeGroups(inner: GNode): Group {
  const groups = leavesOf(inner)
  const first = groups[0]
  return { ...first, chats: groups.flatMap((g) => g.chats), terms: groups.flatMap((g) => g.terms), doc: groups.find((g) => g.doc)?.doc ?? null }
}

// ---------- panes ----------

export function newLeaf(view: PaneView, besideOf?: string): Leaf {
  return { kind: 'leaf', id: newId('p'), view, ...(besideOf ? { besideOf } : {}) }
}

export function workspaceView(wsId: string, chats: string[], active?: string | null): Extract<PaneView, { kind: 'workspace' }> {
  const g = newGroup(chats, active && chats.includes(active) ? active : (chats[0] ?? null))
  return { kind: 'workspace', wsId, inner: g, focusGroup: g.id }
}

export function single(view: PaneView): Layout {
  const l = newLeaf(view)
  return { root: l, focus: l.id }
}

export const leaves = (layout: Layout) => leavesOf(layout.root)
export const focusedLeaf = (layout: Layout): Leaf => leaves(layout).find((l) => l.id === layout.focus) ?? leaves(layout)[0]

export function leafOfWorkspace(layout: Layout, wsId: string): Leaf | null {
  return leaves(layout).find((l) => l.view.kind === 'workspace' && l.view.wsId === wsId) ?? null
}

export function leafOfAddon(layout: Layout, key: string, viewId?: string, repoId?: string): Leaf | null {
  return (
    leaves(layout).find(
      (l) => l.view.kind === 'addon' && l.view.key === key && (viewId === undefined || l.view.viewId === viewId) && (repoId === undefined || (l.view.repoId ?? undefined) === repoId)
    ) ?? null
  )
}

export const sameView = (a: PaneView, b: PaneView) =>
  a.kind === 'workspace' && b.kind === 'workspace'
    ? a.wsId === b.wsId
    : a.kind === 'addon' && b.kind === 'addon'
      ? a.key === b.key && a.viewId === b.viewId && (a.repoId ?? '') === (b.repoId ?? '')
      : false

/** The pane already showing this workspace or page, if any. Each is shown in at most one pane. */
export function leafShowing(layout: Layout, view: PaneView): Leaf | null {
  return leaves(layout).find((l) => sameView(l.view, view)) ?? null
}

export function setLeafView(layout: Layout, leafId: string, view: PaneView): Layout {
  return { ...layout, root: mapNode(layout.root, leafId, (l) => ({ ...(l as Leaf), view, besideOf: undefined })) }
}

export function updateLeaf(layout: Layout, leafId: string, fn: (l: Leaf) => Leaf): Layout {
  return { ...layout, root: mapNode(layout.root, leafId, (l) => fn(l as Leaf)) }
}

/**
 * Shows a workspace or page. In the focused pane by default; with `side`, in a new pane beside the
 * focused one. If a pane already shows it, that pane is focused instead.
 */
export function show(layout: Layout | null, view: PaneView, side?: Side): Layout {
  if (!layout) return single(view)
  const there = leafShowing(layout, view)
  if (there) return { ...layout, focus: there.id, maximized: layout.maximized && layout.maximized !== there.id ? null : layout.maximized }
  const target = focusedLeaf(layout)
  if (side) {
    const l = newLeaf(view)
    return { root: insertBeside(layout.root, target.id, side, l), focus: l.id, maximized: null }
  }
  return { ...setLeafView(layout, target.id, view), focus: target.id }
}

/** Splits the focused pane: the new pane starts empty and asks what to show. */
export function splitFocused(layout: Layout, side: Side): Layout {
  const l = newLeaf({ kind: 'empty' })
  return { root: insertBeside(layout.root, focusedLeaf(layout).id, side, l), focus: l.id, maximized: null }
}

/** Closes a pane. Returns null when it was the last one. */
export function closeLeaf(layout: Layout, leafId: string): Layout | null {
  const all = leaves(layout)
  const i = all.findIndex((l) => l.id === leafId)
  const root = removeNode(layout.root, leafId)
  if (!root) return null
  const rest = leavesOf(root)
  const focus = layout.focus !== leafId && rest.some((l) => l.id === layout.focus) ? layout.focus : (rest[Math.max(0, i - 1)] ?? rest[0]).id
  return { root, focus, maximized: layout.maximized === leafId ? null : layout.maximized }
}

/** Moves a whole pane next to another one, or swaps the two when dropped in the middle. */
export function moveLeaf(layout: Layout, leafId: string, targetId: string, side?: Side): Layout {
  if (leafId === targetId) return layout
  const a = findNode(layout.root, leafId) as Leaf | null
  const b = findNode(layout.root, targetId) as Leaf | null
  if (!a || !b) return layout
  if (!side) {
    let root = mapNode(layout.root, a.id, () => ({ ...b, id: a.id }))
    root = mapNode(root, b.id, () => ({ ...a, id: b.id }))
    return { ...layout, root, focus: b.id }
  }
  const without = removeNode(layout.root, leafId)
  if (!without) return layout
  return { root: insertBeside(without, targetId, side, a), focus: a.id, maximized: null }
}

/** Opens a view in the pane with `targetId`, or in a new pane beside it. Moves it if it's already open elsewhere. */
export function dropView(layout: Layout, view: PaneView, targetId: string, side?: Side): Layout {
  const there = leafShowing(layout, view)
  if (there) return moveLeaf(layout, there.id, targetId, side)
  if (!side) return { ...setLeafView(layout, targetId, view), focus: targetId }
  const l = newLeaf(view)
  return { root: insertBeside(layout.root, targetId, side, l), focus: l.id, maximized: null }
}

/**
 * An add-on page asks to show a workspace beside itself (the Plan board opening a card's
 * workspace). The first one goes to its right; later ones stack under the last, up to three, then
 * the last is reused.
 */
export function openBeside(layout: Layout, pageLeafId: string, view: PaneView): Layout {
  const there = leafShowing(layout, view)
  if (there) return { ...layout, focus: there.id }
  const besides = leaves(layout).filter((l) => l.besideOf === pageLeafId)
  if (!besides.length) {
    const l = newLeaf(view, pageLeafId)
    return { root: insertBeside(layout.root, pageLeafId, 'right', l), focus: l.id, maximized: null }
  }
  const last = besides[besides.length - 1]
  if (besides.length >= 3) return { ...updateLeaf(layout, last.id, (l) => ({ ...l, view })), focus: last.id }
  const l = newLeaf(view, pageLeafId)
  return { root: insertBeside(layout.root, last.id, 'bottom', l), focus: l.id, maximized: null }
}

/** The pane next to the focused one in a direction, by position on screen. */
export function neighbor(layout: Layout, dir: Side): string | null {
  const { leaves: b } = boxes(layout.root)
  const cur = b.get(layout.focus)
  if (!cur) return null
  const cx = cur.x + cur.w / 2
  const cy = cur.y + cur.h / 2
  let best: { id: string; d: number } | null = null
  for (const [id, x] of b) {
    if (id === layout.focus) continue
    const ok =
      dir === 'left' ? x.x + x.w <= cur.x + 1e-6 : dir === 'right' ? x.x >= cur.x + cur.w - 1e-6 : dir === 'top' ? x.y + x.h <= cur.y + 1e-6 : x.y >= cur.y + cur.h - 1e-6
    if (!ok) continue
    const d = Math.hypot(x.x + x.w / 2 - cx, x.y + x.h / 2 - cy)
    if (!best || d < best.d) best = { id, d }
  }
  return best?.id ?? null
}

/**
 * Cleans a layout loaded from disk or after workspaces change: panes of archived or missing
 * workspaces close, and every workspace pane agrees with its chats. Null when nothing is left.
 */
export function prune(layout: Layout | null | undefined, live: { workspaces: Set<string>; chatsOf: (wsId: string) => string[] }): Layout | null {
  if (!layout || !layout.root) return null
  let root: LNode | null = layout.root
  for (const l of leavesOf(layout.root)) {
    if (l.view.kind === 'workspace' && !live.workspaces.has(l.view.wsId)) root = root && removeNode(root, l.id)
  }
  if (!root) return null
  let changed = root !== layout.root
  for (const l of leavesOf(root)) {
    if (l.view.kind !== 'workspace') continue
    const v = syncWorkspace(l.view, live.chatsOf(l.view.wsId))
    if (v !== l.view) {
      changed = true
      root = mapNode(root!, l.id, () => ({ ...l, view: v }))
    }
  }
  const rest = leavesOf(root!)
  const focus = rest.some((l) => l.id === layout.focus) ? layout.focus : rest[0].id
  const maximized = layout.maximized && rest.some((l) => l.id === layout.maximized) ? layout.maximized : null
  if (!changed && focus === layout.focus && maximized === (layout.maximized ?? null)) return layout
  return { root: root!, focus, maximized }
}

/** A short name for an unsaved layout: "Single", "Side by side", "Stacked" or "N panes". */
export function layoutLabel(layout: Layout): string {
  const n = leaves(layout).length
  if (n === 1) return 'Single'
  if (n === 2 && isSplit(layout.root)) return layout.root.dir === 'row' ? 'Side by side' : 'Stacked'
  return `${n} panes`
}

export type Preset = 'single' | 'columns-2' | 'rows-2' | 'columns-3'

/** Re-arranges the open panes into a preset shape. Extra panes close; missing ones open empty. */
export function applyPreset(layout: Layout, preset: Preset): Layout {
  const cur = leaves(layout)
  const focus = focusedLeaf(layout)
  const order = [focus, ...cur.filter((l) => l.id !== focus.id)]
  const want = preset === 'single' ? 1 : preset === 'columns-3' ? 3 : 2
  const picked = order.slice(0, want)
  while (picked.length < want) picked.push(newLeaf({ kind: 'empty' }))
  // Keep their order on screen.
  picked.sort((a, b) => (cur.indexOf(a) + 1 || 99) - (cur.indexOf(b) + 1 || 99))
  if (want === 1) return { root: { ...picked[0] }, focus: picked[0].id, maximized: null }
  const dir: Dir = preset === 'rows-2' ? 'col' : 'row'
  return { root: { kind: 'split', id: newId('s'), dir, sizes: even(want), children: picked }, focus: focus.id, maximized: null }
}

/** Checks the shape of a layout read from settings, so a broken save can't break the window. */
export function isLayout(v: unknown): v is Layout {
  const ok = (n: any, inner: boolean): boolean => {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string') return false
    if (n.kind === 'split') return (n.dir === 'row' || n.dir === 'col') && Array.isArray(n.children) && Array.isArray(n.sizes) && n.children.length === n.sizes.length && n.children.length > 0 && n.children.every((c: any) => ok(c, inner))
    if (inner) return n.kind === 'group' && Array.isArray(n.chats) && Array.isArray(n.terms)
    if (n.kind !== 'leaf' || !n.view) return false
    if (n.view.kind === 'workspace') return typeof n.view.wsId === 'string' && ok(n.view.inner, true) && typeof n.view.focusGroup === 'string'
    if (n.view.kind === 'addon') return typeof n.view.key === 'string' && typeof n.view.viewId === 'string'
    return n.view.kind === 'empty'
  }
  return !!v && typeof v === 'object' && ok((v as Layout).root, false) && typeof (v as Layout).focus === 'string'
}
