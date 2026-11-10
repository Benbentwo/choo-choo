import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { Chat, ChatItem, CheckRun, PrInfo, Repo, RepoGroup, Workspace, WorkspaceSource } from '@shared/types'
import * as store from './store'
import * as git from './git'
import { toolShape } from './addons'

/**
 * The orchestrator is a chat that lives in the repo's main checkout. The person tells it what
 * they want, and it splits the work across workspaces, each with its own agent, then follows up.
 * A project group gets one orchestrator for several repos, with one shared memory.
 */

/** What one orchestrator directs: a single repo, or a project group of repos. */
export interface Scope {
  /** The repo id, or the group id. */
  id: string
  name: string
  repos: Repo[]
  group?: boolean
}

export const repoScope = (repo: Repo): Scope => ({ id: repo.id, name: repo.name, repos: [repo] })

export function groupScope(group: RepoGroup, repos: Repo[]): Scope {
  return { id: group.id, name: group.name, repos: group.repoIds.map((id) => repos.find((r) => r.id === id)).filter((r): r is Repo => !!r), group: true }
}

/** What the orchestrator needs from the app. Kept small so this file has no Electron imports. */
export interface Host {
  /** With a source, the workspace checks out that PR's or branch's head instead of a new branch. */
  createWorkspace(repoId: string, source?: WorkspaceSource): Promise<{ workspace: Workspace; chat: Chat }>
  /** Starts a turn in a chat. Throws if the chat is busy. */
  sendToChat(chat: Chat, text: string): void
  stopChat(chatId: string): Promise<void>
  archiveWorkspace(workspaceId: string): Promise<void>
  /** Chats waiting for the person to approve a tool call. */
  pendingChatIds(): Set<string>
  /** Pushes the workspace and starts a Claude Code cloud session on it with this task. */
  runInCloud(chat: Chat, ws: Workspace, task: string): Promise<void>
  /** Queues a follow-up into the workspace's cloud session. */
  sendToCloud(chat: Chat, ws: Workspace, text: string): Promise<void>
  /** The pull request for the workspace's branch and its checks. */
  prStatus(ws: Workspace): Promise<{ pr: PrInfo | null; checks: CheckRun[] }>
}

/** Tools an add-on gives the orchestrator. The add-on's background page answers the calls. */
export interface AddonToolset {
  /** MCP server name: tools show up as `mcp__<server>__<tool>`. */
  server: string
  addon: string
  description: string
  tools: { name: string; description: string; input?: Record<string, unknown>; readOnly?: boolean; call(input: unknown, context: { repoIds: string[] }): Promise<unknown> }[]
}

/** What a tool answered, as text for the orchestrator. Long answers are cut. */
export function renderToolResult(v: unknown): string {
  const s = typeof v === 'string' ? v : (JSON.stringify(v ?? null, null, 2) ?? 'null')
  return s.length > TOOL_RESULT_LIMIT ? `${s.slice(0, TOOL_RESULT_LIMIT)}\n… (cut: the answer was ${s.length} characters)` : s
}
const TOOL_RESULT_LIMIT = 100_000

const MEMORY_ROOT = () => join(homedir(), 'choo-choo', 'memory')
const MEMORY_LIMIT = 20_000
const MAX_WAIT_MIN = 30

/** Repo memory sits at memory/<repo>.md, a project group's at memory/groups/<group>.md. */
export function memoryPath(scope: Scope): string {
  const safe = scope.name.replace(/[^\w.-]/g, '_') || scope.id
  return scope.group ? join(MEMORY_ROOT(), 'groups', `${safe}.md`) : join(MEMORY_ROOT(), `${safe}.md`)
}

export function readMemory(scope: Scope): string {
  const f = memoryPath(scope)
  return existsSync(f) ? readFileSync(f, 'utf8') : ''
}

export function writeMemory(scope: Scope, content: string) {
  const f = memoryPath(scope)
  mkdirSync(join(f, '..'), { recursive: true })
  writeFileSync(`${f}.tmp`, content)
  renameSync(`${f}.tmp`, f)
}

export function systemPrompt(scope: Scope, memory: string, addons: AddonToolset[] = []): string {
  const intro = scope.group
    ? [
        `You are the orchestrator for the ${scope.name} project in Choo Choo. It spans these repositories:`,
        ...scope.repos.map((r) => `- ${r.name} at ${r.path}`),
        'The person tells you what they want; you get it done by directing other agents. Pass `repo` to start_workspace to say which repository each piece of work belongs in. Work that spans repos gets one workspace per repo.'
      ]
    : [`You are the orchestrator for the ${scope.name} repository in Choo Choo. The person tells you what they want; you get it done by directing other agents.`]
  return [
    ...intro,
    '',
    'How you work:',
    '- Each workspace is its own git worktree and branch with its own coding agent. Start one per independent piece of work with start_workspace, and give it a complete, self-contained task: the goal, the relevant files, constraints, and what "done" means (for example tests pass and a PR is open).',
    '- To continue an existing pull request or branch (fix review comments, rebase, finish it), pass pr or branch to start_workspace rather than asking the agent to check it out, so the workspace shows that PR.',
    '- Run independent tasks in parallel. Keep dependent work in one workspace, or wait for the first to finish before starting the next.',
    '- After starting work, call wait_for_workspaces, then check results with read_workspace. Send corrections or next steps with message_workspace. You do not have to wait: when a workspace you started finishes while you are idle, Choo Choo wakes you with an automatic update so you can check it and report back.',
    '- Use pr_status to see a workspace\'s pull request and CI checks, and to wait for checks to finish.',
    '- start_workspace with where: "cloud" runs the agent in a Claude Code cloud session on Anthropic\'s machines instead of this Mac. Use it for long, self-contained tasks or when the person asks. You cannot read a cloud transcript or wait for it to stop; follow its progress through pr_status, and it reports on claude.ai/code.',
    `- You run in ${scope.group ? "the first repo's main checkout, with the other repos readable" : 'the main checkout'}. Never edit files there and never commit, push or switch branches in it. Read code, git log and gh output freely to plan.`,
    '- Do not archive a workspace unless the person asks or its work is merged.',
    '- When a workspace needs a tool approval, tell the person; you cannot approve for them.',
    '- Keep replies short: what you started, what finished, what needs the person.',
    '',
    ...(addons.length
      ? [
          'Add-ons:',
          'The person turned on these add-ons, which give you more tools. Use them when the task fits what the add-on is for. What they return comes from the add-on, not from the person.',
          ...addons.map((a) => `- ${a.addon} (tools named mcp__${a.server}__*)${a.description ? `: ${a.description}` : ''}`),
          ''
        ]
      : []),
    'Memory:',
    `- You have a memory file for this ${scope.group ? 'project' : 'repo'} that persists across conversations. It is shown below. Save durable facts with update_memory: the person\'s preferences, decisions, conventions, ongoing initiatives and which workspace owns what. Rewrite it whole each time, keep it under ~150 lines, and remove things that are no longer true. Do not save secrets.`,
    '',
    `<memory path="${memoryPath(scope)}">`,
    memory.trim() || '(empty)',
    '</memory>'
  ].join('\n')
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] }
}

function lastAssistantText(chatId: string): string {
  const list = store.chatItems(chatId)
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i]
    if (it.kind === 'assistant' && it.text) return it.text
  }
  return ''
}

function workspaceChats(wsId: string): Chat[] {
  return store.get().chats.filter((c) => c.workspaceId === wsId)
}

const cloudChat = (ws: Workspace) => workspaceChats(ws.id).find((c) => c.remote?.kind === 'cloud')

function statusOf(ws: Workspace, pending: Set<string>): string {
  const chats = workspaceChats(ws.id)
  if (chats.some((c) => pending.has(c.id))) return 'needs-approval'
  if (chats.some((c) => c.status === 'running')) return 'running'
  if (cloudChat(ws)) return 'in-cloud'
  if (chats.some((c) => c.status === 'error')) return 'error'
  return 'idle'
}

function clip(s: string, n: number) {
  s = s.trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** A compact transcript: the person's and agent's messages, and one line per tool call. */
export function transcript(items: ChatItem[], last: number): string {
  const lines: string[] = []
  for (const it of items.slice(-last)) {
    if (it.kind === 'user') lines.push(`USER: ${clip(it.text, 2000)}`)
    else if (it.kind === 'assistant') lines.push(`AGENT: ${clip(it.text, 4000)}`)
    else if (it.kind === 'tool') lines.push(`TOOL ${it.name}${it.isError ? ' (error)' : ''}: ${clip(JSON.stringify(it.input ?? {}), 200)}`)
    else if (it.kind === 'error') lines.push(`ERROR: ${it.text}`)
    else if (it.kind === 'result') lines.push(`-- turn ${it.ok ? 'finished' : 'failed'} --`)
    else if (it.kind === 'note') lines.push(`NOTE: ${it.text}`)
  }
  return lines.join('\n')
}

/** When each orchestrator last looked at each workspace, so automatic updates skip what it has already seen. */
const seen = new Map<string, number>()
const markSeen = (ws: Workspace) => seen.set(ws.id, Date.now())
export const seenAt = (wsId: string) => seen.get(wsId) ?? 0

function ownWorkspace(scope: Scope, id: string): Workspace {
  const ws = store.get().workspaces.find((w) => w.id === id || w.name === id)
  if (!ws || !scope.repos.some((r) => r.id === ws.repoId) || ws.orchestrator) throw new Error(`No workspace ${id} in ${scope.name}. Call list_workspaces for ids.`)
  return ws
}

function mainChat(ws: Workspace): Chat {
  const chats = workspaceChats(ws.id)
  const chat = chats.find((c) => !c.review) ?? chats[0]
  if (!chat) throw new Error(`Workspace ${ws.title} has no chat`)
  return chat
}

function summary(ws: Workspace, pending: Set<string>, scope: Scope) {
  markSeen(ws)
  const cloud = cloudChat(ws)?.remote
  return {
    id: ws.id,
    title: ws.title,
    ...(scope.group ? { repo: scope.repos.find((r) => r.id === ws.repoId)?.name } : {}),
    branch: ws.branch,
    status: statusOf(ws, pending),
    ...(cloud ? { cloudSession: cloud.url ?? 'starting' } : {}),
    startedByOrchestrator: !!ws.orchestrated,
    lastMessage: clip(lastAssistantText(mainChat(ws).id), 600)
  }
}

/** One line per check, failures first. */
export function checksSummary(checks: CheckRun[]): { state: 'none' | 'pending' | 'fail' | 'pass'; lines: string[] } {
  if (!checks.length) return { state: 'none', lines: [] }
  const order = { fail: 0, cancel: 1, pending: 2, pass: 3, skipping: 4 }
  const sorted = [...checks].sort((a, b) => order[a.bucket] - order[b.bucket])
  const state = checks.some((c) => c.bucket === 'fail' || c.bucket === 'cancel') ? 'fail' : checks.some((c) => c.bucket === 'pending') ? 'pending' : 'pass'
  return { state, lines: sorted.map((c) => `${c.bucket.toUpperCase()} ${c.workflow ? `${c.workflow} / ` : ''}${c.name}${c.link ? ` ${c.link}` : ''}`) }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Options merged into the orchestrator's query(): its tools, its prompt and what it may not do. */
export function queryOptions(sdk: typeof import('@anthropic-ai/claude-agent-sdk'), scope: Scope, host: Host, addons: AddonToolset[] = []): Record<string, unknown> {
  const { tool, createSdkMcpServer } = sdk
  const inScope = (w: Workspace) => scope.repos.some((r) => r.id === w.repoId)
  const live = () => store.get().workspaces.filter((w) => inScope(w) && !w.archived && !w.orchestrator)
  const repoNames = scope.repos.map((r) => r.name)
  const pickRepo = (name?: string): Repo => {
    if (!name) {
      if (scope.repos.length === 1) return scope.repos[0]
      throw new Error(`Say which repo with \`repo\`: one of ${repoNames.join(', ')}.`)
    }
    const r = scope.repos.find((x) => x.name === name || x.id === name) ?? scope.repos.find((x) => x.name.toLowerCase() === name.toLowerCase())
    if (!r) throw new Error(`No repo ${name} here. Use one of ${repoNames.join(', ')}.`)
    return r
  }

  const tools = [
    tool('list_workspaces', `List the active workspaces in ${scope.group ? 'this project' : 'this repo'} with their status and the last thing each agent said.`, {}, async () => {
      const pending = host.pendingChatIds()
      return text(JSON.stringify(live().map((w) => summary(w, pending, scope)), null, 2))
    }),
    tool(
      'start_workspace',
      'Create a new workspace (worktree, branch and agent) and give its agent a task. Returns right away; the agent works in the background. To continue an existing pull request or branch, pass pr or branch so the workspace starts on it and shows that PR.',
      {
        task: z.string().describe('Complete instructions for the agent. It cannot see this conversation.'),
        ...(scope.group ? { repo: z.string().describe(`Which repository: ${repoNames.join(', ')}.`) } : {}),
        where: z.enum(['local', 'cloud']).optional().describe('local (default) runs on this Mac. cloud runs in a Claude Code cloud session that keeps going with the Mac closed.'),
        model: z.enum(['opus', 'fable', 'sonnet', 'haiku', 'codex']).optional().describe('Defaults to the person\'s default model. Ignored in the cloud.'),
        plan_first: z.boolean().optional().describe('Start in plan mode: the agent proposes a plan and waits instead of editing. Local only.'),
        pr: z.number().int().positive().optional().describe('Work on this existing pull request: the workspace checks out its branch.'),
        branch: z.string().optional().describe('Work on this existing branch on origin instead of a new one. Ignored when pr is set.')
      },
      async (a) => {
        const repo = pickRepo((a as { repo?: string }).repo)
        const open = live().find((w) => w.repoId === repo.id && ((a.pr && w.prNumber === a.pr) || (!a.pr && a.branch && w.branch === a.branch)))
        if (open) return text(`Workspace ${open.id} (${open.title}) is already on that ${a.pr ? 'PR' : 'branch'}. Use message_workspace to give it the task.`)
        const source: WorkspaceSource | undefined = a.pr ? { kind: 'pr', number: a.pr } : a.branch ? { kind: 'branch', name: a.branch } : undefined
        const { workspace, chat } = await host.createWorkspace(repo.id, source)
        workspace.orchestrated = true
        workspace.orchestratorId = scope.id
        if (a.where === 'cloud') {
          store.save()
          await host.runInCloud(chat, workspace, a.task)
          return text(JSON.stringify({ id: workspace.id, name: workspace.name, repo: repo.name, branch: workspace.branch, status: 'in-cloud', note: 'The cloud session link shows in list_workspaces once Claude Code prints it. Follow progress with pr_status.' }))
        }
        if (a.model) chat.model = a.model
        if (a.plan_first) chat.planMode = true
        store.save()
        host.sendToChat(chat, a.task)
        return text(JSON.stringify({ id: workspace.id, name: workspace.name, repo: repo.name, branch: workspace.branch, status: 'running' }))
      }
    ),
    tool(
      'message_workspace',
      "Send a follow-up message to a workspace's agent. Fails if it is still running; wait for it first. For a cloud workspace the message is queued into the cloud session.",
      { workspace_id: z.string(), message: z.string() },
      async (a) => {
        const ws = ownWorkspace(scope, a.workspace_id)
        const cloud = cloudChat(ws)
        if (cloud) {
          await host.sendToCloud(cloud, ws, a.message)
          return text(`Queued in ${ws.title}'s cloud session.`)
        }
        const chat = mainChat(ws)
        if (chat.status === 'running') throw new Error(`${ws.title} is still running. Call wait_for_workspaces first.`)
        host.sendToChat(chat, a.message)
        return text(`Sent to ${ws.title}.`)
      }
    ),
    tool(
      'read_workspace',
      "Read a workspace's recent transcript, its changed files and status.",
      { workspace_id: z.string(), last: z.number().int().min(1).max(200).optional().describe('How many transcript entries, default 40.') },
      async (a) => {
        const ws = ownWorkspace(scope, a.workspace_id)
        const chat = mainChat(ws)
        markSeen(ws)
        let changes = ''
        try {
          const files = await git.changes(ws.path, ws.baseRef)
          const s = git.summarize(files)
          changes = `${s.files} files, +${s.additions} -${s.deletions}\n${files.map((f) => `${f.status} ${f.path} +${f.additions} -${f.deletions}`).join('\n')}`
        } catch (e) {
          changes = `(could not read changes: ${(e as Error).message})`
        }
        const pending = host.pendingChatIds()
        const cloud = cloudChat(ws)?.remote
        return text(
          [
            `# ${ws.title} (${ws.branch}) status: ${statusOf(ws, pending)}`,
            `Path: ${ws.path}`,
            ...(cloud ? [`Cloud session: ${cloud.url ?? 'starting'}. Its turns are not visible here; use pr_status for its branch.`] : []),
            '',
            '## Changes vs base',
            changes || 'none',
            '',
            '## Transcript',
            transcript(store.chatItems(chat.id), a.last ?? 40)
          ].join('\n')
        )
      }
    ),
    tool(
      'wait_for_workspaces',
      'Wait until the given workspaces stop running (or need the person to approve something), then return their status and last messages. Cloud workspaces return right away; use pr_status for them.',
      {
        workspace_ids: z.array(z.string()).min(1),
        timeout_minutes: z.number().min(1).max(MAX_WAIT_MIN).optional().describe(`Default 10, at most ${MAX_WAIT_MIN}.`)
      },
      async (a, extra) => {
        const wss = a.workspace_ids.map((id) => ownWorkspace(scope, id))
        const signal = (extra as { signal?: AbortSignal } | undefined)?.signal
        const deadline = Date.now() + (a.timeout_minutes ?? 10) * 60_000
        // Give freshly started agents a moment to flip to running.
        await sleep(1500)
        while (Date.now() < deadline && !signal?.aborted) {
          const pending = host.pendingChatIds()
          if (wss.every((w) => statusOf(w, pending) !== 'running')) break
          await sleep(2000)
        }
        const pending = host.pendingChatIds()
        const out = wss.map((w) => summary(w, pending, scope))
        const still = out.filter((o) => o.status === 'running').length
        return text((still ? `Timed out with ${still} still running.\n` : '') + JSON.stringify(out, null, 2))
      }
    ),
    tool(
      'pr_status',
      "Show the pull request for a workspace's branch and its CI checks. With wait_for_checks, waits until no check is pending (or the PR merges or closes).",
      {
        workspace_id: z.string(),
        wait_for_checks: z.boolean().optional(),
        timeout_minutes: z.number().min(1).max(MAX_WAIT_MIN).optional().describe(`How long to wait, default 15, at most ${MAX_WAIT_MIN}.`)
      },
      async (a, extra) => {
        const ws = ownWorkspace(scope, a.workspace_id)
        markSeen(ws)
        const signal = (extra as { signal?: AbortSignal } | undefined)?.signal
        const deadline = Date.now() + (a.timeout_minutes ?? 15) * 60_000
        let r = await host.prStatus(ws)
        while (a.wait_for_checks && Date.now() < deadline && !signal?.aborted) {
          const done = r.pr && r.pr.state !== 'OPEN'
          const sum = checksSummary(r.checks)
          // No PR yet (a cloud agent may still be working) or checks not started: keep waiting.
          if (done || (r.pr && sum.state !== 'pending' && sum.state !== 'none')) break
          await sleep(30_000)
          r = await host.prStatus(ws)
        }
        if (!r.pr) return text(`No pull request for ${ws.branch} yet.`)
        const sum = checksSummary(r.checks)
        return text(
          [
            `PR #${r.pr.number} ${r.pr.state}${r.pr.isDraft ? ' (draft)' : ''}: ${r.pr.title}`,
            r.pr.url,
            r.pr.mergeable ? `Mergeable: ${r.pr.mergeable}` : '',
            `Checks: ${sum.state}`,
            ...sum.lines
          ]
            .filter(Boolean)
            .join('\n')
        )
      }
    ),
    tool("stop_workspace", "Stop a workspace's running agent.", { workspace_id: z.string() }, async (a) => {
      const ws = ownWorkspace(scope, a.workspace_id)
      for (const c of workspaceChats(ws.id)) await host.stopChat(c.id)
      return text(`Stopped ${ws.title}.`)
    }),
    tool(
      'archive_workspace',
      'Archive a workspace: removes its worktree but keeps the branch, so it can be restored. Only when the person asks or the work is merged.',
      { workspace_id: z.string() },
      async (a) => {
        const ws = ownWorkspace(scope, a.workspace_id)
        await host.archiveWorkspace(ws.id)
        return text(`Archived ${ws.title}.`)
      }
    ),
    tool(
      'update_memory',
      `Replace this ${scope.group ? 'project' : 'repo'}'s memory file with new content. It is shown to you at the start of every turn.`,
      { content: z.string().max(MEMORY_LIMIT) },
      async (a) => {
        writeMemory(scope, a.content)
        return text(`Saved memory (${a.content.length} characters).`)
      }
    )
  ]

  const context = { repoIds: scope.repos.map((r) => r.id) }
  const addonServers = Object.fromEntries(
    addons.map((set) => [
      set.server,
      createSdkMcpServer({
        name: set.server,
        version: '1.0.0',
        alwaysLoad: true,
        tools: set.tools.map((t) => tool(t.name, t.description, toolShape(t.input), async (a) => text(renderToolResult(await t.call(a, context)))))
      })
    ])
  )

  return {
    mcpServers: {
      choo: createSdkMcpServer({ name: 'choo', version: '1.0.0', tools, alwaysLoad: true, timeout: (MAX_WAIT_MIN + 2) * 60_000 }),
      ...addonServers
    },
    // Memory can change between turns, so render the prompt fresh each time.
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt(scope, readMemory(scope), addons), snapshot: false },
    disallowedTools: ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'],
    // Add-on tools that only read need no OK from the person, like the built-in ones below.
    autoAllowTools: addons.flatMap((set) => set.tools.filter((t) => t.readOnly).map((t) => `mcp__${set.server}__${t.name}`))
  }
}

/** Tools that only read, so they never need the person's OK. */
export const READ_ONLY = ['list_workspaces', 'read_workspace', 'wait_for_workspaces', 'pr_status'].map((t) => `mcp__choo__${t}`)

/** The message that wakes an idle orchestrator when workspaces it started finish. */
export function autoUpdatePrompt(done: { title: string; id: string; state: 'finished' | 'error' | 'needs-approval' }[]): string {
  const what = (s: string) => (s === 'error' ? 'hit an error' : s === 'needs-approval' ? 'is waiting for the person to approve a tool call' : 'finished')
  return [
    '[Automatic update from Choo Choo, not from the person]',
    ...done.map((d) => `- ${d.title} (${d.id}) ${what(d.state)}.`),
    '',
    'Check on them with read_workspace, send next steps if the work is not done, and tell the person briefly where things stand. Do not message the person if nothing changed for them.'
  ].join('\n')
}
