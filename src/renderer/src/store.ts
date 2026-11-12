import { create } from 'zustand'
import { toggleHidden } from '@shared/sidebarHidden'
import { readCachedAppearance } from './appearanceCache'
import { actionTarget, type AddonAction, type AddonActionContext, type AddonActionPress, type AddonInfo, type PinStatus, type PinnedAddon } from '@shared/addons'
import type { InboxPr, PrInbox } from '@shared/prInbox'
import type { Automation, AutomationRun } from '@shared/automations'
import { isTheirs, type CommentDest, type PrHeadSync, type PrReviewInfo } from '@shared/prReview'
import type { Interdiff } from '@shared/reviewUpdates'
import * as L from '@shared/layout'
import { DEFAULT_SETTINGS, type BackgroundTask, type Effort, type ModelId, type ModelDetails, type WorkspaceSource, type PermissionRequest, type AppState, type Chat, type ChatItem, type DiffStats, type Repo, type RepoGroup, type PrInfo, type Settings, type Workspace, type Leftover, type StackStatus } from '@shared/types'

export type Doc = L.Doc

/** Something being dragged onto the panes: a workspace or add-on page from the sidebar, a pane by its header, or a chat or terminal tab. */
export type DragItem = { kind: 'ws'; wsId: string } | { kind: 'addon'; key: string; viewId: string; repoId?: string } | { kind: 'leaf'; leafId: string } | { kind: 'tab'; leafId: string; tabId: string }

/** Which list the ⌘K palette opens on. */
export type PaletteMode = 'all' | 'files' | 'grep'

/** `addon:<key>/<viewId>` is a tab an add-on adds beside a workspace. */
export type RightTab = 'stack' | 'artifacts' | 'files' | 'changes' | 'checks' | 'graphs' | 'review' | `addon:${string}`

/** An add-on view open in the center: one from the sidebar's top list, or one under a project. */
export interface AddonPage {
  key: string
  viewId: string
  repoId?: string
}

/** A button press on its way to one of an add-on's views: which frame it is for, and what to tell it. */
export interface AddonPress {
  /** Tells two presses of the same button apart. */
  n: number
  at: number
  key: string
  viewId: string
  repoId?: string
  workspaceId?: string
  press: AddonActionPress
}

interface UI {
  repos: Repo[]
  workspaces: Workspace[]
  chats: Chat[]
  items: Record<string, ChatItem[]>
  stats: Record<string, DiffStats>
  /** Tool calls waiting for the user's OK, per chat. */
  permissions: Record<string, PermissionRequest[]>
  /** Background tasks of each chat's running turn. */
  tasks: Record<string, BackgroundTask[]>
  /** The focused pane's workspace, when it shows one. */
  selectedWs: string | null
  /** Split panels: how the center is divided (shared/layout.ts). Kept while Home, PRs or a new-workspace composer is shown. */
  layout: L.Layout | null
  /** The workspace the right panel shows: the focused pane's, or the last focused one while an add-on page or empty pane has focus. */
  rightWs: string | null
  /** The panes are showing, rather than Home, the PRs page or a new-workspace composer. */
  panesShown: boolean
  drag: DragItem | null
  /** The saved layout last opened or saved, shown in the layout menu until the panes change shape. */
  layoutName: string | null
  /** Installed add-ons; the ones that are on add views to the sidebar and the right panel. */
  addons: AddonInfo[]
  /** What each project's choo-choo.json asks for. */
  addonPins: PinStatus[]
  /** The focused pane's add-on page, when it shows one. */
  addonPage: AddonPage | null
  addonPress: AddonPress | null
  /** The PRs page is open in the center. */
  prsPage: boolean
  /** The Automations page is open. */
  automationsPage: boolean
  automations: Automation[]
  automationRuns: AutomationRun[]
  /** Last load of the PRs page's list, and its error. */
  prInbox: PrInbox | null
  prInboxError: string | null
  prInboxLoading: boolean
  activeChat: Record<string, string>
  /** Diff or file open in the center instead of the chat, per workspace. */
  openDoc: Record<string, Doc | null>
  /** Comments on diff lines, per workspace: queued for the agent, or drafts in the person's GitHub review. */
  codeComments: Record<string, CodeComment[]>
  /** The workspace's PR with its author, the signed-in gh user and open feedback; loaded by the PR button. */
  prReview: Record<string, { pr: PrInfo; info: PrReviewInfo } | null | undefined>
  /** Bumped when GitHub reports a change to a workspace's PR or checks; PR views reload on it. */
  prVersion: Record<string, number>
  /** Where each worktree stands against its PR's head on GitHub, and how many commits the last automatic update took in. */
  prSync: Record<string, { sync: PrHeadSync | null; updated?: number } | undefined>
  /** Since your review: the interdiff from your last review's commit to the worktree, per workspace. */
  sinceReview: Record<string, Interdiff | null | undefined>
  /** The All changes | Since your review toggle, per workspace; unset follows Settings › Reviews. */
  sinceReviewOn: Record<string, boolean | undefined>
  /** Last stack status per stacked workspace, for the Stack tab, the header switcher and the sidebar. */
  stacks: Record<string, StackStatus | null | undefined>
  /** A Reflect tab open in the workspace: the person's feedback, and whether to archive after. */
  reflects: Record<string, { feedback: string; archiveAfter: boolean } | undefined>
  settings: Settings
  modal: 'settings' | 'palette' | 'create' | 'quickstart' | 'conductor' | 'share' | 'open-share' | 'usage' | 'group' | 'remove-repo' | null
  /** Project the Remove project dialog is for. */
  removeRepoId: string | null
  leftovers: Leftover[]
  /** Project groups: several repos with one shared orchestrator. */
  groups: RepoGroup[]
  /** The group open in the group editor; null makes a new one. */
  editGroup: string | null
  /** The chat whose usage graphs are open. */
  usageChat: string | null
  paletteMode: PaletteMode
  /** Settings tab to open on. */
  settingsTab: 'general' | 'projects' | 'agents' | 'prompts' | 'mcp' | 'plugins' | 'addons' | 'integrations' | 'updates' | 'telemetry' | 'appearance' | 'experimental'
  recentPaths: string[]
  modelDetails: Partial<Record<ModelId, ModelDetails>>
  /** Repo whose new-workspace composer is open in the center, if any. */
  draftRepo: string | null
  /** A share link to open, from a choo-choo:// URL. */
  shareLinkDraft: string | null
  history: string[]
  historyIndex: number
  sidebarOpen: boolean
  rightOpen: boolean
  bottomOpen: boolean
  /** Per workspace: the person switched between building and reviewing by hand. */
  wsMode: Record<string, 'build' | 'review'>
  rightTab: RightTab
  error: string | null

  hydrate(s: AppState): void
  selectWorkspace(id: string | null, fromHistory?: boolean): void
  back(): void
  forward(): void
  setActiveChat(wsId: string, chatId: string): void
  upsertChat(c: Chat): void
  removeChat(id: string): void
  setItems(chatId: string, items: ChatItem[]): void
  upsertItem(chatId: string, item: ChatItem): void
  setStats(wsId: string, s: DiffStats): void
  set(p: Partial<UI>): void
}

export const useStore = create<UI>((set, get) => ({
  repos: [],
  workspaces: [],
  chats: [],
  items: {},
  stats: {},
  permissions: {},
  tasks: {},
  selectedWs: null,
  layout: null,
  rightWs: null,
  panesShown: false,
  drag: null,
  layoutName: null,
  addons: [],
  addonPins: [],
  addonPage: null,
  addonPress: null,
  prsPage: false,
  automationsPage: false,
  automations: [],
  automationRuns: [],
  prInbox: readInboxCache(),
  prInboxError: null,
  prInboxLoading: false,
  activeChat: {},
  openDoc: {},
  codeComments: loadCodeComments(),
  prReview: {},
  prVersion: {},
  prSync: {},
  sinceReview: {},
  sinceReviewOn: loadSinceReviewOn(),
  stacks: {},
  reflects: {},
  settings: { ...DEFAULT_SETTINGS, ...readCachedAppearance() },
  modal: null,
  groups: [],
  editGroup: null,
  usageChat: null,
  paletteMode: 'all',
  settingsTab: 'general',
  recentPaths: [],
  removeRepoId: null,
  leftovers: [],
  modelDetails: {},
  draftRepo: null,
  shareLinkDraft: null,
  history: [],
  historyIndex: -1,
  sidebarOpen: true,
  rightOpen: true,
  bottomOpen: true,
  wsMode: (() => { try { return JSON.parse(localStorage.getItem('wsMode') ?? '{}') } catch { return {} } })(),
  rightTab: 'changes',
  error: null,

  hydrate: (s) => {
    set({ repos: s.repos, workspaces: s.workspaces, chats: s.chats, settings: s.settings, recentPaths: s.recentPaths ?? [], groups: s.groups ?? [], leftovers: s.leftovers ?? [], automations: s.automations ?? [], automationRuns: s.automationRuns ?? [] })
    if (!layoutLoaded) {
      layoutLoaded = true
      const saved = L.isLayout(s.settings.layout) ? s.settings.layout : null
      const l = L.prune(saved, liveOf(get()))
      if (l) return applyLayout(l, { save: false })
    }
    reconcileLayout()
  },
  selectWorkspace: (id, fromHistory) => {
    if (!id) return set({ selectedWs: null, draftRepo: null, addonPage: null, prsPage: false, automationsPage: false, panesShown: false })
    showView(viewFor(id))
    if (fromHistory) return
    const { history, historyIndex } = get()
    const h = [...history.slice(0, historyIndex + 1), id].slice(-50)
    set({ history: h, historyIndex: h.length - 1 })
  },
  back: () => {
    const { history, historyIndex } = get()
    if (historyIndex > 0) {
      set({ historyIndex: historyIndex - 1 })
      showView(viewFor(history[historyIndex - 1]))
    }
  },
  forward: () => {
    const { history, historyIndex } = get()
    if (historyIndex < history.length - 1) {
      set({ historyIndex: historyIndex + 1 })
      showView(viewFor(history[historyIndex + 1]))
    }
  },
  setActiveChat: (wsId, chatId) => {
    const l = get().layout
    const leaf = l && L.leafOfWorkspace(l, wsId)
    if (!l || !leaf || leaf.view.kind !== 'workspace') return set((s) => ({ activeChat: { ...s.activeChat, [wsId]: chatId }, openDoc: { ...s.openDoc, [wsId]: null } }))
    let view = L.syncWorkspace(leaf.view, chatsOf(get(), wsId))
    const g = L.groupOf(view.inner, chatId) ?? (L.findNode(view.inner, view.focusGroup) as L.Group)
    view = { ...view, inner: L.mapNode(view.inner, g.id, (n) => ({ ...(n as L.Group), active: chatId, doc: null })), focusGroup: g.id }
    applyLayout(L.updateLeaf(l, leaf.id, (x) => ({ ...x, view })), { show: false })
  },
  upsertChat: (c) => {
    set((s) => {
      const i = s.chats.findIndex((x) => x.id === c.id)
      const chats = [...s.chats]
      if (i >= 0) chats[i] = c
      else chats.push(c)
      return { chats }
    })
    if (!layoutHasChat(get().layout, c)) reconcileLayout()
  },
  removeChat: (id) => {
    set((s) => ({ chats: s.chats.filter((c) => c.id !== id) }))
    reconcileLayout()
  },
  setItems: (chatId, items) => set((s) => ({ items: { ...s.items, [chatId]: items } })),
  upsertItem: (chatId, item) =>
    set((s) => {
      const list = [...(s.items[chatId] ?? [])]
      const i = list.findIndex((x) => x.id === item.id)
      if (i >= 0) list[i] = item
      else list.push(item)
      return { items: { ...s.items, [chatId]: list } }
    }),
  setStats: (wsId, st) => set((s) => ({ stats: { ...s.stats, [wsId]: st } })),
  set: (p) => set(p)
}))

// ---------- split panels ----------

let layoutLoaded = false
/** The last inner split of each workspace that left the screen, so showing it again restores its groups. */
const innerCache: Record<string, { inner: L.GNode; focusGroup: string }> = {}

type St = ReturnType<typeof useStore.getState>
const chatsOf = (st: St, wsId: string) => st.chats.filter((c) => c.workspaceId === wsId).map((c) => c.id)
const liveOf = (st: St) => ({ workspaces: new Set(st.workspaces.filter((w) => !w.archived).map((w) => w.id)), chatsOf: (id: string) => chatsOf(st, id) })

function layoutHasChat(l: L.Layout | null, c: Chat): boolean {
  const leaf = l && L.leafOfWorkspace(l, c.workspaceId)
  return !leaf || leaf.view.kind !== 'workspace' || !!L.groupOf(leaf.view.inner, c.id)
}

/** A pane view for a workspace: its last split if it had one, else one group on its active chat. */
export function viewFor(wsId: string): L.PaneView {
  const st = useStore.getState()
  const chats = chatsOf(st, wsId)
  const cached = innerCache[wsId]
  if (cached) return L.syncWorkspace({ kind: 'workspace', wsId, ...cached }, chats)
  return L.workspaceView(wsId, chats, st.activeChat[wsId])
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function saveLayoutSoon(layout: L.Layout | null) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.api.saveSettings({ layout }).catch(() => {}), 400)
}

/**
 * Sets the layout and everything read from it: the focused pane's workspace or page, and each
 * shown workspace's active chat and open doc (from its focused group), which older code reads.
 */
export function applyLayout(next: L.Layout | null, opts: { show?: boolean; save?: boolean } = {}) {
  const st = useStore.getState()
  const prev = st.layout
  if (prev) {
    // Remember the splits of workspaces leaving the screen.
    const still = new Set(next ? L.leaves(next).flatMap((l) => (l.view.kind === 'workspace' ? [l.view.wsId] : [])) : [])
    for (const l of L.leaves(prev)) if (l.view.kind === 'workspace' && !still.has(l.view.wsId)) innerCache[l.view.wsId] = { inner: l.view.inner, focusGroup: l.view.focusGroup }
  }
  const patch: Partial<St> = { layout: next }
  if (!next) Object.assign(patch, { selectedWs: null, rightWs: null, addonPage: null, panesShown: false })
  else {
    const f = L.focusedLeaf(next)
    patch.selectedWs = f.view.kind === 'workspace' ? f.view.wsId : null
    // Keep the right panel on the last workspace while a page or empty pane has focus, so it doesn't jump in and out.
    const firstWs = L.leaves(next).find((x) => x.view.kind === 'workspace')?.view
    patch.rightWs = patch.selectedWs ?? (st.rightWs && L.leafOfWorkspace(next, st.rightWs) ? st.rightWs : firstWs?.kind === 'workspace' ? firstWs.wsId : null)
    patch.addonPage = f.view.kind === 'addon' ? { key: f.view.key, viewId: f.view.viewId, repoId: f.view.repoId } : null
    const activeChat = { ...st.activeChat }
    const openDoc = { ...st.openDoc }
    for (const l of L.leaves(next)) {
      if (l.view.kind !== 'workspace') continue
      const g = (L.findNode(l.view.inner, l.view.focusGroup) as L.Group | null) ?? L.leavesOf(l.view.inner)[0]
      if (g.active && g.chats.includes(g.active)) activeChat[l.view.wsId] = g.active
      openDoc[l.view.wsId] = g.doc
    }
    Object.assign(patch, { activeChat, openDoc })
    if (opts.show !== false) Object.assign(patch, { panesShown: true, draftRepo: null, prsPage: false, automationsPage: false })
  }
  st.set(patch)
  if (opts.save !== false) saveLayoutSoon(next)
}

/** Shows a workspace or page in the focused pane, or `side` of it in a new pane. */
export function showView(view: L.PaneView, side?: L.Side) {
  applyLayout(L.show(useStore.getState().layout, view, side))
}

/** Keeps the panes in step after workspaces or chats change. */
function reconcileLayout() {
  const st = useStore.getState()
  if (!st.layout) return
  const next = L.prune(st.layout, liveOf(st))
  if (next !== st.layout) applyLayout(next, { show: st.panesShown })
}

const cur = () => useStore.getState().layout

export function focusLeaf(leafId: string) {
  const l = cur()
  if (l && l.focus !== leafId) applyLayout({ ...l, focus: leafId }, { save: false })
}

export function focusDir(dir: L.Side) {
  const l = cur()
  const id = l && L.neighbor(l, dir)
  if (id) focusLeaf(id)
}

export function splitPane(side: L.Side) {
  const l = cur()
  if (!l) return
  applyLayout(L.splitFocused(l, side))
}

export function closePane(leafId?: string) {
  const l = cur()
  if (!l) return
  applyLayout(L.closeLeaf(l, leafId ?? l.focus))
}

export function toggleMaximize(leafId?: string) {
  const l = cur()
  if (!l || L.leaves(l).length < 2) return
  const id = leafId ?? l.focus
  applyLayout({ ...l, focus: id, maximized: l.maximized === id ? null : id })
}

export function setPaneSizes(splitId: string, sizes: number[], save = true) {
  const l = cur()
  if (l) applyLayout({ ...l, root: L.setSizes(l.root, splitId, sizes) }, { save })
}

/** A workspace, page or pane was dropped on a pane: in the middle replaces (or swaps), on an edge splits. */
export function dropOnLeaf(item: DragItem, targetId: string, side?: L.Side) {
  const l = cur()
  if (!l) return
  if (item.kind === 'leaf') return applyLayout(L.moveLeaf(l, item.leafId, targetId, side))
  if (item.kind === 'ws') return applyLayout(L.dropView(l, viewFor(item.wsId), targetId, side))
  if (item.kind === 'addon') return applyLayout(L.dropView(l, { kind: 'addon', key: item.key, viewId: item.viewId, repoId: item.repoId }, targetId, side))
}

function updateWorkspaceView(leafId: string, fn: (v: Extract<L.PaneView, { kind: 'workspace' }>) => Extract<L.PaneView, { kind: 'workspace' }>, opts?: { save?: boolean }) {
  const l = cur()
  const leaf = l && (L.findNode(l.root, leafId) as L.Leaf | null)
  if (!l || !leaf || leaf.view.kind !== 'workspace') return
  const view = fn(leaf.view)
  if (view !== leaf.view) applyLayout(L.updateLeaf(l, leafId, (x) => ({ ...x, view })), { show: false, ...opts })
}

/** A chat or terminal tab dropped on a group of its own workspace: in the middle moves it there, on an edge splits it out. */
export function dropTab(leafId: string, tabId: string, groupId: string, side?: L.Side) {
  updateWorkspaceView(leafId, (v) => {
    const r = L.moveTab(v.inner, tabId, groupId, side)
    return r.inner === v.inner ? v : { ...v, inner: r.inner, focusGroup: r.group }
  })
  focusLeaf(leafId)
}

export function setGroupSizes(leafId: string, splitId: string, sizes: number[], save = true) {
  updateWorkspaceView(leafId, (v) => ({ ...v, inner: L.setSizes(v.inner, splitId, sizes) }), { save })
}

export function focusGroup(leafId: string, groupId: string) {
  const l = cur()
  const leaf = l && (L.findNode(l.root, leafId) as L.Leaf | null)
  if (!l || !leaf) return
  if (leaf.view.kind === 'workspace' && leaf.view.focusGroup !== groupId) updateWorkspaceView(leafId, (v) => ({ ...v, focusGroup: groupId }), { save: false })
  focusLeaf(leafId)
}

/** Picks a tab in a group; picking a chat or terminal closes the group's diff or file, like before splits. */
export function setGroupActive(leafId: string, groupId: string, tabId: string) {
  updateWorkspaceView(leafId, (v) => ({ ...v, focusGroup: groupId, inner: L.mapNode(v.inner, groupId, (g) => ({ ...(g as L.Group), active: tabId, doc: null })) }))
}

export function setGroupDoc(leafId: string, groupId: string, doc: Doc | null) {
  updateWorkspaceView(leafId, (v) => {
    let inner = L.mapNode(v.inner, groupId, (g) => ({ ...(g as L.Group), doc }))
    const g = L.findNode(inner, groupId) as L.Group
    // A group that only held a file goes away when the file closes.
    if (!doc && !g.chats.length && !g.terms.length && L.leavesOf(inner).length > 1) inner = L.removeNode(inner, groupId) ?? inner
    const focus = L.findNode(inner, v.focusGroup) ? v.focusGroup : L.leavesOf(inner)[0].id
    return { ...v, inner, focusGroup: focus }
  })
}

/** Opens the group's open diff or file in a new group beside it. */
export function splitDocOut(leafId: string, groupId: string, side: L.Side) {
  updateWorkspaceView(leafId, (v) => {
    const g = L.findNode(v.inner, groupId) as L.Group | null
    if (!g?.doc) return v
    const ng: L.Group = { ...L.newGroup(), doc: g.doc }
    let inner = L.mapNode(v.inner, groupId, (x) => ({ ...(x as L.Group), doc: null }))
    inner = L.insertBeside(inner, groupId, side, ng)
    return { ...v, inner, focusGroup: ng.id }
  })
}

export function mergeGroups(leafId: string) {
  updateWorkspaceView(leafId, (v) => {
    const g = L.mergeGroups(v.inner)
    return { ...v, inner: g, focusGroup: g.id }
  })
}

let termSeq = 0
/** Opens a terminal of the workspace as a tab in the focused group. */
export function addTerminalTab(leafId: string) {
  updateWorkspaceView(leafId, (v) => {
    const g = (L.findNode(v.inner, v.focusGroup) as L.Group | null) ?? L.leavesOf(v.inner)[0]
    const id = `${v.wsId}:pane-term-${Date.now().toString(36)}${termSeq++}`
    return { ...v, focusGroup: g.id, inner: L.mapNode(v.inner, g.id, (x) => ({ ...(x as L.Group), terms: [...(x as L.Group).terms, id], active: id, doc: null })) }
  })
}

export function closeTerminalTab(leafId: string, termId: string) {
  window.api.ptyKill(termId)
  updateWorkspaceView(leafId, (v) => {
    const g = L.groupOf(v.inner, termId)
    if (!g) return v
    const terms = g.terms.filter((t) => t !== termId)
    let inner = L.mapNode(v.inner, g.id, (x) => ({ ...(x as L.Group), terms, active: g.active === termId ? (g.chats[0] ?? terms[0] ?? null) : g.active }))
    if (!g.chats.length && !terms.length && !g.doc && L.leavesOf(inner).length > 1) inner = L.removeNode(inner, g.id) ?? inner
    const focus = L.findNode(inner, v.focusGroup) ? v.focusGroup : L.leavesOf(inner)[0].id
    return { ...v, inner, focusGroup: focus }
  })
}

export function applyPreset(preset: L.Preset) {
  const l = cur()
  if (l) applyLayout(L.applyPreset(l, preset))
}

export function saveLayoutAs(name: string) {
  const st = useStore.getState()
  if (!st.layout || !name.trim()) return
  const list = (st.settings.savedLayouts ?? []).filter((x) => x.name !== name.trim())
  const savedLayouts = [...list, { name: name.trim(), layout: st.layout }]
  st.set({ settings: { ...st.settings, savedLayouts }, layoutName: name.trim() })
  void window.api.saveSettings({ savedLayouts }).catch(reportError)
}

export function deleteSavedLayout(name: string) {
  const st = useStore.getState()
  const savedLayouts = (st.settings.savedLayouts ?? []).filter((x) => x.name !== name)
  st.set({ settings: { ...st.settings, savedLayouts }, ...(st.layoutName === name ? { layoutName: null } : {}) })
  void window.api.saveSettings({ savedLayouts }).catch(reportError)
}

/** Switches to a saved layout. Panes of workspaces that are gone close. */
export function openSavedLayout(name: string) {
  const st = useStore.getState()
  const saved = st.settings.savedLayouts?.find((x) => x.name === name)
  if (!saved || !L.isLayout(saved.layout)) return
  const l = L.prune(saved.layout, liveOf(st))
  if (!l) return reportError(new Error(`The workspaces in "${name}" are all archived.`))
  applyLayout(l)
  useStore.getState().set({ layoutName: name })
}

/** An add-on page asked to show a workspace next to itself. Falls back to the focused pane when the page isn't open. */
export function openWorkspaceBeside(wsId: string, chatId: string, beside: { key: string; viewId: string; repoId?: string }) {
  const l = cur()
  const page = l && L.leafOfAddon(l, beside.key, beside.viewId, beside.repoId)
  const st = useStore.getState()
  if (!l || !page) {
    st.setActiveChat(wsId, chatId)
    return st.selectWorkspace(wsId)
  }
  applyLayout(L.openBeside(l, page.id, viewFor(wsId)))
  useStore.getState().setActiveChat(wsId, chatId)
}

export async function refreshState() {
  useStore.getState().hydrate(await window.api.getState())
}

export async function refreshStats(wsId: string) {
  try {
    useStore.getState().setStats(wsId, await window.api.getDiffStats(wsId))
  } catch {
    /* worktree may be gone */
  }
}

export function reportError(e: unknown) {
  const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  useStore.getState().set({ error: msg })
}

/** Opens the new-workspace composer for a repo. The worktree is created when the person presses Create. */
export function newWorkspace(repoId: string) {
  useStore.getState().set({ selectedWs: null, draftRepo: repoId, addonPage: null, prsPage: false, automationsPage: false, panesShown: false })
}

/** Shows an add-on's view in the center. */
export function openAddonPage(page: AddonPage, side?: L.Side) {
  showView({ kind: 'addon', key: page.key, viewId: page.viewId, ...(page.repoId ? { repoId: page.repoId } : {}) }, side)
}

let presses = 0

/**
 * A button an add-on put in the app was pressed. Opens the view the button names and hands it the
 * press, or passes the press to the add-on's background page when the button names no view.
 */
export function runAddonAction(addon: AddonInfo, action: AddonAction, ctx: AddonActionContext) {
  const target = addon.manifest && actionTarget(addon.manifest, action, ctx)
  if (!target) return
  if (target.to === 'background') return void window.api.addonAction(addon.key, action.id, ctx).catch(reportError)
  const st = useStore.getState()
  const addonPress: AddonPress = { n: ++presses, at: Date.now(), key: addon.key, viewId: target.viewId, repoId: target.repoId, press: { id: action.id, place: action.place, ...ctx } }
  if (target.to === 'page') {
    st.set({ addonPress })
    return openAddonPage({ key: addon.key, viewId: target.viewId, repoId: target.repoId })
  }
  if (st.selectedWs !== target.workspaceId) st.selectWorkspace(target.workspaceId)
  st.set({ rightOpen: true, rightTab: `addon:${addon.key}/${target.viewId}`, addonPress: { ...addonPress, workspaceId: target.workspaceId } })
}

/** Shows the PRs page in the center and reloads its list. */
export function openPrsPage() {
  useStore.getState().set({ selectedWs: null, draftRepo: null, addonPage: null, prsPage: true, automationsPage: false, panesShown: false })
  void refreshPrInbox()
}

/** Opens the Automations page. */
export function openAutomationsPage() {
  useStore.getState().set({ selectedWs: null, draftRepo: null, addonPage: null, prsPage: false, automationsPage: true, panesShown: false })
}

let inboxLoad: Promise<void> | null = null

const INBOX_CACHE_KEY = 'choo.prInbox'

/** The PR list from the last successful load, so the page has something to show at once and when GitHub is down. */
function readInboxCache(): PrInbox | null {
  try {
    const raw = localStorage.getItem(INBOX_CACHE_KEY)
    return raw ? (JSON.parse(raw) as PrInbox) : null
  } catch {
    return null
  }
}

function writeInboxCache(inbox: PrInbox) {
  try {
    localStorage.setItem(INBOX_CACHE_KEY, JSON.stringify(inbox))
  } catch {
    // Storage full or unavailable: the list just loads from GitHub next time.
  }
}

/** Reloads the PRs list. Calls made while a load is running share it. */
export function refreshPrInbox(): Promise<void> {
  inboxLoad ??= (async () => {
    useStore.getState().set({ prInboxLoading: true })
    try {
      const inbox = await window.api.prInbox()
      writeInboxCache(inbox)
      useStore.getState().set({ prInbox: inbox, prInboxError: null })
    } catch (e) {
      useStore.getState().set({ prInboxError: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) })
    } finally {
      useStore.getState().set({ prInboxLoading: false })
      inboxLoad = null
    }
  })()
  return inboxLoad
}

/**
 * Opens a workspace checked out on a PR's branch, on the Review tab. Reuses one that's already open,
 * and clones the repo first when it isn't a project yet.
 */
export async function openPrWorkspace(pr: InboxPr) {
  const st = useStore.getState()
  if (pr.workspaceId && st.workspaces.some((w) => w.id === pr.workspaceId && !w.archived)) {
    st.set({ rightOpen: true, rightTab: 'review' })
    st.selectWorkspace(pr.workspaceId)
    return
  }
  let repoId = pr.repoId
  if (!repoId || !st.repos.some((r) => r.id === repoId)) repoId = (await window.api.cloneRepo(pr.repo)).id
  const { workspace, chat } = await window.api.createWorkspace(repoId, { kind: 'pr', number: pr.number })
  await refreshState()
  const now = useStore.getState()
  now.setActiveChat(workspace.id, chat.id)
  now.set({ rightOpen: true, rightTab: 'review' })
  now.selectWorkspace(workspace.id)
  void refreshPrInbox()
}

export async function refreshAddons(fresh = false) {
  try {
    useStore.getState().set({ addons: await window.api.addonsList(fresh) })
    useStore.getState().set({ addonPins: await window.api.addonPins() })
  } catch {
    /* Claude Code isn't available; Settings > Add-ons shows why */
  }
}

/**
 * The add-ons a project pins that still need the person: not on, and not a recommendation they
 * turned down. Pins are checked now and then; the add-on list is live, so its state wins.
 */
export function pinsToSetUp(pin: PinStatus | undefined, addons: AddonInfo[], dismissed: string[] = []): PinnedAddon[] {
  return (pin?.addons ?? [])
    .map((a) => ({ ...a, state: addons.find((x) => x.id.toLowerCase() === a.id.toLowerCase())?.state ?? a.state }))
    .filter((a) => a.state !== 'on' && (a.required || !dismissed.includes(a.id)))
}

export interface DraftContext {
  images: string[]
  files: string[]
  folders: string[]
  /** Workspace ids whose worktrees the agent can see. */
  links: string[]
}

export async function createWorkspace(repoId: string, opts: { source?: WorkspaceSource; text: string; model: ModelId; effort: Effort; extra?: DraftContext }) {
  const st = useStore.getState()
  const linked = (opts.extra?.links ?? []).map((id) => st.workspaces.find((w) => w.id === id)).filter((w): w is Workspace => !!w)
  const files = opts.extra?.files ?? []
  const folders = [...(opts.extra?.folders ?? []), ...linked.map((w) => w.path), ...files.map((f) => f.slice(0, f.lastIndexOf('/')))]
  const { workspace, chat, context } = await window.api.createWorkspace(repoId, opts.source, folders)
  await window.api.updateChat(chat.id, { model: opts.model, effort: opts.effort })
  await refreshState()
  useStore.getState().setActiveChat(workspace.id, chat.id)
  useStore.getState().selectWorkspace(workspace.id)
  const notes: string[] = []
  if (linked.length)
    notes.push(
      'Linked workspaces (other worktrees you can read and edit):\n' +
        linked.map((w) => `- ${w.title} (${st.repos.find((r) => r.id === w.repoId)?.name ?? 'repo'}, branch ${w.branch}): ${w.path}`).join('\n')
    )
  if (files.length) notes.push('Attached files:\n' + files.map((f) => `- ${f}`).join('\n'))
  if (opts.extra?.folders.length) notes.push('Extra folders you can use:\n' + opts.extra.folders.map((f) => `- ${f}`).join('\n'))
  const images = opts.extra?.images ?? []
  const prompt = [context, ...notes, opts.text.trim() || (images.length ? 'See the attached image.' : '')].filter(Boolean).join('\n\n')
  if (prompt) await window.api.sendMessage(chat.id, prompt, images)
}

/** Opens the repo's orchestrator, which starts and directs workspaces for you. */
export async function openOrchestrator(repoId: string) {
  try {
    const { workspace, chat } = await window.api.openOrchestrator(repoId)
    await refreshState()
    useStore.getState().setActiveChat(workspace.id, chat.id)
    useStore.getState().selectWorkspace(workspace.id)
  } catch (e) {
    reportError(e)
  }
}

/** Opens a project group's orchestrator, which directs workspaces across all of its repos. */
/** Opens a project's orchestrator workspace on one chat: `chatId` (a thread), or the orchestrator chat. */
export async function openGroupOrchestrator(groupId: string, chatId?: string) {
  try {
    const { workspace, chat } = await window.api.openGroupOrchestrator(groupId)
    await refreshState()
    useStore.getState().setActiveChat(workspace.id, chatId ?? chat.id)
    useStore.getState().selectWorkspace(workspace.id)
  } catch (e) {
    reportError(e)
  }
}

/** Hide or show a sidebar row (an Orchestrator or add-on row). Keys come from shared/sidebarHidden.ts. */
export function setSidebarRowHidden(keys: string | string[], hidden: boolean) {
  saveSidebarList('sidebarHidden', keys, hidden)
}

/** Collapse a project in the sidebar so only its row shows, or expand it again. */
export function setRepoCollapsed(repoId: string, collapsed: boolean) {
  saveSidebarList('sidebarCollapsed', repoId, collapsed)
}

function saveSidebarList(field: 'sidebarHidden' | 'sidebarCollapsed', keys: string | string[], on: boolean) {
  const cur = useStore.getState().settings[field] ?? []
  const next = [keys].flat().reduce((list, key) => toggleHidden(list, key, on), cur)
  if (next === cur) return
  useStore.getState().set({ settings: { ...useStore.getState().settings, [field]: next } })
  void window.api
    .saveSettings({ [field]: next })
    .then((settings) => useStore.getState().set({ settings }))
    .catch(reportError)
}

export function editGroup(groupId: string | null) {
  useStore.getState().set({ modal: 'group', editGroup: groupId })
}

export async function addRepository() {
  try {
    const repo = await window.api.pickAndAddRepo()
    if (repo) await refreshState()
  } catch (e) {
    reportError(e)
  }
}

export async function newChatTab(wsId: string) {
  const chat = await window.api.createChat(wsId)
  useStore.getState().upsertChat(chat)
  useStore.getState().setActiveChat(wsId, chat.id)
}

export async function closeChatTab(chatId: string) {
  const s = useStore.getState()
  const chat = s.chats.find((c) => c.id === chatId)
  if (!chat) return
  const siblings = s.chats.filter((c) => c.workspaceId === chat.workspaceId)
  if (siblings.length <= 1) return // keep at least one tab
  await window.api.closeChat(chatId)
  s.removeChat(chatId)
  const next = siblings.find((c) => c.id !== chatId)
  if (next && s.activeChat[chat.workspaceId] === chatId) s.setActiveChat(chat.workspaceId, next.id)
}

export function nextUnread(): { wsId: string; chatId: string } | null {
  const s = useStore.getState()
  const cur = s.selectedWs ? s.activeChat[s.selectedWs] : null
  const live = new Set(s.workspaces.filter((w) => !w.archived).map((w) => w.id))
  const c = s.chats.find((c) => c.unread && c.id !== cur && live.has(c.workspaceId))
  return c ? { wsId: c.workspaceId, chatId: c.id } : null
}

export function goToNextUnread() {
  const n = nextUnread()
  if (!n) return
  const s = useStore.getState()
  s.setActiveChat(n.wsId, n.chatId)
  s.selectWorkspace(n.wsId)
}

/** A comment on a range of lines in the diff, queued in the composer until sent. */
export interface CodeComment {
  id: string
  file: string
  /** Line numbers in the new file, or in the old file for removed lines. */
  start: number
  end: number
  side: 'new' | 'old'
  /** The commented lines, as shown in the diff. */
  code: string
  text: string
  /** agent: sent with the next chat message. github: a draft in the person's review, posted on submit. Missing means agent. */
  dest?: CommentDest
  /** Copied from a reviewer-agent finding. */
  fromFinding?: boolean
  /** The worktree's commit the line numbers belong to; moved along when new commits come in. */
  commit?: string
  /** New commits changed the commented lines: shown for the person to check before it's posted. */
  stale?: boolean
}

export const destOf = (c: CodeComment): CommentDest => c.dest ?? 'agent'


/** Drafts survive a restart: a half-written review is too much to lose. */
function loadSinceReviewOn(): Record<string, boolean | undefined> {
  try {
    return JSON.parse(localStorage.getItem('sinceReviewOn') ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

function loadCodeComments(): Record<string, CodeComment[]> {
  try {
    return JSON.parse(localStorage.getItem('codeComments') ?? '{}') as Record<string, CodeComment[]>
  } catch {
    return {}
  }
}

export function setCodeComments(wsId: string, fn: (list: CodeComment[]) => CodeComment[]) {
  const st = useStore.getState()
  const all = { ...st.codeComments, [wsId]: fn(st.codeComments[wsId] ?? []) }
  if (!all[wsId].length) delete all[wsId]
  st.set({ codeComments: all })
  try {
    localStorage.setItem('codeComments', JSON.stringify(all))
  } catch {
    /* storage unavailable */
  }
}

/**
 * Set while reviewing an open PR: agent comments then ask for advice, not commits. Follows the workspace's
 * Build/Review mode when given, else PR ownership.
 */
export function reviewTarget(r: { pr: PrInfo; info: PrReviewInfo } | null | undefined, mode?: 'build' | 'review'): { number: number; author: string } | undefined {
  const reviewing = mode ? mode === 'review' : isTheirs(r?.info)
  return r && r.pr.state === 'OPEN' && reviewing ? { number: r.pr.number, author: r.info.author } : undefined
}

/**
 * The message that sends queued code comments, followed by anything typed in the composer. On someone
 * else's PR the agent is told to advise only, since the branch isn't the person's to push to.
 */
export function codeCommentsMessage(list: CodeComment[], text: string, review?: { number: number; author: string }): string {
  const parts = list.map((c) => {
    const where = `${c.file}:${c.start === c.end ? c.start : `${c.start}-${c.end}`}${c.side === 'old' ? ' (removed lines)' : ''}`
    const code = c.code.split('\n').map((l) => `    ${l}`).join('\n')
    return `${where}\n${code}\n${c.text}`
  })
  const head = review
    ? `I'm reviewing @${review.author}'s PR #${review.number}, so don't commit or push. Answer each comment on the code (${list.length}); where a change is warranted, write it as a GitHub \`\`\`suggestion block I can post in my review.`
    : `Comments on the code (${list.length}):`
  return [head, ...parts, ...(text ? [text] : [])].join('\n\n')
}

/** Opens the workspace's Reflect tab, which runs the reflect agent with this feedback. */
export function startReflect(wsId: string, feedback: string, archiveAfter: boolean) {
  const s = useStore.getState()
  s.set({ reflects: { ...s.reflects, [wsId]: { feedback, archiveAfter } } })
  openDoc(wsId, { kind: 'reflect', path: 'Reflect' })
}

/** Closes the Reflect tab, stopping the agent if it's still reading. */
export function closeReflect(wsId: string) {
  const s = useStore.getState()
  void window.api.cancelReflect(wsId)
  s.set({ reflects: { ...s.reflects, [wsId]: undefined } })
  const leaf = s.layout && L.leafOfWorkspace(s.layout, wsId)
  if (leaf?.view.kind === 'workspace') {
    for (const g of L.leavesOf(leaf.view.inner)) if (g.doc?.kind === 'reflect') setGroupDoc(leaf.id, g.id, null)
    return
  }
  const open = s.openDoc[wsId]
  s.set({ openDoc: { ...s.openDoc, [wsId]: open?.kind === 'reflect' ? null : (open ?? null) } })
}

/** Shows a diff, file or Reflect in the workspace's focused group, in place of its chat. */
export function openDoc(wsId: string, doc: Doc | null) {
  const s = useStore.getState()
  const leaf = s.layout && L.leafOfWorkspace(s.layout, wsId)
  if (leaf?.view.kind === 'workspace') return setGroupDoc(leaf.id, leaf.view.focusGroup, doc)
  s.set({ openDoc: { ...s.openDoc, [wsId]: doc } })
}

export async function restoreWorkspace(wsId: string) {
  try {
    await window.api.restoreWorkspace(wsId)
    await refreshState()
    useStore.getState().selectWorkspace(wsId)
    void refreshStats(wsId)
  } catch (e) {
    reportError(e)
  }
}

export function addPermission(req: PermissionRequest) {
  const s = useStore.getState()
  const list = (s.permissions[req.chatId] ?? []).filter((r) => r.id !== req.id)
  s.set({ permissions: { ...s.permissions, [req.chatId]: [...list, req] } })
}

export function removePermission(id: string) {
  const s = useStore.getState()
  const next: Record<string, PermissionRequest[]> = {}
  for (const [k, v] of Object.entries(s.permissions)) next[k] = v.filter((r) => r.id !== id)
  s.set({ permissions: next })
}

export function openPalette(mode: PaletteMode = 'all') {
  const s = useStore.getState()
  if (s.modal === 'palette' && s.paletteMode === mode) return s.set({ modal: null })
  s.set({ modal: 'palette', paletteMode: mode })
}

export async function archiveWorkspace(wsId: string) {
  try {
    await window.api.archiveWorkspace(wsId)
    await refreshState()
    if (useStore.getState().selectedWs === wsId) useStore.getState().selectWorkspace(null)
  } catch (e) {
    reportError(e)
  }
}

/** "3mo", "7d", "5h", "2m", "now". */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, (now - ts) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`
  return `${Math.floor(s / (86400 * 365))}y`
}

/** Model name with its current version when known, e.g. "Opus 5.5". */
export function modelLabel(id: ModelId, details = useStore.getState().modelDetails): string {
  return details[id]?.displayName ?? MODEL_NAMES[id] ?? id
}
const MODEL_NAMES: Record<ModelId, string> = { opus: 'Opus', fable: 'Fable', sonnet: 'Sonnet', haiku: 'Haiku', codex: 'Codex' }

export async function loadModelDetails() {
  try {
    useStore.getState().set({ modelDetails: await window.api.modelDetails() })
  } catch {
    /* labels fall back to plain names */
  }
}

/** Reloads a stacked workspace's status (git, PRs, comments, checks) into the store. */
export async function loadStack(wsId: string): Promise<void> {
  try {
    const st = await window.api.stackStatus(wsId)
    useStore.getState().set({ stacks: { ...useStore.getState().stacks, [wsId]: st } })
  } catch {
    // Keep the last status; the next change or poll tries again.
  }
}
