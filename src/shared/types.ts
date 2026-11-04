export interface Repo {
  id: string
  name: string
  path: string
  defaultBranch: string
  hidden?: boolean
}

export interface Workspace {
  id: string
  repoId: string
  /** City name, also the worktree folder name. */
  name: string
  branch: string
  baseRef: string
  path: string
  title: string
  /** Set once the first prompt has named the workspace. */
  named?: boolean
  createdAt: number
  archived?: boolean
}

export type ModelId = 'opus' | 'sonnet' | 'haiku'
export type Effort = 'low' | 'medium' | 'high'

export interface Chat {
  id: string
  workspaceId: string
  title: string
  model: ModelId
  effort: Effort
  sdkSessionId?: string
  status: 'idle' | 'running' | 'error'
  /** Finished a turn the user has not looked at yet. */
  unread?: boolean
  /** Extra folders the agent may read and edit. */
  additionalDirectories?: string[]
  createdAt: number
}

export interface Scripts {
  setup?: string
  run?: string
  archive?: string
  /** Where the scripts came from, for display. */
  source?: string
}

export type ScriptKind = 'setup' | 'run'

export interface PrInfo {
  number: number
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  title: string
  mergeable?: string
}

export interface SlashCommandInfo {
  name: string
  description?: string
}

export type ChatItem =
  | { id: string; kind: 'user'; text: string; ts: number }
  | { id: string; kind: 'assistant'; text: string; streaming?: boolean; ts: number }
  | {
      id: string
      kind: 'tool'
      name: string
      input: unknown
      result?: string
      isError?: boolean
      ts: number
    }
  | {
      id: string
      kind: 'result'
      ok: boolean
      costUsd?: number
      durationMs?: number
      turns?: number
      ts: number
    }
  | { id: string; kind: 'error'; text: string; ts: number }

export interface FileChange {
  path: string
  /** A added, M modified, D deleted, R renamed, U untracked */
  status: 'A' | 'M' | 'D' | 'R' | 'U'
  additions: number
  deletions: number
}

export interface DiffStats {
  additions: number
  deletions: number
  files: number
}

export interface AppState {
  repos: Repo[]
  workspaces: Workspace[]
  chats: Chat[]
}

export interface ChatEvent {
  chatId: string
  item?: ChatItem
  chat?: Chat
}

export interface Api {
  getState(): Promise<AppState>
  pickAndAddRepo(): Promise<Repo | null>
  addRepo(path: string): Promise<Repo>
  removeRepo(repoId: string): Promise<void>
  setRepoHidden(repoId: string, hidden: boolean): Promise<void>
  createWorkspace(repoId: string): Promise<{ workspace: Workspace; chat: Chat }>
  archiveWorkspace(workspaceId: string): Promise<void>
  renameWorkspace(workspaceId: string, title: string): Promise<void>
  createChat(workspaceId: string): Promise<Chat>
  closeChat(chatId: string): Promise<void>
  getChatItems(chatId: string): Promise<ChatItem[]>
  updateChat(chatId: string, patch: Partial<Pick<Chat, 'model' | 'effort' | 'title' | 'unread'>>): Promise<Chat>
  addChatFolder(chatId: string): Promise<Chat>
  removeChatFolder(chatId: string, dir: string): Promise<Chat>
  listFiles(workspaceId: string): Promise<string[]>
  listCommands(workspaceId: string): Promise<SlashCommandInfo[]>
  getScripts(workspaceId: string): Promise<Scripts>
  runScript(workspaceId: string, kind: ScriptKind): Promise<boolean>
  stopScript(workspaceId: string, kind: ScriptKind): void
  isScriptRunning(workspaceId: string, kind: ScriptKind): Promise<boolean>
  getPr(workspaceId: string): Promise<PrInfo | null>
  mergePr(workspaceId: string): Promise<void>
  sendMessage(chatId: string, text: string): Promise<void>
  stopChat(chatId: string): Promise<void>
  onChatEvent(cb: (e: ChatEvent) => void): () => void
  getChanges(workspaceId: string): Promise<FileChange[]>
  getDiffStats(workspaceId: string): Promise<DiffStats>
  getFileDiff(workspaceId: string, file: string): Promise<string>
  ptyCreate(id: string, workspaceId: string): Promise<string>
  ptyAttach(id: string): Promise<string>
  onScriptStarted(cb: (workspaceId: string, kind: ScriptKind) => void): () => void
  ptyWrite(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  ptyKill(id: string): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string, code: number) => void): () => void
  openExternal(url: string): Promise<void>
  revealInFinder(path: string): Promise<void>
  onMenu(cb: (action: string) => void): () => void
  onStateChanged(cb: () => void): () => void
}
