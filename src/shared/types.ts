import { DEFAULT_APPEARANCE, type AppearanceSettings } from './themes'
import type { ReflectProposal, ReflectResult } from './reflect'
import type { UpdateStatus } from './updates'
import type { InboxPr, PrInbox } from './prInbox'
import type { Automation, AutomationRun, GithubWatchState } from './automations'
import type { UsageDashboard, UsageHistorySettings, WindowDetail } from './usageHistory'
import type { ChatPause, ContinueSettings, QueueItem, ResetLog, UsageLimitState } from './continueWork'
import type { Layout, SavedLayout } from './layout'
import type { AddonActionContext, AddonCallResult, AddonContext, AddonDevResult, AddonGrant, AddonInfo, AddonReloaded, AddonSource, AvailableAddon, AddonAppEvent, AddonToolCall, PinStatus } from './addons'
import type { PrDiffTarget, PrHeadSync, PrReviewInfo, ReviewDraft, ReviewEvent } from './prReview'
import type { Interdiff, ReviewSettings } from './reviewUpdates'
import type { ReviewWatchState } from './reviewWatch'
export interface Repo {
  id: string
  name: string
  path: string
  defaultBranch: string
  hidden?: boolean
  /** GitHub owner (user or org) from the origin remote, for the project's avatar. Empty string when it isn't on GitHub. */
  githubOwner?: string
  /** Scripts set in the app (e.g. imported from Conductor); a choo-choo.json or conductor.json in the repo wins. */
  scripts?: Scripts
  /** Extra or replacement system prompt for agents in this repo. */
  systemPrompt?: PromptCustom
}

/**
 * Custom instructions for Claude agents. "append" keeps Claude Code's own system prompt
 * and adds the text after it; "replace" sends only the text.
 */
export interface PromptCustom {
  mode: 'append' | 'replace'
  text: string
}

/** A project group: several repos that share one orchestrator and one memory. */
export interface RepoGroup {
  id: string
  name: string
  repoIds: string[]
  createdAt: number
  /** Icon name from the project icon set (renderer ProjectIcon.tsx). Missing: the orchestrator mark. */
  icon?: string
  /** A PROJECT_COLORS id. Missing: the theme accent. */
  color?: string
}

/** What a new workspace starts from, besides a fresh branch off the default branch. */
export type WorkspaceSource =
  | { kind: 'pr'; number: number }
  | { kind: 'branch'; name: string }
  | { kind: 'issue'; number: number }
  /** A Notion page (often a task in a database), by its id or URL. */
  | { kind: 'notion'; id: string }

/** Services you sign in to from Settings > Integrations. */
export type IntegrationId = 'linear' | 'notion'

export interface IntegrationStatus {
  id: IntegrationId
  label: string
  description: string
  connected: boolean
  /** Who is signed in, when the service tells us. */
  account?: string
  /** False when this build has no OAuth app for the service, so sign-in can't work yet. */
  configured: boolean
}

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
  /**
   * The PR this workspace's branch belongs to, when known by number: opened from a PR, or the
   * agent ran `gh pr checkout`. Fork PRs live on a local branch (pr-12) that GitHub can't find by name.
   */
  prNumber?: number
  baseRef: string
  path: string
  title: string
  /** Set once the first prompt has named the workspace, or the person renamed it. */
  named?: boolean
  /** Position when the sidebar is sorted by hand (lower first). Missing for workspaces never dragged. */
  order?: number
  createdAt: number
  archived?: boolean
  archivedAt?: number
  /** Where the archived worktree was moved, until retention cleanup deletes it. */
  archivePath?: string
  /** The repo's orchestrator: runs in the main checkout and directs other workspaces. */
  orchestrator?: boolean
  /** Started by the orchestrator. */
  orchestrated?: boolean
  /** Which orchestrator started it: a repo id or a project group id. */
  orchestratorId?: string
  /** Set on a project group's orchestrator. It runs in the first repo's checkout. */
  groupId?: string
  /** The project thread (a chat on the project's orchestrator) that started this workspace. Its updates go there. */
  threadId?: string
  /** The add-on that started this workspace, by plugin id. */
  addonId?: string
  /** The automation whose run opened this workspace. */
  automationId?: string
  /** Set while this workspace is shared with coworkers. */
  share?: { id: string; link: string; sharedAt: number; autoSync: boolean }
  /** Set when this workspace was opened from a coworker's share. */
  importedShare?: { id: string; link: string; sharedBy: string; sharedAt: number }
  /** Set when the workspace holds a stack of PRs, one branch each. `branch` is the one checked out. */
  stack?: Stack
}

/** One PR's branch in a stack. */
export interface StackLayer {
  branch: string
  /** The parent's commit this branch was last built on, so a restack moves only this branch's own commits. */
  parentSha?: string
  /** Last PR seen for the branch, so the sidebar can show it without asking GitHub. */
  pr?: { number: number; title: string }
}

/** Several PRs for one feature, each built on the one below it, all in one worktree. See docs/prd/stacked-prs.md. */
export interface Stack {
  /** Bottom (built on the base branch) to top. */
  layers: StackLayer[]
  /** Restack the PRs above after each agent turn that changed a lower one. */
  autoRestack: boolean
  /** Set while a rebase stopped part way, so the next restack can pick up where it left off. */
  restacking?: { branch: string; newParent: string; home: string }
}

export interface StackLayerStatus {
  branch: string
  sha: string
  /** The branch below it (or the base) has commits this one isn't built on yet. */
  behind: boolean
  /** Commits on this branch that are not on the one below. */
  commits: number
  /** On origin, and whether origin has a different commit. */
  pushed: boolean
  unpushed: boolean
  pr: (PrInfo & { baseRefName?: string }) | null
  /** Unresolved review feedback on the PR. */
  comments: number
  checks: { total: number; failed: number; pending: number }
}

/** A run of steps the app drives across the stack: addressing feedback, or getting past a restack conflict. */
export interface StackJob {
  kind: 'feedback' | 'restack'
  chatId: string
  steps: { label: string; state: 'todo' | 'doing' | 'done' | 'failed' }[]
  /** Waiting for the person to continue (the "ask me before each PR" option). */
  paused?: boolean
  error?: string
}

export interface StackStatus {
  current: string
  base: string
  /** Uncommitted changes in the worktree. Switching PRs and restacking wait for these to be committed. */
  dirty: boolean
  /** A rebase stopped on conflicts in these files. */
  conflict?: { branch: string; files: string[] }
  layers: StackLayerStatus[]
  job?: StackJob
  /**
   * The stack as GitHub knows it (GitHub's stacked pull requests), or null when it isn't linked yet.
   * 'unavailable' when GitHub has no stacks for this repo (the feature is off, or `gh` can't reach it).
   */
  github: GithubStack | null | 'unavailable'
  /** The `gh stack` extension is installed; merging a linked stack goes through it. */
  ghStackCli: boolean
}

/** A pull request stack on GitHub: PR numbers bottom to top. */
export interface GithubStack {
  number: number
  prs: number[]
}

export interface MergeThroughResult {
  /** PRs that merged, bottom first. */
  merged: number[]
  /** The repo uses a merge queue: the PRs were queued and merge later. */
  queued: boolean
  /** Merged branches dropped from the bottom of the stack. */
  dropped: string[]
}

export interface FeedbackOptions {
  /** Branches to address, any order; they run bottom first. */
  branches: string[]
  askEach: boolean
  reply: boolean
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
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/**
 * full: never ask (Conductor's default). auto: Claude Code's auto mode, where a classifier approves safe
 * calls and blocks risky ones. edits: auto-accept file edits, ask for the rest. ask: ask before every tool that changes something.
 */
export type Permission = 'full' | 'auto' | 'edits' | 'ask'

/** A /goal Claude Code is working toward, as its evaluator last reported it. */
export interface ChatGoal {
  condition: string
  setAt: number
  /** Turns the evaluator has checked. */
  iterations: number
  /** The evaluator's latest reason for "not yet". */
  lastReason?: string
}

/** A background shell, subagent or workflow Claude Code is running during a turn. */
export interface BackgroundTask {
  id: string
  description: string
  /** local_bash, local_agent, local_workflow, mcp_task… */
  type?: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  startedAt: number
  summary?: string
}

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
  /** A thread in a project: one topic's conversation with the project's orchestrator. See docs/prd/projects.md. */
  thread?: boolean
  /** The automation whose runs post here: a thread on a project's orchestrator, or a chat on a repo's. */
  automationId?: string
  /** Context window of the model, as Claude Code last reported it. */
  contextWindow?: number
  /** The model Claude Code last reported running this chat on (e.g. claude-opus-5-5). */
  reportedModel?: string
  /** Fast mode: faster output on models that support it, at a higher price. */
  fast?: boolean
  /** Stop a message's run once it has cost this many dollars. Missing uses the Settings default. */
  budgetUsd?: number
  /** Claude Code output style, such as Explanatory or Learning. Missing means the default. */
  outputStyle?: string
  /** Set while a /goal is active. */
  goal?: ChatGoal
  /** Set while the session continues somewhere else, such as on your phone through Remote Control. */
  remote?: ChatRemote
  /** The last turn stopped on a plan usage limit. See shared/continueWork.ts. */
  paused?: ChatPause
  createdAt: number
}

export interface ChatRemote {
  /**
   * phone: Remote Control on this Mac. cloud: a Claude Code cloud session on Anthropic's machines.
   * desktop: handed to the Claude desktop app with `claude --desktop --resume`.
   */
  kind: 'phone' | 'cloud' | 'desktop'
  startedAt: number
  /** Cloud session id (session_…), for follow-ups and teleport. */
  sessionId?: string
  /** Pulling the cloud session back with `claude --teleport` right now. */
  teleporting?: boolean
  /** The claude.ai/code link for the session, once Claude Code prints it. */
  url?: string
  /** `url` is the claude.ai/code session list, because Claude Code didn't print the session's own link. */
  listOnly?: boolean
  /** QR code for `url`, as an SVG data URL. */
  qr?: string
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
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or empty when the repo needs no review. */
  reviewDecision?: string
  /** GitHub's overall verdict: CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, … */
  mergeStateStatus?: string
  /** The branch the pull request is made from. */
  headRefName?: string
  /** The branch the pull request merges into. */
  baseRefName?: string
  isCrossRepository?: boolean
  headRepositoryOwner?: { login: string }
  /** Commits on the base branch that this branch doesn't have yet. Only filled for the PR button. */
  behindBy?: number
  /** The PR's head commit. */
  headRefOid?: string
}

/** One piece of review feedback on a PR, ready to hand to the agent. */
export interface PrComment {
  id: string
  /** inline: an unresolved review thread on a line; review: a review's summary; comment: a conversation comment. */
  kind: 'inline' | 'review' | 'comment'
  /** Inline only: the review thread, for replying and resolving. */
  threadId?: string
  /** Inline only: which side of the diff the thread is on. */
  side?: 'new' | 'old'
  author: string
  body: string
  /** For threads, the time of the newest reply. */
  createdAt: string
  url: string
  path?: string
  line?: number
  startLine?: number
  outdated?: boolean
  diffHunk?: string
  /** Review state, e.g. CHANGES_REQUESTED or COMMENTED. */
  state?: string
  replies?: { author: string; body: string }[]
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
      /** Sent while Claude was working: folded into that turn (steer) or run after it (queue). */
      sentWhileRunning?: 'steer' | 'queue'
    }
  | { id: string; kind: 'note'; text: string; ts: number }
  | {
      id: string
      kind: 'model'
      /** The model the chat switched to. */
      model: ModelId
      /** The model before the switch, when the person picked it. */
      from?: ModelId
      /** The model Claude Code reported running the next turn on (e.g. claude-sonnet-5-5). */
      resolved?: string
      ts: number
    }
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
      /** Who wrote the notes: the advisor (default), or fresh reviewers checking a plan. */
      source?: 'planReview'
      /** For a plan review, the plan card it reviewed. */
      planItemId?: string
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
  /** A message sent while Claude is working: steer folds it into the running turn, queue sends it after. */
  whileRunning?: 'steer' | 'queue'
  /** How chats show Claude's work. Compact folds each stretch of tool calls into one collapsed Working row. */
  chatFormat?: 'full' | 'compact'
  /** Orgs ("owner") or repos ("owner/repo") left off the PRs page on this machine. */
  prsHidden?: string[]
  /** Sidebar rows hidden with right-click > Hide from sidebar (keys from shared/sidebarHidden.ts). */
  sidebarHidden?: string[]
  /** Projects collapsed in the sidebar (repo ids): only the project row shows. */
  sidebarCollapsed?: string[]
  /** How work under a project thread's repo is ordered (shared/sidebarOrder.ts). Newest first when unset. */
  projectWorkSort?: 'newest' | 'oldest' | 'pr' | 'title'
  /** Split panels: how the center is divided, restored on the next start (shared/layout.ts). */
  layout?: Layout | null
  /** Layouts saved by name from the layout menu. */
  savedLayouts?: SavedLayout[]
  /** Spend cap per message for new chats, in dollars. 0 means no cap. */
  defaultBudgetUsd?: number
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
  /** Check GitHub Releases for new Choo Choo versions. Checking by hand still works when off. */
  checkAppUpdates: boolean
  /** stable: published releases. beta: also the signed prerelease built from every merge to main. */
  updateChannel: 'stable' | 'beta'
  /** Check npm for new Claude Code versions. Checking by hand still works when off. */
  checkClaudeUpdates: boolean
  /** Optional agents and features, adapted from oh-my-pi. All off by default. */
  extras: Extras
  /** Give agents Notion's MCP tools when Notion is connected. */
  notionAgentTools: boolean
  /** Instructions for every Claude agent. A repo's own prompt adds to or replaces this. */
  systemPrompt?: PromptCustom
  /** OpenTelemetry export for Claude agents. Off by default. */
  telemetry: Telemetry
  /** Wake an idle orchestrator when a workspace it started finishes, so it checks and reports back. */
  orchestratorAutoUpdates: boolean
  /** Experimental: project groups become projects, with threads and a repo › PR tree in the sidebar. */
  experimentalProjects?: boolean
  /** Continue work: resuming chats when the usage window resets. See shared/continueWork.ts. */
  continueWork?: Partial<ContinueSettings>
  /** Usage history behind the Usage page. On by default, kept 12 months. See shared/usageHistory.ts. */
  usageHistory?: Partial<UsageHistorySettings>
  /** Add-ons turned on in Choo Choo and the permissions agreed to, by plugin id. */
  addons?: Record<string, AddonGrant>
  /** Review updates: notifications for PRs you review, and the since-your-review diff (shared/reviewUpdates.ts). */
  reviews?: Partial<ReviewSettings>
  /** Recommended add-ons the person said "not now" to, by project id. */
  addonPinsDismissed?: Record<string, string[]>
}

export type ExtraAgentId = 'scout' | 'reviewer' | 'securityReviewer' | 'quickWorker'

export interface Extras {
  /** Subagents the main Claude agent can hand work to. */
  agents: Record<ExtraAgentId, boolean>
  /** A second model reviews each finished turn and gives advice. */
  advisor: boolean
  advisorModel: 'fable' | 'opus' | 'sonnet' | 'haiku'
  /** Send blocker-level advice back to the agent automatically. */
  advisorSteer: boolean
  /** Have the reviewer check the changes when you click Create PR. Needs the reviewer agent. */
  reviewBeforePr: boolean
  /**
   * Claude Code's own advisor tool: Claude consults a stronger model mid-task, when it decides to.
   * 'inherit' leaves it to the advisorModel in the user's Claude Code settings.
   */
  claudeAdvisor: ClaudeAdvisor
}

export type ClaudeAdvisor = 'inherit' | 'off' | 'fable' | 'opus' | 'sonnet'

export const DEFAULT_EXTRAS: Extras = {
  agents: { scout: false, reviewer: false, securityReviewer: false, quickWorker: false },
  advisor: false,
  advisorModel: 'sonnet',
  advisorSteer: false,
  reviewBeforePr: true,
  claudeAdvisor: 'inherit'
}

/** Fills in fields an older or partial save is missing. */
export function normalizeExtras(e: Partial<Extras> | undefined): Extras {
  return { ...DEFAULT_EXTRAS, ...e, agents: { ...DEFAULT_EXTRAS.agents, ...e?.agents } }
}

export interface Telemetry {
  enabled: boolean
  /** OTLP collector base URL, e.g. http://localhost:4318. */
  endpoint: string
  protocol: 'http/protobuf' | 'http/json' | 'grpc'
  /** Comma-separated key=value pairs, e.g. Authorization=Bearer token. */
  headers: string
  metrics: boolean
  logs: boolean
  /** Spans per turn, model request and tool call. Beta in Claude Code. */
  traces: boolean
  serviceName: string
  /** Extra resource attributes, key=value pairs separated by commas. */
  resourceAttributes: string
  /** Content opt-ins. Off by default because they export what the agent reads and writes. */
  logPrompts: boolean
  logToolDetails: boolean
  logToolContent: boolean
}

export const DEFAULT_TELEMETRY: Telemetry = {
  enabled: false,
  endpoint: 'http://localhost:4318',
  protocol: 'http/protobuf',
  headers: '',
  metrics: true,
  logs: true,
  traces: true,
  serviceName: 'choo-choo',
  resourceAttributes: '',
  logPrompts: false,
  logToolDetails: false,
  logToolContent: false
}

export function normalizeTelemetry(t: Partial<Telemetry> | undefined): Telemetry {
  return { ...DEFAULT_TELEMETRY, ...t }
}

/**
 * Env vars that make the Claude Code process export OpenTelemetry data.
 * `tags` become resource attributes, so a backend can filter by repo or workspace.
 * See https://code.claude.com/docs/en/agent-sdk/observability
 */
export function telemetryEnv(t: Telemetry, tags: Record<string, string> = {}): Record<string, string> {
  if (!t.enabled || !t.endpoint.trim() || !(t.metrics || t.logs || t.traces)) return {}
  // Never use the console exporter: stdout is the SDK's message channel.
  const env: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_EXPORTER_OTLP_PROTOCOL: t.protocol,
    OTEL_EXPORTER_OTLP_ENDPOINT: t.endpoint.trim(),
    OTEL_METRICS_EXPORTER: t.metrics ? 'otlp' : 'none',
    OTEL_LOGS_EXPORTER: t.logs ? 'otlp' : 'none',
    OTEL_TRACES_EXPORTER: t.traces ? 'otlp' : 'none',
    OTEL_SERVICE_NAME: t.serviceName.trim() || DEFAULT_TELEMETRY.serviceName,
    // Agent turns are short; flush often so data isn't lost when a turn ends.
    OTEL_METRIC_EXPORT_INTERVAL: '10000',
    OTEL_LOGS_EXPORT_INTERVAL: '2000',
    OTEL_TRACES_EXPORT_INTERVAL: '2000'
  }
  if (t.traces) env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA = '1'
  if (t.headers.trim()) env.OTEL_EXPORTER_OTLP_HEADERS = t.headers.trim()
  const attrs = [
    ...Object.entries(tags)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`),
    ...t.resourceAttributes
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes('='))
  ]
  if (attrs.length) env.OTEL_RESOURCE_ATTRIBUTES = attrs.join(',')
  if (t.logPrompts) env.OTEL_LOG_USER_PROMPTS = '1'
  if (t.logToolDetails) env.OTEL_LOG_TOOL_DETAILS = '1'
  if (t.logToolContent && t.traces) env.OTEL_LOG_TOOL_CONTENT = '1'
  return env
}

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: 'opus',
  defaultEffort: 'high',
  defaultPermission: 'full',
  whileRunning: 'steer',
  chatFormat: 'full',
  branchPrefix: '',
  anthropicApiKey: '',
  notifications: true,
  orchestratorAutoUpdates: true,
  claudeBinary: 'bundled',
  checkAppUpdates: true,
  updateChannel: 'stable',
  checkClaudeUpdates: true,
  extras: DEFAULT_EXTRAS,
  notionAgentTools: true,
  telemetry: DEFAULT_TELEMETRY,
  archiveRetentionDays: 30,
  ...DEFAULT_APPEARANCE
}

export interface AppState {
  repos: Repo[]
  workspaces: Workspace[]
  chats: Chat[]
  settings: Settings
  /** Project groups, each with its own orchestrator. */
  groups?: RepoGroup[]
  /** Folders added as projects, most recent first; shown under Recents in the Add project menu. */
  recentPaths?: string[]
  /** Workspace folders left on disk when a project was removed without cleanup; Settings > Projects can delete them. */
  leftovers?: Leftover[]
  /** Checks that run on a schedule or a GitHub event. See shared/automations.ts. */
  automations?: Automation[]
  /** Recent automation runs, newest last. */
  automationRuns?: AutomationRun[]
  /** Finding ids each automation already opened a workspace for, by automation id. */
  automationLedger?: Record<string, string[]>
  /** Review updates: where each PR you review stood at the last look (shared/reviewWatch.ts). */
  reviewWatch?: ReviewWatchState
  /** Where the PR inbox stood at the last GitHub poll, for GitHub-event automations. */
  githubWatch?: GithubWatchState
  /** Up next: what starts, in order, when the usage window resets. */
  continueQueue?: QueueItem[]
  /** Set while the plan is out of usage. */
  usageLimit?: UsageLimitState
  /** The last window resets and what the queue did, newest last. */
  resetLog?: ResetLog[]
}

export interface Leftover {
  id: string
  repoName: string
  repoPath: string
  paths: string[]
  removedAt: number
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

/** One Claude API response in a session, read from Claude Code's transcript. */
export interface UsagePoint {
  ts: number
  model: string
  /** Uncached input tokens. */
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  /** Made by a subagent, so it isn't in the main context window. */
  subagent?: boolean
  /** The person's message this response answers, shortened. */
  prompt?: string
  /** The first response after the person sent a message. */
  afterMessage?: boolean
  /** What the response did: the start of its text, or the tools it called. */
  did?: string
}

export interface SessionUsage {
  points: UsagePoint[]
  /** Times the conversation was compacted. */
  compactions: number[]
  contextWindow: number
  /** Running cost Claude Code reported at the end of the last turn. */
  costUsd?: number
  /** Why there is nothing to show, when points is empty. */
  empty?: string
}

export interface ChatEvent {
  chatId: string
  item?: ChatItem
  chat?: Chat
  permission?: PermissionRequest
  /** A pending permission request that no longer needs an answer. */
  permissionDone?: string
  /** Background tasks of the running turn. Empty when none are running. */
  tasks?: BackgroundTask[]
}

/** An MCP server as Claude Code reports it for a repo. */
export interface McpServerView {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  /** Config scope: user, project, local, claudeai, managed… */
  scope: string
  /** Where it came from: a config scope, plugin, claudeai, managed… */
  source: string
  error?: string
  transport: string
  /** URL, or the command line for a stdio server. */
  target: string
  tools: { name: string; description?: string }[]
  /** Defined in Claude Code's own config (user, project or local), so it can be removed here. */
  removable: boolean
}

/** A server to add with `claude mcp add`. */
export interface McpAddSpec {
  name: string
  /** user: every repo. project: this repo's .mcp.json, shared through git. */
  scope: 'user' | 'project'
  transport: 'stdio' | 'http' | 'sse'
  /** The command line for stdio, or the URL. */
  target: string
  /** KEY=value per line, for stdio. */
  env?: string
  /** Name: value per line, for http and sse. */
  headers?: string
}

/** A Claude Code plugin as `claude plugin list` reports it. */
export interface InstalledPlugin {
  /** name@marketplace */
  id: string
  name: string
  marketplace: string
  version: string
  /** user, project, local, or a scope managed elsewhere (managed, synced…). */
  scope: string
  enabled: boolean
  /** Installed in user, project or local settings, so it can be uninstalled here. */
  manageable: boolean
}

/** A plugin a configured marketplace offers. */
export interface AvailablePlugin {
  id: string
  name: string
  description: string
  marketplace: string
  installs?: number
}

export interface Marketplace {
  name: string
  source: string
}

export type PluginInstallResult =
  | { ok: true; message?: string }
  /** The plugin installs by running this command; a person must approve it first. */
  | { ok: false; confirm: { command: string; sha256: string } }

/** A skill, command or agent file in ~/.claude or the repo's .claude folder. */
export interface LocalSkill {
  kind: 'skill' | 'command' | 'agent'
  name: string
  description: string
  scope: 'user' | 'project'
  path: string
}

/** An output style a chat can use. */
export interface OutputStyleInfo {
  name: string
  description: string
  source: 'built-in' | 'user' | 'project'
}

export interface Api {
  getState(): Promise<AppState>
  pickAndAddRepo(): Promise<Repo | null>
  addRepo(path: string): Promise<Repo>
  removeRepo(repoId: string): Promise<void>
  setRepoHidden(repoId: string, hidden: boolean): Promise<void>
  setRepoPrompt(repoId: string, prompt: PromptCustom | undefined): Promise<void>
  /** The branch new workspaces start from (and PRs target) in this repo. */
  setRepoBaseBranch(repoId: string, branch: string): Promise<void>
  /** `folders` are extra directories the first chat may read and edit (linked workspaces, added folders). */
  createWorkspace(repoId: string, source?: WorkspaceSource, folders?: string[]): Promise<{ workspace: Workspace; chat: Chat; context?: string }>
  listSources(repoId: string, kind: WorkspaceSource['kind'], query: string): Promise<SourceOption[]>
  listIntegrations(): Promise<IntegrationStatus[]>
  /** Opens the service's sign-in page in the browser and resolves once the app has a token. */
  connectIntegration(id: IntegrationId): Promise<IntegrationStatus>
  disconnectIntegration(id: IntegrationId): Promise<void>
  /** Opens the repo's orchestrator, creating it the first time. */
  openOrchestrator(repoId: string): Promise<{ workspace: Workspace; chat: Chat }>
  /** Opens a project group's orchestrator, creating it the first time. */
  openGroupOrchestrator(groupId: string): Promise<{ workspace: Workspace; chat: Chat }>
  /** Creates or updates a project group. */
  saveGroup(group: { id?: string; name: string; repoIds: string[]; icon?: string; color?: string }): Promise<RepoGroup>
  /** Deletes the group and hides its orchestrator. Workspaces and memory stay. */
  deleteGroup(groupId: string): Promise<void>
  /** Creates or updates an automation. */
  saveAutomation(a: Partial<Automation> & Pick<Automation, 'name' | 'prompt' | 'trigger' | 'target'>): Promise<Automation>
  setAutomationEnabled(id: string, enabled: boolean): Promise<Automation>
  /** Deletes an automation. Its chat, workspaces and run history stay. */
  deleteAutomation(id: string): Promise<void>
  /** Starts a run now, whatever the trigger. */
  runAutomation(id: string): Promise<AutomationRun>
  /** Adds work to Up next for a chat. `top` puts it first. */
  continueAdd(chatId: string, prompt: string, top?: boolean): Promise<void>
  /** Moves an Up next item to a new position. */
  continueMove(itemId: string, to: number): Promise<void>
  /** Changes what an Up next item sends. Empty means the continue prompt. */
  continueEdit(itemId: string, prompt: string): Promise<void>
  /** Takes an item off Up next. A paused chat stays paused until you send something. */
  continueRemove(itemId: string): Promise<void>
  /** Starts an Up next item now, ignoring the reset time and the caps. */
  continueRunNow(itemId: string): Promise<void>
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
  /** Asks a small model for a new title from the workspace's chats so far. Returns the new title. */
  regenerateWorkspaceName(workspaceId: string): Promise<string>
  /** Saves a hand-sorted sidebar order: each id's position in the list. */
  reorderWorkspaces(ids: string[]): Promise<void>
  createChat(workspaceId: string): Promise<Chat>
  closeChat(chatId: string): Promise<void>
  getChatItems(chatId: string): Promise<ChatItem[]>
  getChatUsage(chatId: string): Promise<SessionUsage>
  updateChat(chatId: string, patch: Partial<Pick<Chat, 'model' | 'effort' | 'title' | 'unread' | 'planMode' | 'review' | 'reviewKind' | 'permission' | 'advisor' | 'advisorBlocker' | 'fast' | 'budgetUsd' | 'outputStyle'>>): Promise<Chat>
  /** Output styles for a workspace's chats: built-in, user and project. */
  listOutputStyles(wsId: string): Promise<OutputStyleInfo[]>
  /** Stops one background task of a running Claude turn. */
  stopTask(chatId: string, taskId: string): Promise<void>
  mcpStatus(repoId: string): Promise<McpServerView[]>
  mcpAdd(repoId: string, spec: McpAddSpec): Promise<McpServerView[]>
  mcpRemove(repoId: string, name: string, scope: string): Promise<McpServerView[]>
  mcpToggle(repoId: string, name: string, enabled: boolean): Promise<McpServerView[]>
  mcpReconnect(repoId: string, name: string): Promise<McpServerView[]>
  /** Opens Terminal on Claude Code's /mcp screen to sign in to a server. */
  mcpSignIn(repoId: string): Promise<void>
  pluginsInstalled(repoId: string): Promise<InstalledPlugin[]>
  pluginsAvailable(repoId: string, fresh?: boolean): Promise<AvailablePlugin[]>
  pluginMarketplaces(repoId: string): Promise<Marketplace[]>
  pluginAddMarketplace(repoId: string, source: string): Promise<void>
  pluginRemoveMarketplace(repoId: string, name: string): Promise<void>
  pluginInstall(repoId: string, id: string, scope: 'user' | 'project', acceptSha?: string): Promise<PluginInstallResult>
  pluginUninstall(repoId: string, id: string, scope: string): Promise<void>
  pluginSetEnabled(repoId: string, id: string, enabled: boolean, scope: string): Promise<void>
  pluginDetails(repoId: string, id: string): Promise<string>
  localSkills(repoId: string): Promise<LocalSkill[]>
  /** Installed add-ons. `fresh` asks Claude Code again instead of using what the app last read. */
  addonsList(fresh?: boolean): Promise<AddonInfo[]>
  /** Add-ons the sources offer that aren't installed. */
  addonsAvailable(): Promise<AvailableAddon[]>
  addonSources(): Promise<AddonSource[]>
  addonAddSource(source: string): Promise<void>
  addonRemoveSource(name: string): Promise<void>
  addonInstall(id: string, acceptSha?: string): Promise<PluginInstallResult>
  addonUninstall(id: string): Promise<void>
  /** Loads a folder holding one add-on or a marketplace, read in place and reloaded as it changes. Opens a folder picker without `folder`. */
  addonDevelop(folder?: string, replace?: boolean): Promise<AddonDevResult>
  /** Starts an add-on's frames over (every add-on that is on without a key), reading manifests again. */
  addonReload(key?: string): Promise<void>
  /** Opens DevTools for an add-on's views and its background page. */
  addonInspect(key: string): Promise<void>
  onAddonReloaded(cb: (r: AddonReloaded) => void): () => void
  /** Turns an add-on on or off. Turning on needs the permissions the person was shown; it fails if the add-on now asks for others. */
  addonSetEnabled(id: string, enabled: boolean, permissions?: string[]): Promise<AddonInfo[]>
  /** One host API call from an add-on's view. The main process checks the add-on's permissions. */
  addonCall(key: string, method: string, args: unknown, context: AddonContext): Promise<AddonCallResult>
  onAddonsChanged(cb: () => void): () => void
  /** What each project's choo-choo.json asks for, checked against what is installed. Projects that pin nothing are left out. */
  addonPins(): Promise<PinStatus[]>
  /** Adds the sources a project's choo-choo.json names and installs one add-on it pins. */
  addonInstallPinned(repoId: string, id: string, acceptSha?: string): Promise<PluginInstallResult>
  /** A button an add-on put in the app was pressed, and the press is for its background page. */
  addonAction(key: string, actionId: string, context: AddonActionContext): Promise<void>
  /** Pings for add-on frames: a pull request changed, an add-on's data changed. */
  onAddonEvent(cb: (e: AddonAppEvent) => void): () => void
  /** Background window only: the orchestrator is calling an add-on's tool. */
  onAddonTool(cb: (call: AddonToolCall) => void): () => void
  addonToolResult(callId: string, result: { ok: boolean; result?: unknown; error?: string }): Promise<void>
  /** Shows a file or folder in Finder. */
  revealPath(path: string): Promise<void>
  /** `answers` (question text -> answer) settles an AskUserQuestion card. */
  respondPermission(requestId: string, decision: PermissionDecision, answers?: Record<string, string>): void
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
  /** The PR without the extra lookups the PR button needs: cheap enough for every sidebar row. */
  getPrState(workspaceId: string): Promise<PrInfo | null>
  mergePr(workspaceId: string): Promise<void>
  /** Takes the workspace's draft PR out of draft. */
  markPrReady(workspaceId: string): Promise<void>
  /** Merges the base branch into the PR's branch on GitHub, then pulls the result into the worktree. */
  updatePrBranch(workspaceId: string): Promise<void>
  /** Unresolved review threads, reviews and comments on the workspace's PR. */
  getPrComments(workspaceId: string): Promise<PrComment[]>
  /** The workspace's PR with its feedback, author, the signed-in gh user and their last review. */
  getPrReview(workspaceId: string): Promise<{ pr: PrInfo; info: PrReviewInfo } | null>
  /** Which lines of the PR can take review comments, and whether the worktree's line numbers match it. */
  getPrDiffTarget(workspaceId: string): Promise<PrDiffTarget | null>
  /** Where the worktree stands against the PR's head; `ff` and `reset` also move it there. Null without an open PR. */
  followPr(workspaceId: string, how: 'check' | 'ff' | 'reset'): Promise<PrHeadSync | null>
  /** `git diff -U0` per file between two commits, for moving line comments to new line numbers. */
  getRangeDiffs(workspaceId: string, from: string, to: string, files: string[]): Promise<Record<string, string>>
  /** Commits and files between `sha` and HEAD; null when the commit can't be found. */
  getChangedSince(workspaceId: string, sha: string): Promise<{ commits: number; files: FileChange[] } | null>
  /** What the author changed in the PR since `sha`, leaving out what came from the base branch. */
  getInterdiff(workspaceId: string, sha: string): Promise<Interdiff | null>
  getInterdiffFile(workspaceId: string, sha: string, file: string): Promise<string>
  /** GitHub's per-file Viewed ticks on the workspace's PR. */
  getPrViewed(workspaceId: string): Promise<{ prId: string; files: Record<string, 'VIEWED' | 'UNVIEWED' | 'DISMISSED'> } | null>
  setPrViewed(workspaceId: string, prId: string, path: string, viewed: boolean): Promise<void>
  /** Posts a review on the workspace's PR. */
  submitPrReview(workspaceId: string, drafts: ReviewDraft[], body: string, event: ReviewEvent): Promise<{ url: string }>
  replyToPrThread(workspaceId: string, threadId: string, body: string): Promise<void>
  resolvePrThread(workspaceId: string, threadId: string): Promise<void>
  stackStatus(workspaceId: string): Promise<StackStatus | null>
  /** Turns a workspace into a stack (if it isn't one) and adds a new branch on top of the top PR. */
  stackAddLayer(workspaceId: string): Promise<void>
  stackSwitch(workspaceId: string, branch: string): Promise<void>
  stackRestack(workspaceId: string, ontoBase: boolean): Promise<void>
  stackSetAuto(workspaceId: string, on: boolean): Promise<void>
  stackAddressFeedback(workspaceId: string, chatId: string, opts: FeedbackOptions): Promise<void>
  stackContinue(workspaceId: string): Promise<void>
  stackStopJob(workspaceId: string): Promise<void>
  /** Leaves the stack: the workspace goes back to one branch, the one checked out. */
  stackDissolve(workspaceId: string): Promise<void>
  /** Creates the stack on GitHub from the stack's open PRs, or adds the PRs it is missing on top. */
  stackLinkGithub(workspaceId: string): Promise<GithubStack>
  /** Merges the PR on this branch and every PR below it in one step (all or none), then drops them from the stack. */
  stackMergeThrough(workspaceId: string, branch: string): Promise<MergeThroughResult>
  /** Installs GitHub's `gh stack` extension (`gh extension install github/gh-stack`). */
  stackInstallCli(): Promise<void>
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
  /** Plan limits for Claude and Codex, whichever are signed in. Cached for a minute unless force. */
  subscriptionLimits(force?: boolean): Promise<SubscriptionLimits[]>
  /** The Usage page: window history, where usage went, by model, busiest hours. Reads new transcript lines first. */
  usageDashboard(range: { from: number; to: number }): Promise<UsageDashboard>
  /** One window: what filled it, estimated by workspace and chat. */
  usageWindow(o: { key: string; start: number; end: number }): Promise<WindowDetail>
  /** Saves the responses in range as CSV. Returns the path, or null if cancelled. */
  exportUsageCsv(range: { from: number; to: number }): Promise<string | null>
  /** Removes a project. With deleteFiles, its workspace folders (and archived copies) are deleted; otherwise they're kept as a leftover. */
  removeProject(repoId: string, opts: { deleteFiles: boolean }): Promise<void>
  /** Permanently deletes a workspace: its folder, archived copy and chats. The branch is kept. */
  deleteWorkspace(wsId: string): Promise<void>
  deleteLeftover(id: string): Promise<void>
  /** Sets the sidebar order of projects. */
  reorderRepos(ids: string[]): Promise<void>
  pickFiles(): Promise<string[]>
  /** Current versions behind the Claude model aliases, from the Agent SDK. Empty if it couldn't be read. */
  modelDetails(): Promise<Partial<Record<ModelId, ModelDetails>>>
  previewConductorImport(): Promise<ImportPreview>
  importFromConductor(opts: { useWorkspacesRoot: boolean }): Promise<ImportResult>
  listGithubRepos(): Promise<GithubRepo[]>
  /** Open PRs across GitHub that wait on the person's review, or that they opened. */
  prInbox(): Promise<PrInbox>
  /** Looks at GitHub for review updates unless it just did; the list, or null when it can't. */
  reviewsCheckSoon(): Promise<PrInbox | null>
  /** Marks PRs (owner/repo#n) as looked at. */
  reviewsSeen(keys: string[]): Promise<void>
  /** The PRs list after each background check. */
  onPrInbox(cb: (inbox: PrInbox) => void): () => void
  /** A review-update notification was clicked. */
  onReviewOpen(cb: (pr: InboxPr) => void): () => void
  quickStart(name: string): Promise<Repo>
  /** `beside`: an add-on page asked to show the workspace next to itself (choo.ui.openWorkspace with beside). */
  onNavigate(cb: (workspaceId: string, chatId: string, beside?: { key: string; viewId: string; repoId?: string }) => void): () => void
  sendMessage(chatId: string, text: string, images?: string[]): Promise<void>
  stopChat(chatId: string): Promise<void>
  /** Hands the chat's session to Remote Control, to steer from claude.ai/code or the Claude app. */
  continueOnPhone(chatId: string): Promise<Chat>
  /** Stops Remote Control and copies the turns made there into the chat. */
  bringBackFromPhone(chatId: string): Promise<Chat>
  /** Opens the chat's session in the Claude desktop app with `claude --desktop --resume` (Claude Code's /desktop). */
  openInDesktop(chatId: string): Promise<Chat>
  /** Takes the chat back from Claude desktop and copies the turns made there into the chat. */
  bringBackFromDesktop(chatId: string): Promise<Chat>
  /** Commits and pushes the workspace, then starts a Claude Code cloud session on its branch with `task`. */
  runInCloud(chatId: string, task: string): Promise<Chat>
  /** Queues a follow-up message into the chat's cloud session. */
  sendToCloud(chatId: string, text: string): Promise<void>
  /** Pulls the cloud session and its branch back with `claude --teleport`, and resumes it here. */
  bringBackFromCloud(chatId: string): Promise<Chat>
  /** Stops following the cloud session in this chat. The session keeps running on claude.ai. */
  forgetCloud(chatId: string): Promise<Chat>
  /** Sends the advisor's notes to the agent, or dismisses them. */
  actOnAdvice(chatId: string, itemId: string, action: 'send' | 'dismiss'): Promise<void>
  /** Has fresh reviewers, who never saw the chat, check the plan in a plan card. */
  reviewPlan(chatId: string, planItemId: string): Promise<void>
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
  /** A workspace's PR or its checks changed on GitHub (or a periodic full refresh is due). */
  onPrChanged(cb: (workspaceId: string) => void): () => void
  onStackChanged(cb: (workspaceId: string) => void): () => void
  updateStatus(): Promise<UpdateStatus>
  /** Checks now, whatever the Settings toggles say. */
  checkForUpdates(which?: 'app' | 'claude' | 'all'): Promise<UpdateStatus>
  /** Restarts into a downloaded update, runs brew upgrade, or opens the release page. */
  installAppUpdate(): Promise<void>
  /** Runs `claude update` on your installed Claude Code. */
  updateClaude(): Promise<UpdateStatus>
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void
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

export interface LimitWindow {
  /** Stable id across refreshes, e.g. claude:five_hour. */
  key: string
  /** e.g. 5h, Week, Opus week */
  label: string
  /** Percent of the window used, 0-100. */
  percent: number
  resetsAt?: number
  /** Length of the window, when known (5 hours, 7 days). */
  windowMs?: number
  /** Readings recorded during the current window, oldest first. */
  history?: { t: number; p: number }[]
}

/** Plan usage for one AI subscription, shown in the sidebar footer. */
export interface SubscriptionLimits {
  provider: 'claude' | 'codex'
  name: string
  /** pro, max, team, … when known. */
  plan?: string
  windows: LimitWindow[]
  updatedAt: number
  /** The tool said the limit is used up, and when it frees up again. */
  capped?: { since: number; until?: number }
}
