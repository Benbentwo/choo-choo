import { DEFAULT_APPEARANCE, type AppearanceSettings } from './themes'
export interface Repo {
  id: string
  name: string
  path: string
  defaultBranch: string
  hidden?: boolean
}

export interface GithubRepo {
  nameWithOwner: string
  description: string | null
  private: boolean
  pushedAt: string
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
  archivedAt?: number
}

export type ModelId = 'opus' | 'sonnet' | 'haiku' | 'codex'
export type Effort = 'low' | 'medium' | 'high'
/** full: never ask (Conductor's default). edits: auto-accept file edits, ask for the rest. ask: ask before every tool that changes something. */
export type Permission = 'full' | 'edits' | 'ask'

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
  permission?: Permission
  /** Tools the user chose "Always allow" for in this chat. */
  alwaysAllow?: string[]
  /** This chat is a code review whose findings show in the Review tab and inline in diffs. */
  review?: boolean
  /** Plan mode: the agent researches and proposes a plan without editing files. */
  planMode?: boolean
  /** Extra folders the agent may read and edit. */
  additionalDirectories?: string[]
  /** Codex thread, when this chat runs on Codex. */
  codexThreadId?: string
  /** UUID of the last session entry of the last finished turn. */
  lastUuid?: string
  /** Set by a revert: the next turn forks the session at this entry. */
  forkAt?: string | null
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
  | {
      id: string
      kind: 'user'
      text: string
      /** Attached images as data URLs. */
      images?: string[]
      ts: number
      /** Worktree snapshot taken just before this turn ran. */
      checkpoint?: { head: string; tree: string }
      /** Session entry to fork from to drop this turn and everything after it. */
      resumeAt?: string
    }
  | { id: string; kind: 'note'; text: string; ts: number }
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

export interface Settings extends AppearanceSettings {
  defaultModel: ModelId
  defaultEffort: Effort
  defaultPermission: Permission
  /** Branch prefix; empty uses the GitHub user or git user.name. */
  branchPrefix: string
  /** Optional. Without it the agent uses your Claude Code login. */
  anthropicApiKey: string
  notifications: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: 'opus',
  defaultEffort: 'high',
  defaultPermission: 'full',
  branchPrefix: '',
  anthropicApiKey: '',
  notifications: true,
  ...DEFAULT_APPEARANCE
}

export interface AppState {
  repos: Repo[]
  workspaces: Workspace[]
  chats: Chat[]
  settings: Settings
  /** Folders added as projects, most recent first; shown under Recents in the Add project menu. */
  recentPaths?: string[]
}

export interface CheckRun {
  name: string
  state: string
  bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'
  link: string
  workflow: string
  description: string
}

export interface Artifact {
  path: string
  tool: string
  ts: number
}

export interface FilePreview {
  path: string
  content: string | null
  /** Why content is null: binary, too large or missing. */
  reason?: string
}

export interface PermissionRequest {
  id: string
  chatId: string
  toolName: string
  input: unknown
}

export type PermissionDecision = 'allow' | 'always' | 'deny'

export interface ChatEvent {
  chatId: string
  item?: ChatItem
  chat?: Chat
  permission?: PermissionRequest
  /** A pending permission request that no longer needs an answer. */
  permissionDone?: string
}

export interface Api {
  getState(): Promise<AppState>
  pickAndAddRepo(): Promise<Repo | null>
  addRepo(path: string): Promise<Repo>
  removeRepo(repoId: string): Promise<void>
  setRepoHidden(repoId: string, hidden: boolean): Promise<void>
  createWorkspace(repoId: string): Promise<{ workspace: Workspace; chat: Chat }>
  archiveWorkspace(workspaceId: string): Promise<void>
  restoreWorkspace(workspaceId: string): Promise<void>
  renameWorkspace(workspaceId: string, title: string): Promise<void>
  createChat(workspaceId: string): Promise<Chat>
  closeChat(chatId: string): Promise<void>
  getChatItems(chatId: string): Promise<ChatItem[]>
  updateChat(chatId: string, patch: Partial<Pick<Chat, 'model' | 'effort' | 'title' | 'unread' | 'planMode' | 'review' | 'permission'>>): Promise<Chat>
  respondPermission(requestId: string, decision: PermissionDecision): void
  pendingPermissions(): Promise<PermissionRequest[]>
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
  getChecks(workspaceId: string): Promise<CheckRun[]>
  rerunCheck(workspaceId: string, link: string): Promise<void>
  getArtifacts(workspaceId: string): Promise<Artifact[]>
  readFile(workspaceId: string, path: string): Promise<FilePreview>
  revertTo(chatId: string, itemId: string): Promise<string>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  /** Interface zoom, 1 = 100%. */
  setZoom(factor: number): void
  cloneRepo(url: string): Promise<Repo>
  listGithubRepos(): Promise<GithubRepo[]>
  quickStart(name: string): Promise<Repo>
  onNavigate(cb: (workspaceId: string, chatId: string) => void): () => void
  sendMessage(chatId: string, text: string, images?: string[]): Promise<void>
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
  onUpdateReady(cb: (version: string) => void): () => void
  installUpdate(): Promise<void>
}

export interface ReviewFinding {
  file: string
  line?: number
  severity: 'high' | 'medium' | 'low'
  message: string
  fix?: string
}
