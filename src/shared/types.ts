import { DEFAULT_APPEARANCE, type AppearanceSettings } from './themes'
import type { ReflectProposal, ReflectResult } from './reflect'
export interface Repo {
  id: string
  name: string
  path: string
  defaultBranch: string
  hidden?: boolean
  /** Scripts set in the app (e.g. imported from Conductor); a choo-choo.json or conductor.json in the repo wins. */
  scripts?: Scripts
}

/** What a new workspace starts from, besides a fresh branch off the default branch. */
export type WorkspaceSource = { kind: 'pr'; number: number } | { kind: 'branch'; name: string } | { kind: 'issue'; number: number } | { kind: 'notion'; id: string }

export interface SourceOption {
  source: WorkspaceSource
  title: string
  detail: string
}

export interface ImportPreview {
  found: boolean
  repos: { name: string; path: string; status: 'new' | 'already' | 'missing'; hasScripts: boolean }[]
  workspaces: { repo: string; name: string; branch: string; path: string; chats: number; status: 'new' | 'already' }[]
  archivedSkipped: number
  settings: { label: string; value: string }[]
  /** Folder Conductor creates workspaces in. */
  workspacesRoot?: string
}

export interface ImportResult {
  repos: number
  workspaces: number
  chats: number
  messages: number
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
  /** Where the archived worktree was moved, until retention cleanup deletes it. */
  archivePath?: string
  /** The repo's orchestrator: runs in the main checkout and directs other workspaces. */
  orchestrator?: boolean
  /** Started by the orchestrator. */
  orchestrated?: boolean
  /** Set while this workspace is shared with coworkers. */
  share?: { id: string; link: string; sharedAt: number; autoSync: boolean }
  /** Set when this workspace was opened from a coworker's share. */
  importedShare?: { id: string; link: string; sharedBy: string; sharedAt: number }
}

/** A share found in a repository's remote. */
export interface ShareInfo {
  id: string
  title: string
  branch: string
  sharedBy: string
  sharedAt: number
  chats: number
}

export interface ShareStatus {
  link: string
  sharedAt: number
  autoSync: boolean
  /** public, private or internal, when gh can tell. A share in a public repo is public. */
  visibility?: string
}

export type ModelId = 'opus' | 'fable' | 'sonnet' | 'haiku' | 'codex'

/** What a Claude model alias resolves to right now, e.g. opus → Opus 5.5. */
export interface ModelDetails {
  displayName: string
  description: string
  resolvedModel?: string
}
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
  /** Which kind of review, when `review` is set. Missing means a code review. */
  reviewKind?: 'code' | 'security'
  /** Per-chat advisor switch. Missing means on whenever the advisor is enabled in Settings. */
  advisor?: boolean
  /** The advisor raised a blocker the user hasn't acted on yet. */
  advisorBlocker?: boolean
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
  /** Transcript from a coworker's share, sent ahead of the first message here. */
  handoff?: string
  /** The sharer's chat id, so refreshing a share updates the right tab. */
  sharedChatId?: string
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
      /** Sent automatically to pass on the advisor's feedback. */
      fromAdvisor?: boolean
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
      /** Set when a subagent made this call: the id of the Task/Agent call that started it. */
      parentId?: string
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
  | {
      id: string
      kind: 'advisor'
      /** Empty while the advisor is still reviewing. */
      text: string
      pending?: boolean
      /** The advisor found nothing worth raising. */
      silent?: boolean
      /** At least one note is a blocker. */
      blocker?: boolean
      /** What the user did with the notes. */
      resolved?: 'sent' | 'dismissed'
      ts: number
    }

export interface FileChange {
  path: string
  /** A added, M modified, D deleted, R renamed, U untracked */
  status: 'A' | 'M' | 'D' | 'R' | 'U'
  additions: number
  deletions: number
}

export interface WorkspacePreview {
  /** Plain-text start of the latest message. */
  snippet: string
  lastActive: number
}

export interface GrepHit {
  path: string
  line: number
  text: string
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
  /** Where new workspaces go; empty means ~/choo-choo/workspaces. */
  workspacesRoot?: string
  /** Days to keep archived worktrees before deleting them. 0 keeps them forever. */
  archiveRetentionDays: number
  /** Which Claude Code to run: the copy bundled with the app, or the `claude` you installed. */
  claudeBinary: 'bundled' | 'installed'
  /** Optional agents and features, adapted from oh-my-pi. All off by default. */
  extras: Extras
  /** Give agents Notion's MCP tools when Notion is connected. */
  notionAgentTools: boolean
}

export type IntegrationId = 'linear' | 'notion'

export interface IntegrationStatus {
  id: IntegrationId
  label: string
  description: string
  connected: boolean
  /** Who is signed in, when the provider tells us. */
  account?: string
}

export type ExtraAgentId = 'scout' | 'reviewer' | 'securityReviewer' | 'quickWorker'

export interface Extras {
  /** Subagents the main Claude agent can hand work to. */
  agents: Record<ExtraAgentId, boolean>
  /** A second model reviews each finished turn and gives advice. */
  advisor: boolean
  advisorModel: 'opus' | 'sonnet' | 'haiku'
  /** Send blocker-level advice back to the agent automatically. */
  advisorSteer: boolean
  /** Have the reviewer check the changes when you click Create PR. Needs the reviewer agent. */
  reviewBeforePr: boolean
}

export const DEFAULT_EXTRAS: Extras = {
  agents: { scout: false, reviewer: false, securityReviewer: false, quickWorker: false },
  advisor: false,
  advisorModel: 'sonnet',
  advisorSteer: false,
  reviewBeforePr: true
}

/** Fills in fields an older or partial save is missing. */
export function normalizeExtras(e: Partial<Extras> | undefined): Extras {
  return { ...DEFAULT_EXTRAS, ...e, agents: { ...DEFAULT_EXTRAS.agents, ...e?.agents } }
}

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: 'opus',
  defaultEffort: 'high',
  defaultPermission: 'full',
  branchPrefix: '',
  anthropicApiKey: '',
  notifications: true,
  claudeBinary: 'bundled',
  extras: DEFAULT_EXTRAS,
  notionAgentTools: true,
  archiveRetentionDays: 30,
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
  /** `folders` are extra directories the first chat may read and edit (linked workspaces, added folders). */
  createWorkspace(repoId: string, source?: WorkspaceSource, folders?: string[]): Promise<{ workspace: Workspace; chat: Chat; context?: string }>
  listSources(repoId: string, kind: WorkspaceSource['kind'], query: string): Promise<SourceOption[]>
  listIntegrations(): Promise<IntegrationStatus[]>
  /** Opens the provider's sign-in page in the browser and resolves once signed in. */
  connectIntegration(id: IntegrationId): Promise<IntegrationStatus[]>
  disconnectIntegration(id: IntegrationId): Promise<IntegrationStatus[]>
  /** Opens the repo's orchestrator, creating it the first time. */
  openOrchestrator(repoId: string): Promise<{ workspace: Workspace; chat: Chat }>
  archiveWorkspace(workspaceId: string): Promise<void>
  restoreWorkspace(workspaceId: string): Promise<void>
  /** Reviews the workspace's chats for friction and suggests agent-setup changes. Writes nothing. */
  reflect(workspaceId: string, feedback?: string): Promise<ReflectResult>
  cancelReflect(workspaceId: string): Promise<void>
  /** Writes accepted proposals to a new workspace and asks its agent to open a PR. */
  applyReflection(workspaceId: string, proposals: ReflectProposal[]): Promise<{ workspace: Workspace; chat: Chat }>
  workspacePreview(workspaceId: string): Promise<WorkspacePreview>
  /** Last chat activity per workspace id. */
  workspaceActivity(): Promise<Record<string, number>>
  searchFiles(workspaceId: string, query: string): Promise<GrepHit[]>
  /** Deletes archived worktrees past the retention period now. Returns how many. */
  cleanupArchives(): Promise<number>
  renameWorkspace(workspaceId: string, title: string): Promise<void>
  createChat(workspaceId: string): Promise<Chat>
  closeChat(chatId: string): Promise<void>
  getChatItems(chatId: string): Promise<ChatItem[]>
  updateChat(chatId: string, patch: Partial<Pick<Chat, 'model' | 'effort' | 'title' | 'unread' | 'planMode' | 'review' | 'reviewKind' | 'permission' | 'advisor' | 'advisorBlocker'>>): Promise<Chat>
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
  /** Clones into `dir` (default ~/choo-choo/repos); `~` is expanded. */
  cloneRepo(url: string, dir?: string): Promise<Repo>
  pickFolder(): Promise<string | null>
  pickFiles(): Promise<string[]>
  /** Current versions behind the Claude model aliases, from the Agent SDK. Empty if it couldn't be read. */
  modelDetails(): Promise<Partial<Record<ModelId, ModelDetails>>>
  previewConductorImport(): Promise<ImportPreview>
  importFromConductor(opts: { useWorkspacesRoot: boolean }): Promise<ImportResult>
  listGithubRepos(): Promise<GithubRepo[]>
  quickStart(name: string): Promise<Repo>
  onNavigate(cb: (workspaceId: string, chatId: string) => void): () => void
  sendMessage(chatId: string, text: string, images?: string[]): Promise<void>
  stopChat(chatId: string): Promise<void>
  /** Sends the advisor's notes to the agent, or dismisses them. */
  actOnAdvice(chatId: string, itemId: string, action: 'send' | 'dismiss'): Promise<void>
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
  shareStatus(workspaceId: string): Promise<ShareStatus | null>
  shareWorkspace(workspaceId: string): Promise<ShareStatus>
  setShareAutoSync(workspaceId: string, on: boolean): Promise<void>
  unshareWorkspace(workspaceId: string): Promise<void>
  listShares(): Promise<{ repoId: string; repoName: string; shares: ShareInfo[] }[]>
  openShare(link: string): Promise<{ workspace: Workspace; chat: Chat }>
  openShareById(repoId: string, id: string): Promise<{ workspace: Workspace; chat: Chat }>
  refreshShare(workspaceId: string): Promise<boolean>
  onOpenShareLink(cb: (link: string) => void): () => void
}

export interface ReviewFinding {
  file: string
  line?: number
  severity: 'high' | 'medium' | 'low'
  message: string
  fix?: string
}
