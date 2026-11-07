import { create } from 'zustand'
import { readCachedAppearance } from './appearanceCache'
import { DEFAULT_SETTINGS, type BackgroundTask, type Effort, type ModelId, type ModelDetails, type WorkspaceSource, type PermissionRequest, type AppState, type Chat, type ChatItem, type DiffStats, type Repo, type RepoGroup, type Settings, type Workspace, type Leftover } from '@shared/types'

export interface Doc {
  kind: 'diff' | 'file'
  path: string
  /** Line to scroll to in a file. */
  line?: number
}

/** Which list the ⌘K palette opens on. */
export type PaletteMode = 'all' | 'files' | 'grep'

export type RightTab = 'artifacts' | 'files' | 'changes' | 'checks' | 'graphs' | 'review'

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
  selectedWs: string | null
  activeChat: Record<string, string>
  /** Diff or file open in the center instead of the chat, per workspace. */
  openDoc: Record<string, Doc | null>
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
  settingsTab: 'general' | 'projects' | 'agents' | 'mcp' | 'plugins' | 'integrations' | 'updates' | 'telemetry' | 'appearance'
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
  activeChat: {},
  openDoc: {},
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
  rightTab: 'changes',
  error: null,

  hydrate: (s) => set({ repos: s.repos, workspaces: s.workspaces, chats: s.chats, settings: s.settings, recentPaths: s.recentPaths ?? [], groups: s.groups ?? [], leftovers: s.leftovers ?? [] }),
  selectWorkspace: (id, fromHistory) => {
    if (fromHistory || !id) return set({ selectedWs: id, draftRepo: null })
    const { history, historyIndex } = get()
    const h = [...history.slice(0, historyIndex + 1), id].slice(-50)
    set({ selectedWs: id, draftRepo: null, history: h, historyIndex: h.length - 1 })
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

/** Opens the new-workspace composer for a repo. The worktree is created when the person presses Create. */
export function newWorkspace(repoId: string) {
  useStore.getState().set({ selectedWs: null, draftRepo: repoId })
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
export async function openGroupOrchestrator(groupId: string) {
  try {
    const { workspace, chat } = await window.api.openGroupOrchestrator(groupId)
    await refreshState()
    useStore.getState().setActiveChat(workspace.id, chat.id)
    useStore.getState().selectWorkspace(workspace.id)
  } catch (e) {
    reportError(e)
  }
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
