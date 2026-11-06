import { create } from 'zustand'
import { DEFAULT_SETTINGS, type PermissionRequest, type AppState, type Chat, type ChatItem, type DiffStats, type Repo, type Settings, type Workspace } from '@shared/types'

export interface Doc {
  kind: 'diff' | 'file'
  path: string
}

export type RightTab = 'artifacts' | 'files' | 'changes' | 'checks' | 'review'

interface UI {
  repos: Repo[]
  workspaces: Workspace[]
  chats: Chat[]
  items: Record<string, ChatItem[]>
  stats: Record<string, DiffStats>
  /** Tool calls waiting for the user's OK, per chat. */
  permissions: Record<string, PermissionRequest[]>
  selectedWs: string | null
  activeChat: Record<string, string>
  /** Diff or file open in the center instead of the chat, per workspace. */
  openDoc: Record<string, Doc | null>
  settings: Settings
  modal: 'settings' | 'palette' | 'create' | 'quickstart' | null
  recentPaths: string[]
  history: string[]
  historyIndex: number
  sidebarOpen: boolean
  rightOpen: boolean
  bottomOpen: boolean
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
  selectedWs: null,
  activeChat: {},
  openDoc: {},
  settings: { ...DEFAULT_SETTINGS },
  modal: null,
  recentPaths: [],
  history: [],
  historyIndex: -1,
  sidebarOpen: true,
  rightOpen: true,
  bottomOpen: true,
  rightTab: 'changes',
  error: null,

  hydrate: (s) => set({ repos: s.repos, workspaces: s.workspaces, chats: s.chats, settings: s.settings, recentPaths: s.recentPaths ?? [] }),
  selectWorkspace: (id, fromHistory) => {
    if (fromHistory || !id) return set({ selectedWs: id })
    const { history, historyIndex } = get()
    const h = [...history.slice(0, historyIndex + 1), id].slice(-50)
    set({ selectedWs: id, history: h, historyIndex: h.length - 1 })
  },
  back: () => {
    const { history, historyIndex } = get()
    if (historyIndex > 0) set({ historyIndex: historyIndex - 1, selectedWs: history[historyIndex - 1] })
  },
  forward: () => {
    const { history, historyIndex } = get()
    if (historyIndex < history.length - 1) set({ historyIndex: historyIndex + 1, selectedWs: history[historyIndex + 1] })
  },
  setActiveChat: (wsId, chatId) =>
    set((s) => ({ activeChat: { ...s.activeChat, [wsId]: chatId }, openDoc: { ...s.openDoc, [wsId]: null } })),
  upsertChat: (c) =>
    set((s) => {
      const i = s.chats.findIndex((x) => x.id === c.id)
      const chats = [...s.chats]
      if (i >= 0) chats[i] = c
      else chats.push(c)
      return { chats }
    }),
  removeChat: (id) => set((s) => ({ chats: s.chats.filter((c) => c.id !== id) })),
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

export async function newWorkspace(repoId: string) {
  try {
    const { workspace, chat } = await window.api.createWorkspace(repoId)
    await refreshState()
    useStore.getState().setActiveChat(workspace.id, chat.id)
    useStore.getState().selectWorkspace(workspace.id)
  } catch (e) {
    reportError(e)
  }
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

export function openDoc(wsId: string, doc: Doc | null) {
  const s = useStore.getState()
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
